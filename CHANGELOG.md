# Changelog

All notable changes to the **goBankV2** Concurrency Control & Serialization Hazard Simulator project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-12

### Added
- **Phase 8: Offline Tailwind CSS Architecture**:
  - **100% Offline Standalone Tailwind CLI Setup**: Configured local compiling pipeline (`tailwind.config.js` and `static/css/input.css` -> `static/css/output.css`) eliminating external CDN dependencies.
  - **Fully Refactored Responsive HTML UI**: Migrated `index.html` to utility classes with responsive grid layouts (`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`) for timeline cards.
  - **Tailwind Horizontal Sliders & Snap**: Styled timeline step tracks with `overflow-x-auto scroll-smooth snap-x snap-mandatory` and custom scrollbars.
  - **Fade-Out Transition Deletion**: Integrated Tailwind transition utilities (`transition-opacity duration-300 opacity-0 scale-75 -translate-y-2`) for out-of-bounds drops.
  - **Go Static Asset Verification**: Validated `http.FileServer` serving of `output.css` via local loopback.

---

## [1.1.0] - 2026-10-12

### Added
- **Phase 7: Advanced UI Refactoring & Dynamic Steps**:
  - **Dynamic Step Addition (`+ Add Step`)**: Added dynamic step button at the end of every timeline (T1..T4), appending empty drop-zone slots on demand with automatic Step $N+1$ numbering.
  - **Smooth Horizontal Slider & CSS Scroll Snapping**: Implemented `overflow-x: auto`, `scroll-behavior: smooth`, and `scroll-snap-type: x mandatory` with slim neon-themed scrollbars for T1..T4 containers to prevent layout breakage on long schedules.
  - **Out-of-Bounds Drag Deletion**: Dragging a placed operation block out of any valid timeline drop-zone triggers an animated fade-out transition, deletes the block from the DOM, and immediately updates global sequence tracking.
  - **Dynamic Timeline Bar Synchronization**: Global step marker bar dynamically scales to match the longest timeline track and scrolls smoothly.
  - **Backend Payload Validation**: Verified and fortified `SimulationRequest` handling in Go to safely handle variable-length step slices with defensive size validation.

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
    - **Educational Presets for 1, 2, 3, & 4 Transactions**:
      - **1 Tx**: Atomic Account Transfer (A → B) & Aborted Overdraft Rollback.
      - **2 Tx**: Lost Update (P4), Dirty Read (G1), Non-Repeatable Read, Write Skew, Serialization Cycle / 2-Way Deadlock, and Safe Serial.
      - **3 Tx**: 3-Way Circular Deadlock ($T_1 \to T_2 \to T_3 \to T_1$), Cascading Dirty Read & Inconsistent Analysis, and Serialized Pipeline.
      - **4 Tx**: 4-Way Distributed Deadlock Ring, Multi-Hazard Storm (simultaneous Lost Update on A and Dirty Read on B), and Safe Batch Settlement.
    - **Adaptive Concurrency Switching**: Changing the transaction count automatically switches timeline rows and loads representative scenarios.
  - **Windows PC Compatibility & Zero-Config Auto-Provisioning**:
    - **Zero-Config Database Auto-Provisioning (`database.AutoInitAndConnect`)**: Server automatically verifies server connection, creates `gobank_sim` database, builds InnoDB tables, and seeds default accounts without requiring manual SQL file imports.
    - **Windows Diagnostics**: Actionable error reporting on common Windows connection pitfalls (e.g. MySQL Windows service stopped, password mismatch, port conflict).
    - **Clean Cross-Platform Repository Structure**: Removed local shell scripts; added `.bat`, `.cmd`, and `.ps1` to `.gitignore` to keep repository clean and cross-platform.
    - **Windows-Specific Documentation (`README.md`)**: Comprehensive guide covering winget installation for Go and MySQL, Windows PowerShell environment variables, and Windows troubleshooting.
- **Frontend UI & Visualization (`static/`)**:
  - Modern, responsive dark-mode interface with glassmorphism, glowing accents, and high-contrast typography (`Plus Jakarta Sans` and `JetBrains Mono`).
  - **Transaction Concurrency Selector**: Dynamic switching between 1, 2, 3, and 4 concurrent transactions ($T_1 \dots T_4$).
  - **HTML5 Drag-and-Drop Palette**: Read (`SELECT`), Write (`UPDATE`), Commit, and Rollback blocks configurable by target account and delta amounts.
  - **Educational Preset Scenarios**: Instant loading of 1, 2, 3, and 4 transaction scenarios with organized `<optgroup>` selector.
  - **Dynamic Action Button**: Automatically shifts from blue "Simulate Schedule" to an animated glowing "Fix Problem (Strict 2PL)" button when hazards are detected.
  - **Live SVG Precedence Graph**: Visualizes transaction nodes ($T_1 \dots T_4$) and directed conflict dependency edges.
  - **Live MySQL InnoDB Trace Console**: Real-time log entries showing step-by-step SQL operations, row-level locks, observed balances, and lock wait timeouts.
- **Comprehensive Documentation**:
  - `README.md`: Detailed Windows prerequisites, installation instructions, architecture overview, API specifications, and troubleshooting guide.
  - `CHANGELOG.md`: Detailed history of changes and milestones.
