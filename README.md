# goBankV2 - DBMS Transaction Hazard & Concurrency Visualizer

An interactive, educational DBMS visualization tool designed for students, educators, and evaluators to demonstrate transaction anomalies, conflict serializability, and concurrency control protocols (Strict 2-Phase Locking, Row-Level Locking, and Deadlock Handling) against a live MySQL database.

---

## 💻 Prerequisites (Windows Focus)

To run this project on a Windows PC, install only the following **two** basic dependencies:

### 1. Go (Golang)
* **Official Windows Installer (.msi):** Download and run the 64-bit installer from the official Go portal:  
  👉 **[https://go.dev/dl/](https://go.dev/dl/)**  
  *(Alternative via PowerShell: `winget install GoLang.Go`)*
* **Verify Installation:** Open a new PowerShell or Command Prompt terminal and run:
  ```powershell
  go version
  ```

### 2. MySQL Community Server
* **Official Windows Installer (.msi):** Download the MySQL Community Server or MySQL Installer from:  
  👉 **[https://dev.mysql.com/downloads/installer/](https://dev.mysql.com/downloads/installer/)**  
  *(Alternative via PowerShell: `winget install Oracle.MySQL`)*
* **Verify Service Status:** Ensure MySQL is running on default port `3306`. You can check in Windows Services (`services.msc`) or run:
  ```cmd
  net start MySQL
  ```

*(Any modern web browser like Microsoft Edge, Google Chrome, or Mozilla Firefox is used to interact with the interface).*

---

## 🗄️ Database Setup

### Expected Default Credentials
By default, the Go backend looks for:
* **Host / Port:** `127.0.0.1:3306`
* **User:** `root`
* **Password:** Empty `""` (If your MySQL `root` has a password, see the environment variable section below).
* **Database Name:** `gobank_sim`

> **Note on Zero-Configuration:** On startup, the Go backend will **automatically** create the `gobank_sim` database and its tables if they do not exist. However, if you prefer to set up or inspect the database manually via the MySQL CLI, use the commands below:

### Manual MySQL CLI Setup Commands

Open the **MySQL Command Line Client** (or run `mysql -u root -p` in your terminal) and execute:

```sql
-- 1. Create the simulation database
CREATE DATABASE IF NOT EXISTS gobank_sim
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE gobank_sim;

-- 2. Create the Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_code VARCHAR(10) NOT NULL UNIQUE,
    owner_name VARCHAR(100) NOT NULL,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 1000.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Create the Simulation Execution Logs table
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

-- 4. Seed initial accounts ($1,000.00 baseline each)
INSERT IGNORE INTO accounts (account_code, owner_name, balance) VALUES
('A', 'Alice Springs', 1000.00),
('B', 'Bob Vance', 1000.00),
('C', 'Charlie Day', 1000.00);
```

---

## 🚀 Running the App

Open **PowerShell** or **Command Prompt** and run the following commands:

### 1. Clone the repository & enter directory:
```powershell
git clone https://github.com/your-username/goBankV2.git
cd goBankV2
```

### 2. Download and verify Go dependencies:
```powershell
go mod tidy
```

### 3. (Optional) Set your MySQL password (if non-empty):
* In **PowerShell**:
  ```powershell
  $env:DB_PASS = "your_mysql_password"
  ```
* In **Command Prompt (CMD)**:
  ```cmd
  set DB_PASS=your_mysql_password
  ```

### 4. Start the Go server:
```powershell
go run main.go
```
*Output will confirm:*
```
Successfully connected to MySQL database 'gobank_sim' at 127.0.0.1:3306 (schema verified).
Baseline accounts verified and reset to $1,000.00.
==================================================================
  goBankV2 Simulator running at http://127.0.0.1:8080
  Open the URL above in your browser to start the simulation.
==================================================================
```

### 5. Open in your browser:
Navigate to **`http://127.0.0.1:8080`** (or `http://localhost:8080`).

---

## 📖 Quick 3-Step Usage Guide

```
[ Step 1: Build Schedule ] ──> [ Step 2: Simulate Hazards ] ──> [ Step 3: Fix Problem (Strict 2PL) ]
```

### Step 1: Configure Timelines & Drag Operations
* Select the number of concurrent transactions using the **1 Tx**, **2 Tx**, **3 Tx**, or **4 Tx** toggle buttons.
* Drag operation blocks from the **Operation Blocks** toolbox (`READ`, `WRITE`, `COMMIT`, `ROLLBACK`) into the transaction timeline slots ($T_1 \dots T_4$).
* Customize target accounts (A, B, or C) and monetary amounts ($+\$200$, $-\$150$) directly inside each block.
* *Quick shortcut:* Select any classic hazard from the **Educational Scenarios** dropdown (e.g., *Lost Update*, *3-Way Deadlock*, or *Multi-Hazard Storm*) and click **Load**.

### Step 2: Click "Simulate Schedule"
* Click the blue **Simulate Schedule** button.
* The backend analyzes the global schedule and runs the transactions on the live MySQL InnoDB database.
* Inspect the results:
  * **Hazard Report:** Explains exact anomalies (Dirty Read, Lost Update, Non-Repeatable Read, Write Skew, or Deadlock).
  * **Serialization Precedence Graph:** Displays directed conflict dependency edges ($T_i \to T_j$) and cycles.
  * **Live Execution Trace:** Shows per-step SQL execution times, balance reads, and lock wait times.
  * **Deadlock Detection:** If a circular lock wait occurs, MySQL InnoDB Error 1213 is caught and the victim transaction is flagged with a **`⚠️ DEADLOCK ROLLED BACK`** badge.

### Step 3: Click "Fix Problem (Apply Strict 2PL)"
* When hazards are detected, the main action button transforms into **`Fix Problem (Apply Strict 2PL)`** with an amber glow.
* Click the button to dispatch the schedule to the `/execute-safe` endpoint.
* The database enforces **Strict Two-Phase Locking**:
  * All conflicting reads acquire row-level locks via `SELECT ... FOR UPDATE`.
  * Transactions hold exclusive row locks until `COMMIT`.
  * Transaction isolation is set to `SERIALIZABLE`.
* The status badge updates to **`Strict 2PL Enforced`**, hazards are resolved, and consistent balances are maintained.

---

## 🛠️ Windows Troubleshooting

* **MySQL Service Not Running:** Open `services.msc`, locate `MySQL` (or `MySQL84`), and click **Start**. Alternatively, run `net start MySQL` in an Administrator terminal.
* **Authentication Error (1045):** If you configured a password during MySQL installation, set `$env:DB_PASS="your_password"` in PowerShell before running `go run main.go`.
* **Firewall Pop-ups:** The server binds specifically to loopback `127.0.0.1:8080`, completely preventing Windows Defender Firewall network access warnings.
* **Port Conflict:** If port 8080 is already used by another application, run with `$env:PORT="8085"` and visit `http://127.0.0.1:8085`.
