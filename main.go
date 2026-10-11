package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"goBankV2/internal/database"
	"goBankV2/internal/server"
)

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	dbUser := getEnv("DB_USER", "root")
	dbPass := getEnv("DB_PASS", "") // Default empty for initialized local instance
	dbHost := getEnv("DB_HOST", "127.0.0.1")
	dbPort := getEnv("DB_PORT", "3306")
	dbName := getEnv("DB_NAME", "gobank_sim")
	port := getEnv("PORT", "8080")

	var authPart string
	if dbPass != "" {
		authPart = fmt.Sprintf("%s:%s", dbUser, dbPass)
	} else {
		authPart = dbUser
	}

	dsn := fmt.Sprintf("%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true&interpolateParams=true", authPart, dbHost, dbPort, dbName)

	log.Printf("Connecting to MySQL at %s:%s (database: %s)...", dbHost, dbPort, dbName)
	dbManager, err := database.NewDBManager(dsn)
	if err != nil {
		log.Fatalf("Fatal: Database initialization failed: %v", err)
	}
	defer dbManager.Close()

	// Initial check and baseline reset
	if err := dbManager.ResetAccounts(); err != nil {
		log.Printf("Warning during initial reset: %v", err)
	} else {
		log.Println("Baseline accounts verified and reset to $1,000.00.")
	}

	srv := server.NewServer(dbManager, "./static")

	addr := ":" + port
	log.Printf("==================================================================")
	log.Printf("  goBankV2 Simulator running at http://localhost%s", addr)
	log.Printf("  Open the URL above in your browser to start the simulation.")
	log.Printf("==================================================================")

	if err := http.ListenAndServe(addr, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
