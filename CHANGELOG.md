# Changelog

All notable changes to the **goBankV2** Concurrency Control & Serialization Hazard Simulator project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-12

### Added
- **System Environment & Runtime Stack**:
  - Installed and verified **Go 1.27.0 (amd64)** runtime environment.
  - Installed and initialized **Oracle MySQL Server 8.4.9 (InnoDB engine)** with default port `3306`.
  - Added Go and MySQL binaries to system and user PATH variables.
- **Database Architecture & Seed Data**:
  - Created `gobank_sim` database schema with InnoDB row-level locking support (`db/schema.sql`).
  - Implemented `accounts` table with Accounts A, B, and C initialized to $1,000.00 each.
  - Implemented `simulation_logs` table for tracking operations, step latencies, observed values, and lock-wait states.
- **Go Backend Core Engine (`internal/`)**:
  - `internal/models/models.go`: Defined typed structures for `TimelineStep`, `DetectedHazard`, `PrecedenceEdge`, `AnalysisResult`, `ExecutionStepLog`, and `SimulationResult`.
  - `internal/analyzer/analyzer.go`: Built the formal Conflict Serializability Engine:
    - Directed Precedence (Serialization) Graph $P(S)$ generator.
    - DFS 3-color Cycle Detection for identifying serialization dependency loops.
    - Hazard anomaly classifiers for **Dirty Reads** (G1), **Lost Updates** (P4), **Non-Repeatable Reads** (Fuzzy reads), and **Write Skew**.
    - Safe schedule generator for Strict Two-Phase Locking (S2PL).
  - `internal/analyzer/analyzer_test.go`: Comprehensive unit tests verifying Dirty Read, Lost Update, and serialization cycle detection.
  - `internal/database/db.go`: Step-synchronized multi-goroutine transaction worker pool managing dedicated `*sql.Conn` instances per transaction with row-level lock tracking (`FOR UPDATE`), context timeout detection, and account balance restoration.
  - `internal/server/server.go`: REST API endpoints:
    - `GET /api/accounts`: Real-time account balances.
    - `POST /api/reset`: Clean database reset to $1,000 baseline.
    - `POST /api/analyze`: Static schedule and hazard inspection.
    - `POST /simulate`: Live database execution against MySQL InnoDB.
    - `POST /execute-safe`: Concurrency conflict resolution enforcing Strict Two-Phase Locking (S2PL) with row-level locks (`SELECT ... FOR UPDATE`) and `SERIALIZABLE` isolation.
  - **Phase 5 Concurrency Control & Deadlock Handling**:
    - **Deadlock Detection (MySQL Error 1213)**: Interleaved concurrent execution allows InnoDB to identify circular wait-for dependencies in real time.
    - **Automatic Victim Rollback**: Go backend catches Error 1213, rolls back the victim transaction cleanly, and surfaces the `DEADLOCK_ROLLED_BACK` event with explanatory messaging.
    - **Dynamic Button Transformation**: "Simulate Schedule" button dynamically morphs into "Fix Problem (Apply Strict 2PL)" upon anomaly detection.
    - **Visual Trace Logs**: Status badges for `⚠️ DEADLOCK ROLLED BACK`, `⏳ LOCK WAIT`, and `✓ SUCCESS` with microsecond-level query latencies.
    - **Educational Presets**: Dropdown covering Lost Update (P4), Dirty Read (G1), Non-Repeatable Read, Write Skew, Serialization Cycle / Deadlock, and Safe Serial schedules.
  - `main.go`: Server entrypoint with environment variable configuration and graceful startup.
- **Frontend UI & Visualization (`static/`)**:
  - Modern, responsive dark-mode interface with glassmorphism, glowing accents, and high-contrast typography (`Plus Jakarta Sans` and `JetBrains Mono`).
  - **Transaction Concurrency Selector**: Dynamic switching between 1, 2, 3, and 4 concurrent transactions ($T_1 \dots T_4$).
  - **HTML5 Drag-and-Drop Palette**: Read (`SELECT`), Write (`UPDATE`), Commit, and Rollback blocks configurable by target account and delta amounts.
  - **Educational Preset Scenarios**: Instant loading of Lost Update, Dirty Read, Non-Repeatable Read, Write Skew, Deadlock Cycle, and Safe Serial schedules.
  - **Dynamic Action Button**: Automatically shifts from blue "Simulate Schedule" to an animated glowing "Fix Problem (Strict 2PL)" button when hazards are detected.
  - **Live SVG Precedence Graph**: Visualizes transaction nodes ($T_1 \dots T_4$) and directed conflict dependency edges.
  - **Live MySQL InnoDB Trace Console**: Real-time log entries showing step-by-step SQL operations, row-level locks, observed balances, and lock wait timeouts.
- **Comprehensive Documentation**:
  - `README.md`: Detailed prerequisites, installation instructions, architecture overview, API specifications, and troubleshooting guide.
  - `CHANGELOG.md`: Detailed history of changes and milestones.
