package analyzer

import (
	"testing"

	"goBankV2/internal/models"
)

func TestDirtyReadDetection(t *testing.T) {
	// Schedule:
	// T1: W(A) [step 1]
	// T2: R(A) [step 2] (before T1 commits)
	// T1: COMMIT [step 3]
	// T2: COMMIT [step 4]
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T1", Op: models.OpCommit, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T2", Op: models.OpCommit, Account: "A", StepIndex: 4},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, but found none")
	}

	foundDirtyRead := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardDirtyRead {
			foundDirtyRead = true
			break
		}
	}

	if !foundDirtyRead {
		t.Errorf("Expected Dirty Read hazard, got %+v", res.Hazards)
	}
}

func TestLostUpdateDetection(t *testing.T) {
	// Schedule:
	// T1: R(A) [step 1]
	// T2: R(A) [step 2]
	// T1: W(A) [step 3]
	// T2: W(A) [step 4]
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpRead, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T1", Op: models.OpWrite, Account: "A", StepIndex: 3},
		{ID: "4", TxID: "T2", Op: models.OpWrite, Account: "A", StepIndex: 4},
	}

	res := AnalyzeSchedule(schedule)
	if !res.HasHazards {
		t.Fatalf("Expected hazards, but found none")
	}

	foundLostUpdate := false
	for _, h := range res.Hazards {
		if h.Type == models.HazardLostUpdate {
			foundLostUpdate = true
			break
		}
	}

	if !foundLostUpdate {
		t.Errorf("Expected Lost Update hazard, got %+v", res.Hazards)
	}
}

func TestCycleDetection(t *testing.T) {
	// Schedule with cycle:
	// T1: R(A) [step 1]
	// T2: W(A) [step 2] -> edge T1 -> T2
	// T2: R(B) [step 3]
	// T1: W(B) [step 4] -> edge T2 -> T1
	schedule := []models.TimelineStep{
		{ID: "1", TxID: "T1", Op: models.OpRead, Account: "A", StepIndex: 1},
		{ID: "2", TxID: "T2", Op: models.OpWrite, Account: "A", StepIndex: 2},
		{ID: "3", TxID: "T2", Op: models.OpRead, Account: "B", StepIndex: 3},
		{ID: "4", TxID: "T1", Op: models.OpWrite, Account: "B", StepIndex: 4},
	}

	res := AnalyzeSchedule(schedule)
	if !res.CycleDetected {
		t.Errorf("Expected cycle detection, got none")
	}
	if res.IsSerializable {
		t.Errorf("Expected schedule to be non-serializable")
	}
}
