package analyzer

import (
	"testing"

	"goBankV2/internal/models"
)

// Preset 1: Lost Update
func TestLostUpdateDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 3, Amount: 200},
		{ID: "4", TxID: "T2", Op: models.OpWrite, Account: "A", StepIndex: 4, Amount: -200},
		{ID: "5", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 5},
		{ID: "6", TxID: "T2", Op: models.OpCommit, Account: "A", StepIndex: 6},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, got none")
	}

	found := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardLostUpdate {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected Lost Update hazard, got %+v", res.Hazards)
	}
}

// Preset 2: Dirty Read
func TestDirtyReadDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1, Amount: 500},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T1", Op: models.OpRollback, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T2", Op: models.OpCommit, Account: "A", StepIndex: 4},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, but found none")
	}

	found := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardDirtyRead {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected Dirty Read hazard, got %+v", res.Hazards)
	}
}

// Preset 3: Non-Repeatable Read
func TestNonRepeatableReadDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpWrite, Account: "A", StepIndex: 2, Amount: 300},
		{ID: "3", TxID: "T2", Op: models.OpCommit, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 4},
		{ID: "5", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 5},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, got none")
	}

	found := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardNonRepeatableRead {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected Non-Repeatable Read hazard, got %+v", res.Hazards)
	}
}

// Preset 4: Write Skew Anomaly
func TestWriteSkewDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T1", Op: models.OpRead, Account: "B", StepIndex: 2},
		{ID: "3", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T2", Op: models.OpRead, Account: "B", StepIndex: 4},
		{ID: "5", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 5, Amount: -300},
		{ID: "6", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 6, Amount: -300},
		{ID: "7", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 7},
		{ID: "8", TxID: "T2", Op: models.OpCommit, Account: "B", StepIndex: 8},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, got none")
	}

	found := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardWriteSkew {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected Write Skew hazard, got %+v", res.Hazards)
	}
}

// Preset 5: Cascading Rollback
func TestCascadingRollbackDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1, Amount: 300},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 3, Amount: 200},
		{ID: "4", TxID: "T1", Op: models.OpRollback, Account: "A", StepIndex: 4},
		{ID: "5", TxID: "T2", Op: models.OpCommit, Account: "B", StepIndex: 5},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, got none")
	}

	foundDirtyRead := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardDirtyRead {
			foundDirtyRead = true
			break
		}
	}
	if !foundDirtyRead {
		t.Errorf("Expected Dirty Read (cascading) hazard, got %+v", res.Hazards)
	}
}

// Preset 6: 2-Way Deadlock Cycle
func Test2WayDeadlockDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1, Amount: 200},
		{ID: "2", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 2, Amount: 200},
		{ID: "3", TxID: "T1", Op: models.OpWrite, Account: "B", StepIndex: 3, Amount: 200},
		{ID: "4", TxID: "T2", Op: models.OpWrite, Account: "A", StepIndex: 4, Amount: 200},
	}

	res := AnalyzeSchedule(schedule)
	if !res.CycleDetected {
		t.Errorf("Expected 2-way deadlock cycle detection, got none")
	}
	if res.IsSerializable {
		t.Errorf("Expected non-serializable verdict")
	}
}

// Preset 7: 3-Way Circular Deadlock
func Test3WayDeadlockDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1, Amount: 100},
		{ID: "2", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 2, Amount: 100},
		{ID: "3", TxID: "T3", Op: models.OpWrite, Account: "C", StepIndex: 3, Amount: 100},
		{ID: "4", TxID: "T1", Op: models.OpWrite, Account: "B", StepIndex: 4, Amount: 100},
		{ID: "5", TxID: "T2", Op: models.OpWrite, Account: "C", StepIndex: 5, Amount: 100},
		{ID: "6", TxID: "T3", Op: models.OpWrite, Account: "A", StepIndex: 6, Amount: 100},
	}

	res := AnalyzeSchedule(schedule)
	if !res.CycleDetected {
		t.Errorf("Expected 3-way circular deadlock detection, got none")
	}
	if res.IsSerializable {
		t.Errorf("Expected non-serializable verdict")
	}
}

// Preset 8: 4-Way Deadlock Ring
func Test4WayDeadlockDetection(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1, Amount: 100},
		{ID: "2", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 2, Amount: 100},
		{ID: "3", TxID: "T3", Op: models.OpWrite, Account: "C", StepIndex: 3, Amount: 100},
		{ID: "4", TxID: "T4", Op: models.OpWrite, Account: "A", StepIndex: 4, Amount: -100},
		{ID: "5", TxID: "T1", Op: models.OpWrite, Account: "B", StepIndex: 5, Amount: 100},
		{ID: "6", TxID: "T2", Op: models.OpWrite, Account: "C", StepIndex: 6, Amount: 100},
		{ID: "7", TxID: "T3", Op: models.OpWrite, Account: "A", StepIndex: 7, Amount: 100},
		{ID: "8", TxID: "T4", Op: models.OpWrite, Account: "B", StepIndex: 8, Amount: 100},
	}

	res := AnalyzeSchedule(schedule)
	if !res.CycleDetected {
		t.Errorf("Expected 4-way deadlock cycle detection, got none")
	}
}

// Preset 9: Safe Serial Pipeline
func TestSafeSerialPipeline(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 2, Amount: -150},
		{ID: "3", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 4},
		{ID: "5", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 5, Amount: 150},
		{ID: "6", TxID: "T2", Op: models.OpCommit, Account: "B", StepIndex: 6},
		{ID: "7", TxID: "T3", Op: models.OpRead, Account: "B", StepIndex: 7},
		{ID: "8", TxID: "T3", Op: models.OpCommit, Account: "B", StepIndex: 8},
	}

	res := AnalyzeSchedule(schedule)
	if res.CycleDetected {
		t.Errorf("Expected acyclic graph, but cycle detected")
	}
	if !res.IsSerializable {
		t.Errorf("Expected safe serial pipeline to be serializable, got hazards: %+v", res.Hazards)
	}
}

// Preset 10: Disjoint Accounts
func TestDisjointAccounts(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "B", StepIndex: 2},
		{ID: "3", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 3, Amount: 150},
		{ID: "4", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 4, Amount: -150},
		{ID: "5", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 5},
		{ID: "6", TxID: "T2", Op: models.OpCommit, Account: "B", StepIndex: 6},
	}

	res := AnalyzeSchedule(schedule)
	if len(res.PrecedenceEdges) > 0 {
		t.Errorf("Expected 0 conflict edges for disjoint accounts, got %d", len(res.PrecedenceEdges))
	}
	if !res.IsSerializable {
		t.Errorf("Expected disjoint accounts to be serializable")
	}
}

// Preset 11: Concurrent Reads (Shared Locks)
func TestConcurrentReads(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T3", Op: models.OpRead, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T1", Op: models.OpRead, Account: "B", StepIndex: 4},
		{ID: "5", TxID: "T2", Op: models.OpRead, Account: "B", StepIndex: 5},
		{ID: "6", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 6},
		{ID: "7", TxID: "T2", Op: models.OpCommit, Account: "B", StepIndex: 7},
		{ID: "8", TxID: "T3", Op: models.OpCommit, Account: "A", StepIndex: 8},
	}

	res := AnalyzeSchedule(schedule)
	if len(res.PrecedenceEdges) > 0 {
		t.Errorf("Expected 0 conflict edges for concurrent reads, got %d", len(res.PrecedenceEdges))
	}
	if !res.IsSerializable {
		t.Errorf("Expected concurrent reads to be serializable")
	}
}

// Preset 12: Transfer Chain
func TestTransferChain(t *testing.T) {
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 2, Amount: -100},
		{ID: "3", TxID: "T1", Op: models.OpRead, Account: "B", StepIndex: 3},
		{ID: "4", TxID: "T1", Op: models.OpWrite, Account: "B", StepIndex: 4, Amount: 100},
		{ID: "5", TxID: "T1", Op: models.OpCommit, Account: "B", StepIndex: 5},
		{ID: "6", TxID: "T2", Op: models.OpRead, Account: "B", StepIndex: 6},
		{ID: "7", TxID: "T2", Op: models.OpWrite, Account: "B", StepIndex: 7, Amount: -100},
		{ID: "8", TxID: "T2", Op: models.OpRead, Account: "C", StepIndex: 8},
		{ID: "9", TxID: "T2", Op: models.OpWrite, Account: "C", StepIndex: 9, Amount: 100},
		{ID: "10", TxID: "T2", Op: models.OpCommit, Account: "C", StepIndex: 10},
		{ID: "11", TxID: "T3", Op: models.OpRead, Account: "C", StepIndex: 11},
		{ID: "12", TxID: "T3", Op: models.OpCommit, Account: "C", StepIndex: 12},
	}

	res := AnalyzeSchedule(schedule)
	if res.CycleDetected {
		t.Errorf("Expected acyclic graph for sequential transfer chain, but cycle detected")
	}
	if !res.IsSerializable {
		t.Errorf("Expected transfer chain to be serializable")
	}
}
