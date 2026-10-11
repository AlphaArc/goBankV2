package models

import "time"

// OperationType represents the DBMS operation.
type OperationType string

const (
	OpRead     OperationType = "READ"
	OpWrite    OperationType = "WRITE"
	OpCommit   OperationType = "COMMIT"
	OpRollback OperationType = "ROLLBACK"
)

// IsolationLevel defines the SQL isolation level.
type IsolationLevel string

const (
	IsoReadUncommitted IsolationLevel = "READ UNCOMMITTED"
	IsoReadCommitted   IsolationLevel = "READ COMMITTED"
	IsoRepeatableRead  IsolationLevel = "REPEATABLE READ"
	IsoSerializable    IsolationLevel = "SERIALIZABLE"
)

// ConcurrencyControlMode defines the protocol applied.
type ConcurrencyControlMode string

const (
	ModeNone      ConcurrencyControlMode = "NONE"
	ModeStrict2PL ConcurrencyControlMode = "STRICT_2PL"
	ModeIsolation ConcurrencyControlMode = "HIGH_ISOLATION"
)

// TimelineStep represents a single operation in a transaction timeline.
type TimelineStep struct {
	ID        string        `json:"id"`
	TxID      string        `json:"txId"`      // "T1", "T2", "T3", "T4"
	Op        OperationType `json:"op"`        // READ, WRITE, COMMIT, ROLLBACK
	Account   string        `json:"account"`   // "A", "B", "C"
	Amount    float64       `json:"amount"`    // Amount to deposit/withdraw or set
	StepIndex int           `json:"stepIndex"` // Global temporal order (1, 2, 3...)
}

// Account represents a bank account entity.
type Account struct {
	ID          int       `json:"id"`
	AccountCode string    `json:"accountCode"` // 'A', 'B', 'C'
	OwnerName   string    `json:"ownerName"`
	Balance     float64   `json:"balance"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// HazardType enumerates classical DBMS serialization anomalies.
type HazardType string

const (
	HazardDirtyRead         HazardType = "DIRTY_READ"
	HazardLostUpdate        HazardType = "LOST_UPDATE"
	HazardNonRepeatableRead HazardType = "NON_REPEATABLE_READ"
	HazardWriteSkew         HazardType = "WRITE_SKEW"
	HazardCycleConflict     HazardType = "CYCLE_CONFLICT"
)

// DetectedHazard represents a specific conflict detected in the schedule.
type DetectedHazard struct {
	Type         HazardType `json:"type"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Severity     string     `json:"severity"` // "CRITICAL", "HIGH", "WARNING"
	Transactions []string   `json:"transactions"`
	InvolvedStep []int      `json:"involvedSteps"`
	Account      string     `json:"account"`
	FixHint      string     `json:"fixHint"`
}

// PrecedenceEdge represents an edge in the serialization graph.
type PrecedenceEdge struct {
	FromTx     string        `json:"fromTx"`
	ToTx       string        `json:"toTx"`
	ConflictOp OperationType `json:"conflictOp"`
	Account    string        `json:"account"`
	Reason     string        `json:"reason"`
}

// AnalysisResult holds the static schedule evaluation.
type AnalysisResult struct {
	IsSerializable  bool             `json:"isSerializable"`
	HasHazards      bool             `json:"hasHazards"`
	CycleDetected   bool             `json:"cycleDetected"`
	CycleNodes      []string         `json:"cycleNodes,omitempty"`
	PrecedenceEdges []PrecedenceEdge `json:"precedenceEdges"`
	Hazards         []DetectedHazard `json:"hazards"`
	SafePlanHint    string           `json:"safePlanHint"`
}

// ExecutionStepLog records the live outcome of an individual operation.
type ExecutionStepLog struct {
	StepIndex     int           `json:"stepIndex"`
	TxID          string        `json:"txId"`
	Op            OperationType `json:"op"`
	Account       string        `json:"account"`
	ObservedValue *float64      `json:"observedValue,omitempty"`
	WrittenValue  *float64      `json:"writtenValue,omitempty"`
	Status        string        `json:"status"` // SUCCESS, BLOCKED_WAIT, TIMEOUT, ROLLED_BACK
	DurationMs    int64         `json:"durationMs"`
	Detail        string        `json:"detail"`
}

// SimulationRequest is the payload sent from the frontend.
type SimulationRequest struct {
	TxCount     int                    `json:"txCount"`
	Schedule    []TimelineStep         `json:"schedule"`
	ControlMode ConcurrencyControlMode `json:"controlMode"` // NONE, STRICT_2PL, HIGH_ISOLATION
	Isolation   IsolationLevel         `json:"isolation"`   // Default: READ COMMITTED
}

// SimulationResult is the full response sent back to the frontend.
type SimulationResult struct {
	Analysis      AnalysisResult     `json:"analysis"`
	ExecutionLogs []ExecutionStepLog `json:"executionLogs"`
	FinalAccounts []Account          `json:"finalAccounts"`
	ExecutionTime int64              `json:"executionTimeMs"`
	Resolved      bool               `json:"resolved"`
	ResolutionMsg string             `json:"resolutionMsg"`
}
