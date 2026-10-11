package server

import (
	"encoding/json"
	"log"
	"net/http"

	"goBankV2/internal/analyzer"
	"goBankV2/internal/database"
	"goBankV2/internal/models"
)

// Server encapsulates the HTTP multiplexer and database manager.
type Server struct {
	db     *database.DBManager
	router *http.ServeMux
}

// NewServer initializes routes and returns a ready Server instance.
func NewServer(db *database.DBManager, staticDir string) *Server {
	s := &Server{
		db:     db,
		router: http.NewServeMux(),
	}

	s.routes(staticDir)
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enable CORS for development ease
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	s.router.ServeHTTP(w, r)
}

func (s *Server) routes(staticDir string) {
	// Static UI file server
	fs := http.FileServer(http.Dir(staticDir))
	s.router.Handle("/", fs)

	// REST API endpoints
	s.router.HandleFunc("/api/accounts", s.handleGetAccounts)
	s.router.HandleFunc("/api/reset", s.handleReset)
	s.router.HandleFunc("/api/analyze", s.handleAnalyze)
	s.router.HandleFunc("/api/simulate", s.handleSimulate)
	s.router.HandleFunc("/simulate", s.handleSimulate) // Convenience alias for Phase 2 testing
	s.router.HandleFunc("/execute-safe", s.handleExecuteSafe) // Phase 5 Conflict Resolution endpoint
	s.router.HandleFunc("/api/fix", s.handleExecuteSafe)
}

func (s *Server) handleGetAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	accounts, err := s.db.GetAccounts()
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, accounts)
}

func (s *Server) handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := s.db.ResetAccounts(); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	accounts, err := s.db.GetAccounts()
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "success",
		"message":  "Accounts successfully reset to $1,000.00 baseline.",
		"accounts": accounts,
	})
}

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req models.SimulationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON payload"})
		return
	}

	analysis := analyzer.AnalyzeSchedule(req.Schedule)
	respondJSON(w, http.StatusOK, analysis)
}

func (s *Server) handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req models.SimulationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Validation
	if len(req.Schedule) == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "Validation failed: schedule cannot be empty"})
		return
	}

	// Print parsed schedule to server console
	log.Printf("------------------------------------------------------------------")
	log.Printf("[SIMULATE] Received Schedule with %d steps across %d transactions:", len(req.Schedule), req.TxCount)
	for _, step := range req.Schedule {
		log.Printf("  -> Step %d | Tx: %-2s | Op: %-6s | Account: %-2s | Delta: $%.2f",
			step.StepIndex, step.TxID, step.Op, step.Account, step.Amount)
	}
	log.Printf("------------------------------------------------------------------")

	result, err := s.db.ExecuteSimulation(req)
	if err != nil {
		log.Printf("Simulation execution error: %v\n", err)
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleFix(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req models.SimulationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
		return
	}

	// 1. Generate safe Strict 2PL schedule
	safeSchedule, fixMsg := analyzer.GenerateSafeSchedule(req.Schedule)

	// 2. Prepare fixed simulation request with Strict 2PL mode enabled
	fixedReq := req
	fixedReq.Schedule = safeSchedule
	fixedReq.ControlMode = models.ModeStrict2PL

	// 3. Execute safe simulation against MySQL
	result, err := s.db.ExecuteSimulation(fixedReq)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	result.Resolved = true
	result.ResolutionMsg = fixMsg

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"fixedSchedule": safeSchedule,
		"simulation":    result,
		"fixMessage":    fixMsg,
	})
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
