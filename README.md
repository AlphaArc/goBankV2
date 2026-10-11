# goBankV2 - Concurrency Control & Serialization Hazard Simulator

An interactive, educational DBMS visualization tool designed to demonstrate transaction anomalies, conflict serializability, and concurrency control protocols (such as Strict 2-Phase Locking and SQL Transaction Isolation Levels) in a banking system context.

---

## Features

- **Dynamic Concurrent Transactions:** Configure and visualize between 1 and 4 concurrent transactions ($T_1 \dots T_4$).
- **Interactive Drag-and-Drop Timeline:** Construct custom schedules with atomic `READ`, `WRITE`, `COMMIT`, and `ROLLBACK` operation blocks on accounts (A, B, C).
- **Hazard & Conflict Detection Engine:**
  - Real-time serialization graph (precedence graph) construction.
  - Automatic detection of cycles and classification of classical DBMS hazards:
    - **Dirty Reads** (G1 / uncommitted reads)
    - **Lost Updates** (P4 / blind overwrites & read-modify-write conflicts)
    - **Non-Repeatable Reads** (Fuzzy reads)
    - **Write Skew** (Constraint violations across multiple rows)
- **"Fix Problem" Concurrency Control:**
  - Dynamic transition to safe execution flows.
  - Applies **Strict 2PL** (`SELECT ... FOR UPDATE` exclusive locks) or appropriate isolation levels (`REPEATABLE READ`, `SERIALIZABLE`).
- **Live Database & Step-by-Step Execution:**
  - Synchronous coordination barrier in Go managing dedicated MySQL connections per transaction.
  - Visual lock-wait and blocking indicators when transactions contend for the same rows.

---

## Prerequisites & Dependencies

To run the stack locally, ensure the following dependencies are installed on your machine:

### 1. Go (Golang)
- **Version:** Go 1.21 or higher (Recommended: Go 1.22+)
- **Verification:**
  ```powershell
  go version
  ```
- **Installation:**
  - Windows: `winget install GoLang.Go` or download from [golang.org/dl](https://go.dev/dl/).
  - Linux/macOS: Use `brew install go` or your distribution package manager (`apt install golang-go`).

### 2. MySQL Server
- **Version:** MySQL 8.0+ or MariaDB 10.5+ (Must support the **InnoDB** storage engine).
- **Default Port:** `3306`
- **Verification:**
  ```powershell
  mysql --version
  ```
- **Installation:**
  - Windows: `winget install Oracle.MySQL` or via [MySQL Community Server](https://dev.mysql.com/downloads/mysql/).
  - Alternative: Docker container (see below).

#### (Optional) Running MySQL via Docker:
If you prefer not to install MySQL directly on your host:
```bash
docker run --name gobank-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=gobank_sim -p 3306:3306 -d mysql:8.0
```

### 3. Modern Web Browser
- Google Chrome, Microsoft Edge, Firefox, or Safari supporting HTML5 Drag & Drop API, ES6+, and CSS Grid/Flexbox.

---

## Database Initialization

Initialize the database schema and default account records before starting the application:

```bash
# Log in to MySQL and run the schema script:
mysql -u root -p < db/schema.sql
```

Default accounts created:
- Account **A** (Alice Springs): $1,000.00
- Account **B** (Bob Vance): $1,000.00
- Account **C** (Charlie Day): $1,000.00

---

## Project Structure

```
goBankV2/
├── db/
│   └── schema.sql             # MySQL schema & seed data
├── internal/
│   ├── analyzer/              # Precedence graph & conflict detection engine
│   ├── database/              # MySQL connection manager & transaction runner
│   ├── models/                # Step, Timeline, and Conflict data structures
│   └── server/                # HTTP API router & static asset serving
├── static/                    # Frontend client
│   ├── index.html             # Drag-and-drop timeline interface
│   ├── css/
│   │   └── styles.css         # Styling, animations, and visual indicators
│   └── js/
│       ├── app.js             # State coordination & API client
│       └── dragdrop.js        # Timeline drag-and-drop interactions
├── CHANGELOG.md               # Version & milestone history
├── go.mod                     # Go module definition
├── main.go                    # Application entrypoint
└── README.md                  # System overview & setup instructions
```

---

## Running the Application

1. **Clone the repository and navigate into the folder:**
   ```bash
   cd goBankV2
   ```

2. **Configure environment variables (Optional):**
   ```powershell
   $env:DB_USER="root"
   $env:DB_PASS="root"
   $env:DB_HOST="127.0.0.1"
   $env:DB_PORT="3306"
   $env:DB_NAME="gobank_sim"
   $env:PORT="8080"
   ```

3. **Start the Go backend:**
   ```bash
   go run main.go
   ```

4. **Access the visual simulator:**
   Open your browser and navigate to `http://localhost:8080`.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/accounts` | Returns current balances for Accounts A, B, and C. |
| `POST` | `/api/reset` | Resets all bank account balances to $1,000.00 baseline. |
| `POST` | `/api/analyze` | Evaluates schedule serializability and returns precedence graph without DB changes. |
| `POST` | `/simulate` | Executes schedule concurrently on MySQL InnoDB, logging raw lock behaviors and deadlocks. |
| `POST` | `/execute-safe` | Resolves serialization conflicts by applying Strict Two-Phase Locking (S2PL) with `SELECT ... FOR UPDATE`. |

---

## Concurrency Controls & Deadlock Resolution

- **Strict Two-Phase Locking (Strict 2PL)**:
  - All read operations on conflicting accounts acquire exclusive row locks (`SELECT ... FOR UPDATE`).
  - All updates hold row-level exclusive locks until the transaction explicitly executes `COMMIT`.
  - Cascading aborts and dirty reads are prevented.
- **Deadlock Handling (MySQL InnoDB Error 1213)**:
  - When circular lock dependencies occur (e.g. $T_1$ holds A and requests B, while $T_2$ holds B and requests A), MySQL's InnoDB deadlock engine detects the cycle.
  - The Go backend catches Error 1213, automatically rolls back the chosen victim transaction, and issues a clean state restoration.
  - The UI highlights the victim transaction with a `DEADLOCK ROLLED BACK` badge and notifies the user.
- **Educational Presets (1, 2, 3, & 4 Concurrent Transactions)**:
  - **1 Transaction**:
    - **Atomic Account Transfer (A → B)**: Atomic transfer with ACID consistency.
    - **Aborted Overdraft Rollback**: Premature abort rolling back local balance changes.
  - **2 Transactions**:
    - **Lost Update (P4 Conflict)**: Interleaved read-modify-write resulting in an overwritten balance.
    - **Dirty Read (G1 Hazard)**: Reading uncommitted state from an aborted transaction.
    - **Non-Repeatable Read**: Re-reading modified and committed data within an open transaction.
    - **Write Skew**: Snapshot anomaly across multiple related records.
    - **Serialization Cycle**: Circular lock dependencies triggering real MySQL Error 1213 deadlocks.
    - **Safe Serial**: Clean, serial execution with zero hazards.
  - **3 Transactions**:
    - **3-Way Circular Deadlock ($T_1 \to T_2 \to T_3 \to T_1$)**: Circular lock contention across 3 accounts ($A, B, C$) resolved by InnoDB deadlock detection.
    - **Cascading Dirty Read**: $T_2$ reads uncommitted $T_1$, $T_3$ reads tainted $T_2$, and $T_1$ aborts.
    - **Serialized Pipeline**: Multi-stage transfer and balance audit pipeline.
  - **4 Transactions**:
    - **4-Way Distributed Deadlock Ring**: Multi-hop lock contention cycle spanning 4 concurrent workers.
    - **Multi-Hazard Storm**: Simultaneous Lost Update on Account $A$ and Dirty Read on Account $B$.
    - **Concurrent Batch Settlement**: High-concurrency safe serialized schedule.
