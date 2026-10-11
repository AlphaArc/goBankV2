package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

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
	dbPass := getEnv("DB_PASS", "") // Default empty for local dev
	dbHost := getEnv("DB_HOST", "127.0.0.1")
	dbPort := getEnv("DB_PORT", "3306")
	dbName := getEnv("DB_NAME", "gobank_sim")
	host := getEnv("HOST", "127.0.0.1") // Loopback avoids Windows Firewall popups
	port := getEnv("PORT", "8080")

	log.Printf("Connecting to MySQL at %s:%s (database: %s)...", dbHost, dbPort, dbName)
	dbManager, err := database.AutoInitAndConnect(dbUser, dbPass, dbHost, dbPort, dbName)
	if err != nil {
		log.Fatalf("\n==================================================================\n[DATABASE ERROR]\n%v\n==================================================================", err)
	}
	defer dbManager.Close()

	// Initial check and baseline reset
	if err := dbManager.ResetAccounts(); err != nil {
		log.Printf("Warning during initial reset: %v", err)
	} else {
		log.Println("Baseline accounts verified and reset to $1,000.00.")
	}

	staticDir := filepath.Join(".", "static")
	srv := server.NewServer(dbManager, staticDir)

	addr := net.JoinHostPort(host, port)
	log.Printf("==================================================================")
	log.Printf("  goBankV2 Simulator running at http://%s", addr)
	log.Printf("  Open the URL above in your browser to start the simulation.")
	log.Printf("==================================================================")

	if err := http.ListenAndServe(addr, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
