package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"goBankV2/internal/analyzer"
	"goBankV2/internal/models"
)

// DBManager handles live database connections and transaction simulation.
type DBManager struct {
	db *sql.DB
}

// AutoInitAndConnect connects to MySQL, auto-creates database & tables if missing,
// and returns a ready-to-use DBManager. It provides Windows-friendly diagnostics on common connection failures.
func AutoInitAndConnect(dbUser, dbPass, dbHost, dbPort, dbName string) (*DBManager, error) {
	var authPart string
	if dbPass != "" {
		authPart = fmt.Sprintf("%s:%s", dbUser, dbPass)
	} else {
		authPart = dbUser
	}

	// 1. First connect to MySQL instance root (without target db) to ensure server is reachable and database exists
	serverDSN := fmt.Sprintf("%s@tcp(%s:%s)/?parseTime=true&multiStatements=true&interpolateParams=true", authPart, dbHost, dbPort)
	rootDB, err := sql.Open("mysql", serverDSN)
	if err != nil {
		return nil, fmt.Errorf("failed to open MySQL driver: %w", err)
	}
	defer rootDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rootDB.PingContext(ctx); err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "Access denied") || strings.Contains(errStr, "1045") {
			return nil, fmt.Errorf("MySQL Authentication Failed for user '%s'.\nIf your local MySQL root user has a password, specify it via:\n  PowerShell: $env:DB_PASS = 'yourpassword'\n  CMD:        set DB_PASS=yourpassword\nOriginal error: %w", dbUser, err)
		}
		if strings.Contains(errStr, "actively refused") || strings.Contains(errStr, "connection refused") || strings.Contains(errStr, "timeout") {
			return nil, fmt.Errorf("Could not connect to MySQL at %s:%s. Please ensure MySQL is running on your Windows PC.\nTip: Open 'services.msc' in Windows and verify the 'MySQL' service is Running, or run 'net start MySQL' as Administrator.\nOriginal error: %w", dbHost, dbPort, err)
		}
		return nil, fmt.Errorf("failed to connect to MySQL server at %s:%s: %w", dbHost, dbPort, err)
	}

	// 2. Ensure database exists
	createDBSQL := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;", dbName)
	if _, err := rootDB.ExecContext(ctx, createDBSQL); err != nil {
		return nil, fmt.Errorf("failed to auto-create database '%s': %w", dbName, err)
	}

	// 3. Connect to the target database
	dbDSN := fmt.Sprintf("%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true&interpolateParams=true", authPart, dbHost, dbPort, dbName)
	targetDB, err := sql.Open("mysql", dbDSN)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database '%s': %w", dbName, err)
	}

	targetDB.SetMaxOpenConns(25)
	targetDB.SetMaxIdleConns(10)
	targetDB.SetConnMaxLifetime(5 * time.Minute)

	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	if err := targetDB.PingContext(pingCtx); err != nil {
		targetDB.Close()
		return nil, fmt.Errorf("failed to ping database '%s': %w", dbName, err)
	}

	// 4. Ensure schema tables exist
	schemaDDL := `
	CREATE TABLE IF NOT EXISTS accounts (
		id INT AUTO_INCREMENT PRIMARY KEY,
		account_code VARCHAR(10) NOT NULL UNIQUE,
		owner_name VARCHAR(100) NOT NULL,
		balance DECIMAL(15, 2) NOT NULL DEFAULT 1000.00,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB;

	CREATE TABLE IF NOT EXISTS simulation_logs (
		id INT AUTO_INCREMENT PRIMARY KEY,
		simulation_uuid VARCHAR(64) NOT NULL,
		step_index INT NOT NULL,
		tx_id VARCHAR(10) NOT NULL,
		operation VARCHAR(20) NOT NULL,
		account_code VARCHAR(10) NOT NULL,
		delta_amount DECIMAL(15, 2) DEFAULT 0.00,
		observed_balance DECIMAL(15, 2) DEFAULT NULL,
		status VARCHAR(30) NOT NULL,
		duration_ms INT NOT NULL,
		details TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB;

	INSERT IGNORE INTO accounts (account_code, owner_name, balance) VALUES
	('A', 'Alice Springs', 1000.00),
	('B', 'Bob Vance', 1000.00),
	('C', 'Charlie Day', 1000.00);
	`
	initCtx, initCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer initCancel()
	if _, err := targetDB.ExecContext(initCtx, schemaDDL); err != nil {
		targetDB.Close()
		return nil, fmt.Errorf("failed to ensure database schema tables: %w", err)
	}

	log.Printf("Successfully connected to MySQL database '%s' at %s:%s (schema verified).", dbName, dbHost, dbPort)
	return &DBManager{db: targetDB}, nil
}

// NewDBManager creates a verified MySQL connection.
func NewDBManager(dsn string) (*DBManager, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open mysql connection: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping mysql server: %w", err)
	}

	log.Println("Successfully connected to MySQL database!")
	return &DBManager{db: db}, nil
}

// Close closes the underlying pool.
func (m *DBManager) Close() error {
	return m.db.Close()
}

// ResetAccounts resets all accounts back to baseline $1,000.00.
func (m *DBManager) ResetAccounts() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	queries := []string{
		"UPDATE accounts SET balance = 1000.00 WHERE account_code IN ('A', 'B', 'C')",
		"DELETE FROM simulation_logs",
	}

	for _, q := range queries {
		if _, err := m.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("error resetting database: %w", err)
		}
	}
	return nil
}

// GetAccounts fetches current balance of all accounts.
func (m *DBManager) GetAccounts() ([]models.Account, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := m.db.QueryContext(ctx, "SELECT id, account_code, owner_name, balance, updated_at FROM accounts ORDER BY account_code ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []models.Account
	for rows.Next() {
		var a models.Account
		if err := rows.Scan(&a.ID, &a.AccountCode, &a.OwnerName, &a.Balance, &a.UpdatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, nil
}

// workerCommand is a synchronous task dispatched to a dedicated transaction worker.
type workerCommand struct {
	step      models.TimelineStep
	isStrict  bool
	replyChan chan workerResponse
}

type workerResponse struct {
	logEntry models.ExecutionStepLog
	err      error
}

// ExecuteSimulation steps through the user schedule against dedicated MySQL sessions.
func (m *DBManager) ExecuteSimulation(req models.SimulationRequest) (*models.SimulationResult, error) {
	startTime := time.Now()

	// 1. Reset accounts to baseline $1,000
	if err := m.ResetAccounts(); err != nil {
		return nil, fmt.Errorf("failed to reset initial state: %w", err)
	}

	// 2. Perform static hazard and precedence analysis
	analysis := analyzer.AnalyzeSchedule(req.Schedule)

	// 3. Prepare step order
	steps := make([]models.TimelineStep, len(req.Schedule))
	copy(steps, req.Schedule)
	sort.Slice(steps, func(i, j int) bool {
		return steps[i].StepIndex < steps[j].StepIndex
	})

	// Group unique transactions
	txMap := make(map[string]bool)
	for _, s := range steps {
		txMap[s.TxID] = true
	}

	// 4. Spawn a dedicated worker goroutine with a dedicated *sql.Conn for each transaction
	workers := make(map[string]chan workerCommand)
	var wg sync.WaitGroup

	ctx, cancelAll := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelAll()

	isoLevel := string(req.Isolation)
	if isoLevel == "" {
		if req.ControlMode == models.ModeStrict2PL {
			isoLevel = "REPEATABLE READ"
		} else {
			isoLevel = "READ COMMITTED"
		}
	}

	for txID := range txMap {
		cmdChan := make(chan workerCommand)
		workers[txID] = cmdChan
		wg.Add(1)

		go func(id string, ch chan workerCommand) {
			defer wg.Done()
			m.runTransactionWorker(ctx, id, isoLevel, req.ControlMode == models.ModeStrict2PL, ch)
		}(txID, cmdChan)
	}

	// 5. Coordinator: Step through timeline sequentially and collect live logs
	// Dispatch operations in timeline order. If an operation blocks waiting for an InnoDB lock,
	// we allow subsequent operations of other transactions to be dispatched so that concurrent
	// lock acquisitions interact in MySQL (triggering InnoDB Error 1213 deadlocks when cycles occur).
	type pendingStep struct {
		replyCh chan workerResponse
		resp    *workerResponse
	}
	pending := make([]*pendingStep, 0, len(steps))

	for _, step := range steps {
		ch, exists := workers[step.TxID]
		if !exists {
			continue
		}

		replyCh := make(chan workerResponse, 1)
		cmd := workerCommand{
			step:      step,
			isStrict:  req.ControlMode == models.ModeStrict2PL,
			replyChan: replyCh,
		}

		ch <- cmd
		ps := &pendingStep{replyCh: replyCh}
		pending = append(pending, ps)

		// Give query a brief window to complete normally
		select {
		case r := <-replyCh:
			ps.resp = &r
		case <-time.After(30 * time.Millisecond):
			// Query is blocked on an InnoDB row lock; continue dispatching so other transactions can run
		}
	}

	var execLogs []models.ExecutionStepLog
	for _, ps := range pending {
		if ps.resp != nil {
			execLogs = append(execLogs, ps.resp.logEntry)
		} else {
			r := <-ps.replyCh
			execLogs = append(execLogs, r.logEntry)
		}
	}

	// 6. Close worker channels to signal clean shutdown
	for _, ch := range workers {
		close(ch)
	}
	wg.Wait()

	// 7. Retrieve final account balances
	finalAccounts, err := m.GetAccounts()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch final accounts: %w", err)
	}

	hasDeadlock := false
	for _, l := range execLogs {
		if l.Status == "DEADLOCK_ROLLED_BACK" {
			hasDeadlock = true
			break
		}
	}

	resolved := (req.ControlMode == models.ModeStrict2PL) || !analysis.HasHazards
	resMsg := "Simulation completed."
	if hasDeadlock {
		resMsg = "⚠️ MySQL Deadlock (Error 1213) detected! InnoDB wait-for graph found a cycle. A victim transaction was automatically rolled back to preserve database consistency."
	} else if req.ControlMode == models.ModeStrict2PL {
		resMsg = "Strict Two-Phase Locking (S2PL) enforced. Exclusive locks on rows (SELECT ... FOR UPDATE) prevented conflicting dirty reads and lost updates."
	} else if analysis.HasHazards {
		resMsg = fmt.Sprintf("Anomalies observed! %d hazard(s) detected during timeline execution.", len(analysis.Hazards))
	}

	return &models.SimulationResult{
		Analysis:      analysis,
		ExecutionLogs: execLogs,
		FinalAccounts: finalAccounts,
		ExecutionTime: time.Since(startTime).Milliseconds(),
		Resolved:      resolved,
		ResolutionMsg: resMsg,
	}, nil
}

// runTransactionWorker manages a single dedicated MySQL transaction session.
func (m *DBManager) runTransactionWorker(parentCtx context.Context, txID string, isoLevel string, isStrict2PL bool, cmdChan chan workerCommand) {
	conn, err := m.db.Conn(parentCtx)
	if err != nil {
		log.Printf("[%s] Error obtaining connection: %v\n", txID, err)
		return
	}
	defer conn.Close()

	// Configure isolation level
	_, _ = conn.ExecContext(parentCtx, fmt.Sprintf("SET SESSION TRANSACTION ISOLATION LEVEL %s", isoLevel))
	// Set lock wait timeout to 1 second so blocking is quickly recognized
	_, _ = conn.ExecContext(parentCtx, "SET SESSION innodb_lock_wait_timeout = 2")

	// Begin transaction
	_, _ = conn.ExecContext(parentCtx, "START TRANSACTION")

	for cmd := range cmdChan {
		stepStart := time.Now()
		step := cmd.step
		var logEntry models.ExecutionStepLog
		logEntry.StepIndex = step.StepIndex
		logEntry.TxID = step.TxID
		logEntry.Op = step.Op
		logEntry.Account = step.Account

		// Dedicated query context with short lock-wait timeout
		qCtx, qCancel := context.WithTimeout(parentCtx, 2500*time.Millisecond)

		switch step.Op {
		case models.OpRead:
			var query string
			if isStrict2PL {
				query = "SELECT balance FROM accounts WHERE account_code = ? FOR UPDATE"
			} else {
				query = "SELECT balance FROM accounts WHERE account_code = ?"
			}

			var balance float64
			err := conn.QueryRowContext(qCtx, query, step.Account).Scan(&balance)
			logEntry.DurationMs = time.Since(stepStart).Milliseconds()

			if err != nil {
				errStr := err.Error()
				if strings.Contains(errStr, "Deadlock found") || strings.Contains(errStr, "1213") {
					logEntry.Status = "DEADLOCK_ROLLED_BACK"
					logEntry.Detail = fmt.Sprintf("⚠️ DEADLOCK DETECTED (Error 1213)! InnoDB chose %s as victim. Automatically rolled back to release locks.", txID)
					_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
					_, _ = conn.ExecContext(context.Background(), "START TRANSACTION")
				} else if strings.Contains(errStr, "Lock wait timeout") {
					logEntry.Status = "BLOCKED_WAIT"
					logEntry.Detail = fmt.Sprintf("Lock wait timeout: Another transaction holds an exclusive lock on Account %s", step.Account)
				} else {
					logEntry.Status = "FAILED"
					logEntry.Detail = errStr
				}
			} else {
				logEntry.Status = "SUCCESS"
				logEntry.ObservedValue = &balance
				if isStrict2PL {
					logEntry.Detail = fmt.Sprintf("Read balance $%.2f (Acquired exclusive lock FOR UPDATE)", balance)
				} else {
					logEntry.Detail = fmt.Sprintf("Read balance $%.2f", balance)
				}
			}

		case models.OpWrite:
			// Apply update: add/subtract or set
			delta := step.Amount
			if delta == 0 {
				delta = 200.00 // default educational delta
			}

			updateQuery := "UPDATE accounts SET balance = balance + ? WHERE account_code = ?"
			_, err := conn.ExecContext(qCtx, updateQuery, delta, step.Account)
			logEntry.DurationMs = time.Since(stepStart).Milliseconds()

			if err != nil {
				errStr := err.Error()
				if strings.Contains(errStr, "Deadlock found") || strings.Contains(errStr, "1213") {
					logEntry.Status = "DEADLOCK_ROLLED_BACK"
					logEntry.Detail = fmt.Sprintf("⚠️ DEADLOCK DETECTED (Error 1213)! InnoDB chose %s as victim. Automatically rolled back to break lock cycle.", txID)
					_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
					_, _ = conn.ExecContext(context.Background(), "START TRANSACTION")
				} else if strings.Contains(errStr, "Lock wait timeout") {
					logEntry.Status = "BLOCKED_WAIT"
					logEntry.Detail = fmt.Sprintf("Lock wait timeout on Account %s update: Blocked by active lock", step.Account)
				} else {
					logEntry.Status = "FAILED"
					logEntry.Detail = errStr
				}
			} else {
				// Query new balance to record in log
				var newBal float64
				_ = conn.QueryRowContext(qCtx, "SELECT balance FROM accounts WHERE account_code = ?", step.Account).Scan(&newBal)
				logEntry.Status = "SUCCESS"
				logEntry.WrittenValue = &newBal
				logEntry.Detail = fmt.Sprintf("Updated Account %s by %+.2f (New local balance: $%.2f)", step.Account, delta, newBal)
			}

		case models.OpCommit:
			_, err := conn.ExecContext(qCtx, "COMMIT")
			logEntry.DurationMs = time.Since(stepStart).Milliseconds()
			if err != nil {
				logEntry.Status = "FAILED"
				logEntry.Detail = err.Error()
			} else {
				logEntry.Status = "SUCCESS"
				logEntry.Detail = "Transaction committed successfully. All held locks released."
			}

		case models.OpRollback:
			_, err := conn.ExecContext(qCtx, "ROLLBACK")
			logEntry.DurationMs = time.Since(stepStart).Milliseconds()
			if err != nil {
				logEntry.Status = "FAILED"
				logEntry.Detail = err.Error()
			} else {
				logEntry.Status = "SUCCESS"
				logEntry.Detail = "Transaction rolled back. All modifications undone and locks released."
			}
		}

		qCancel()
		cmd.replyChan <- workerResponse{logEntry: logEntry}
	}

	// Ensure cleanup if connection is abandoned
	_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
}
