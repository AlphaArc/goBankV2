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
	var execLogs []models.ExecutionStepLog

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
		resp := <-replyCh
		execLogs = append(execLogs, resp.logEntry)
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

	resolved := (req.ControlMode == models.ModeStrict2PL) || !analysis.HasHazards
	resMsg := "Simulation completed."
	if req.ControlMode == models.ModeStrict2PL {
		resMsg = "Strict Two-Phase Locking (S2PL) enforced. Exclusive locks on rows prevented conflicting dirty reads and lost updates."
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
				if strings.Contains(err.Error(), "Lock wait timeout") {
					logEntry.Status = "BLOCKED_WAIT"
					logEntry.Detail = fmt.Sprintf("Lock wait timeout: Another transaction holds an exclusive lock on Account %s", step.Account)
				} else {
					logEntry.Status = "FAILED"
					logEntry.Detail = err.Error()
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
				if strings.Contains(err.Error(), "Lock wait timeout") {
					logEntry.Status = "BLOCKED_WAIT"
					logEntry.Detail = fmt.Sprintf("Lock wait timeout on Account %s update: Blocked by active lock", step.Account)
				} else {
					logEntry.Status = "FAILED"
					logEntry.Detail = err.Error()
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
