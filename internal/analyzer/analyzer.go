package analyzer

import (
	"fmt"
	"sort"
	"strings"

	"goBankV2/internal/models"
)

// AnalyzeSchedule performs static conflict and hazard analysis on a timeline.
func AnalyzeSchedule(schedule []models.TimelineStep) models.AnalysisResult {
	// 1. Sort schedule by StepIndex ascending
	steps := make([]models.TimelineStep, len(schedule))
	copy(steps, schedule)
	sort.Slice(steps, func(i, j int) bool {
		return steps[i].StepIndex < steps[j].StepIndex
	})

	result := models.AnalysisResult{
		IsSerializable:  true,
		HasHazards:      false,
		PrecedenceEdges: []models.PrecedenceEdge{},
		Hazards:         []models.DetectedHazard{},
	}

	if len(steps) == 0 {
		return result
	}

	// 2. Build Precedence Graph (Conflict Serializability)
	edgeMap := make(map[string]bool)
	adjList := make(map[string][]string)
	allTxMap := make(map[string]bool)

	for _, step := range steps {
		allTxMap[step.TxID] = true
	}

	for i := 0; i < len(steps); i++ {
		opI := steps[i]
		if opI.Op != models.OpRead && opI.Op != models.OpWrite {
			continue
		}

		for j := i + 1; j < len(steps); j++ {
			opJ := steps[j]
			if opJ.Op != models.OpRead && opJ.Op != models.OpWrite {
				continue
			}

			// Different transactions and same data item
			if opI.TxID != opJ.TxID && opI.Account == opJ.Account {
				// At least one operation must be a WRITE for a conflict
				if opI.Op == models.OpWrite || opJ.Op == models.OpWrite {
					edgeKey := fmt.Sprintf("%s->%s:%s:%s-%s", opI.TxID, opJ.TxID, opI.Account, opI.Op, opJ.Op)
					if !edgeMap[edgeKey] {
						edgeMap[edgeKey] = true
						adjList[opI.TxID] = append(adjList[opI.TxID], opJ.TxID)

						var reason string
						if opI.Op == models.OpWrite && opJ.Op == models.OpRead {
							reason = fmt.Sprintf("Write-Read Conflict on Account %s (%s writes at step %d, %s reads at step %d)", opI.Account, opI.TxID, opI.StepIndex, opJ.TxID, opJ.StepIndex)
						} else if opI.Op == models.OpRead && opJ.Op == models.OpWrite {
							reason = fmt.Sprintf("Read-Write Conflict on Account %s (%s reads at step %d, %s writes at step %d)", opI.Account, opI.TxID, opI.StepIndex, opJ.TxID, opJ.StepIndex)
						} else {
							reason = fmt.Sprintf("Write-Write Conflict on Account %s (%s writes at step %d, %s writes at step %d)", opI.Account, opI.TxID, opI.StepIndex, opJ.TxID, opJ.StepIndex)
						}

						result.PrecedenceEdges = append(result.PrecedenceEdges, models.PrecedenceEdge{
							FromTx:     opI.TxID,
							ToTx:       opJ.TxID,
							ConflictOp: opI.Op,
							Account:    opI.Account,
							Reason:     reason,
						})
					}
				}
			}
		}
	}

	// 3. Cycle Detection in Precedence Graph (DFS 3-color: 0=unvisited, 1=visiting, 2=visited)
	visited := make(map[string]int)
	var cycleNodes []string
	hasCycle := false

	var dfs func(u string, path []string) bool
	dfs = func(u string, path []string) bool {
		visited[u] = 1 // visiting
		path = append(path, u)

		for _, v := range adjList[u] {
			if visited[v] == 1 {
				// Cycle detected! Extract exact cycle sub-path starting at v
				hasCycle = true
				cycleStart := -1
				for idx, node := range path {
					if node == v {
						cycleStart = idx
						break
					}
				}
				if cycleStart >= 0 {
					cycleNodes = append([]string{}, path[cycleStart:]...)
				} else {
					cycleNodes = append([]string{}, path...)
				}
				return true
			}
			if visited[v] == 0 {
				if dfs(v, path) {
					return true
				}
			}
		}
		visited[u] = 2 // finished
		return false
	}

	// Deterministic traversal over sorted transaction identifiers
	sortedTxs := make([]string, 0, len(allTxMap))
	for tx := range allTxMap {
		sortedTxs = append(sortedTxs, tx)
	}
	sort.Strings(sortedTxs)

	for _, tx := range sortedTxs {
		if visited[tx] == 0 {
			if dfs(tx, []string{}) {
				break
			}
		}
	}

	if hasCycle {
		result.IsSerializable = false
		result.CycleDetected = true
		result.CycleNodes = uniqueStrings(cycleNodes)
		result.Hazards = append(result.Hazards, models.DetectedHazard{
			Type:         models.HazardCycleConflict,
			Title:        "Serialization Dependency Cycle Detected",
			Description:  fmt.Sprintf("A directed dependency cycle exists among transactions (%s). This schedule is NOT conflict serializable and will cause race conditions or deadlocks.", strings.Join(result.CycleNodes, " <-> ")),
			Severity:     "CRITICAL",
			Transactions: result.CycleNodes,
			FixHint:      "Apply Strict 2PL or force a serial order so all transactions acquire exclusive locks before committing.",
		})
	}

	// 4. Detailed Hazard Pattern Classification
	detectDirtyReads(steps, &result)
	detectLostUpdates(steps, &result)
	detectNonRepeatableReads(steps, &result)
	detectWriteSkew(steps, &result)

	if len(result.Hazards) > 0 {
		result.HasHazards = true
		result.IsSerializable = false
		result.SafePlanHint = "To eliminate these hazards, serialize conflicting read/write segments using Strict 2-Phase Locking (S2PL) or elevate the MySQL transaction isolation level to REPEATABLE READ with SELECT ... FOR UPDATE."
	} else {
		result.SafePlanHint = "Schedule is Conflict Serializable! No uncommitted dependencies or race conditions detected."
	}

	return result
}

// detectDirtyReads flags when Tx2 reads uncommitted modifications by Tx1.
func detectDirtyReads(steps []models.TimelineStep, res *models.AnalysisResult) {
	// Find commit steps for each transaction
	commitStep := make(map[string]int)
	for _, s := range steps {
		if s.Op == models.OpCommit {
			commitStep[s.TxID] = s.StepIndex
		}
	}

	reported := make(map[string]bool)

	for i := 0; i < len(steps); i++ {
		w := steps[i]
		if w.Op != models.OpWrite {
			continue
		}

		cStep, hasCommit := commitStep[w.TxID]
		for j := i + 1; j < len(steps); j++ {
			r := steps[j]
			if r.Op != models.OpRead || r.TxID == w.TxID || r.Account != w.Account {
				continue
			}

			key := fmt.Sprintf("%s-%s-%s", w.TxID, r.TxID, w.Account)
			if reported[key] {
				continue
			}

			// r reads before w commits, or w never commits
			if !hasCommit || r.StepIndex < cStep {
				reported[key] = true
				res.Hazards = append(res.Hazards, models.DetectedHazard{
					Type:         models.HazardDirtyRead,
					Title:        fmt.Sprintf("Dirty Read on Account %s", w.Account),
					Description:  fmt.Sprintf("Transaction %s reads Account %s at Step %d before %s's Write at Step %d is committed. If %s aborts or fails, %s has read uncommitted phantom state.", r.TxID, w.Account, r.StepIndex, w.TxID, w.StepIndex, w.TxID, r.TxID),
					Severity:     "CRITICAL",
					Transactions: []string{w.TxID, r.TxID},
					InvolvedStep: []int{w.StepIndex, r.StepIndex},
					Account:      w.Account,
					FixHint:      "Hold exclusive write locks until COMMIT (Strict 2PL), or upgrade isolation to READ COMMITTED / REPEATABLE READ.",
				})
			}
		}
	}
}

// detectLostUpdates flags when concurrent transactions read same value and overwrite each other.
func detectLostUpdates(steps []models.TimelineStep, res *models.AnalysisResult) {
	// Pattern: R1(X) ... R2(X) ... W1(X) ... W2(X)
	reported := make(map[string]bool)

	for i := 0; i < len(steps); i++ {
		r1 := steps[i]
		if r1.Op != models.OpRead {
			continue
		}

		for j := i + 1; j < len(steps); j++ {
			r2 := steps[j]
			if r2.Op != models.OpRead || r2.TxID == r1.TxID || r2.Account != r1.Account {
				continue
			}

			key := fmt.Sprintf("%s-%s-%s", r1.TxID, r2.TxID, r1.Account)
			if reported[key] {
				continue
			}

			// Now look for W1(X) and W2(X) after both reads
			found := false
			for k := j + 1; k < len(steps); k++ {
				w1 := steps[k]
				if w1.Op != models.OpWrite || w1.TxID != r1.TxID || w1.Account != r1.Account {
					continue
				}

				for l := k + 1; l < len(steps); l++ {
					w2 := steps[l]
					if w2.Op == models.OpWrite && w2.TxID == r2.TxID && w2.Account == r1.Account {
						reported[key] = true
						res.Hazards = append(res.Hazards, models.DetectedHazard{
							Type:         models.HazardLostUpdate,
							Title:        fmt.Sprintf("Lost Update on Account %s", r1.Account),
							Description:  fmt.Sprintf("Both %s (Step %d) and %s (Step %d) read Account %s. Then %s writes at Step %d, but %s subsequently overwrites it at Step %d. %s's update is completely lost!", r1.TxID, r1.StepIndex, r2.TxID, r2.StepIndex, r1.Account, r1.TxID, w1.StepIndex, r2.TxID, w2.StepIndex, r1.TxID),
							Severity:     "CRITICAL",
							Transactions: []string{r1.TxID, r2.TxID},
							InvolvedStep: []int{r1.StepIndex, r2.StepIndex, w1.StepIndex, w2.StepIndex},
							Account:      r1.Account,
							FixHint:      "Use pessimistic row locking (SELECT ... FOR UPDATE) during initial read, preventing concurrent reads until the update commits.",
						})
						found = true
						break
					}
				}
				if found {
					break
				}
			}
		}
	}
}

// detectNonRepeatableReads flags when a single transaction reads X twice with an intervening committed write from another transaction.
func detectNonRepeatableReads(steps []models.TimelineStep, res *models.AnalysisResult) {
	// Pattern: R1(X) ... W2(X) ... C2 ... R1(X)
	for i := 0; i < len(steps); i++ {
		r1 := steps[i]
		if r1.Op != models.OpRead {
			continue
		}

		for j := i + 1; j < len(steps); j++ {
			w2 := steps[j]
			if w2.Op != models.OpWrite || w2.TxID == r1.TxID || w2.Account != r1.Account {
				continue
			}

			for k := j + 1; k < len(steps); k++ {
				r1Second := steps[k]
				if r1Second.Op == models.OpRead && r1Second.TxID == r1.TxID && r1Second.Account == r1.Account {
					res.Hazards = append(res.Hazards, models.DetectedHazard{
						Type:         models.HazardNonRepeatableRead,
						Title:        fmt.Sprintf("Non-Repeatable (Fuzzy) Read on Account %s", r1.Account),
						Description:  fmt.Sprintf("Transaction %s reads Account %s at Step %d. Transaction %s modifies it at Step %d. When %s re-reads Account %s at Step %d, it encounters a different value.", r1.TxID, r1.Account, r1.StepIndex, w2.TxID, w2.StepIndex, r1.TxID, r1.Account, r1Second.StepIndex),
						Severity:     "HIGH",
						Transactions: []string{r1.TxID, w2.TxID},
						InvolvedStep: []int{r1.StepIndex, w2.StepIndex, r1Second.StepIndex},
						Account:      r1.Account,
						FixHint:      "Set transaction isolation level to REPEATABLE READ (standard MySQL InnoDB default with MVCC snapshot reads) or hold shared read locks.",
					})
				}
			}
		}
	}
}

// detectWriteSkew flags concurrent transactions reading intersecting balances and modifying disjoint subsets.
func detectWriteSkew(steps []models.TimelineStep, res *models.AnalysisResult) {
	// Pattern: T1 reads A & B, writes A. T2 reads A & B, writes B.
	readsByTx := make(map[string]map[string]int)
	writesByTx := make(map[string]map[string]int)

	for _, s := range steps {
		if s.Op == models.OpRead {
			if readsByTx[s.TxID] == nil {
				readsByTx[s.TxID] = make(map[string]int)
			}
			readsByTx[s.TxID][s.Account] = s.StepIndex
		} else if s.Op == models.OpWrite {
			if writesByTx[s.TxID] == nil {
				writesByTx[s.TxID] = make(map[string]int)
			}
			writesByTx[s.TxID][s.Account] = s.StepIndex
		}
	}

	txList := make([]string, 0, len(readsByTx))
	for tx := range readsByTx {
		txList = append(txList, tx)
	}

	for i := 0; i < len(txList); i++ {
		for j := i + 1; j < len(txList); j++ {
			t1 := txList[i]
			t2 := txList[j]

			// Check if both read multiple accounts (e.g. A and B)
			commonReads := 0
			for acc := range readsByTx[t1] {
				if _, ok := readsByTx[t2][acc]; ok {
					commonReads++
				}
			}

			if commonReads >= 2 {
				// Check if they write disjoint accounts
				for acc1 := range writesByTx[t1] {
					for acc2 := range writesByTx[t2] {
						if acc1 != acc2 {
							res.Hazards = append(res.Hazards, models.DetectedHazard{
								Type:         models.HazardWriteSkew,
								Title:        fmt.Sprintf("Write Skew Anomaly between %s and %s", t1, t2),
								Description:  fmt.Sprintf("Both %s and %s read shared accounts, but %s writes to %s while %s writes to %s. Concurrent execution can violate global balance constraints.", t1, t2, t1, acc1, t2, acc2),
								Severity:     "HIGH",
								Transactions: []string{t1, t2},
								InvolvedStep: []int{readsByTx[t1][acc1], writesByTx[t1][acc1], readsByTx[t2][acc2], writesByTx[t2][acc2]},
								Account:      fmt.Sprintf("%s, %s", acc1, acc2),
								FixHint:      "Use SERIALIZABLE isolation level or acquire mutual exclusive locks on all checked accounts (SELECT ... FOR UPDATE).",
							})
						}
					}
				}
			}
		}
	}
}

// GenerateSafeSchedule transforms a conflicting schedule into a safe Strict 2PL serialized schedule.
func GenerateSafeSchedule(schedule []models.TimelineStep) ([]models.TimelineStep, string) {
	if len(schedule) == 0 {
		return schedule, "No steps to fix."
	}

	// 1. Group operations by transaction, maintaining intra-transaction relative order
	txSteps := make(map[string][]models.TimelineStep)
	txOrder := []string{}
	seenTx := make(map[string]bool)

	// Preserve the transaction appearance order from the user's timeline
	for _, s := range schedule {
		if !seenTx[s.TxID] {
			seenTx[s.TxID] = true
			txOrder = append(txOrder, s.TxID)
		}
		txSteps[s.TxID] = append(txSteps[s.TxID], s)
	}

	// 2. Strict 2PL enforces serial execution of conflicting transactions or guarantees
	// that a transaction holds locks until COMMIT.
	// For educational visualization, we generate a safe, conflict-free interleaved or serialized schedule
	// where each transaction acquires row locks safely and commits before conflicting successors proceed.
	safeSchedule := make([]models.TimelineStep, 0, len(schedule))
	globalStep := 1

	for _, txID := range txOrder {
		steps := txSteps[txID]
		hasCommit := false
		for _, s := range steps {
			newStep := s
			newStep.StepIndex = globalStep
			globalStep++
			if newStep.Op == models.OpCommit {
				hasCommit = true
			}
			safeSchedule = append(safeSchedule, newStep)
		}

		// Ensure transaction ends with COMMIT if user didn't drop one
		if !hasCommit {
			safeSchedule = append(safeSchedule, models.TimelineStep{
				ID:        fmt.Sprintf("%s_commit_auto", txID),
				TxID:      txID,
				Op:        models.OpCommit,
				Account:   "A",
				StepIndex: globalStep,
			})
			globalStep++
		}
	}

	msg := fmt.Sprintf("Applied Strict Two-Phase Locking (S2PL): Conflicting transactions (%s) now execute within well-defined locking and commit boundaries. Read-Modify-Write dependencies are protected by exclusive locks until commit.", strings.Join(txOrder, ", "))
	return safeSchedule, msg
}

func uniqueStrings(slice []string) []string {
	keys := make(map[string]bool)
	list := []string{}
	for _, entry := range slice {
		if _, value := keys[entry]; !value {
			keys[entry] = true
			list = append(list, entry)
		}
	}
	return list
}
