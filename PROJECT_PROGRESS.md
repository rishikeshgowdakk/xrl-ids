# XRL-IDARS Project Progress Report

## A. PROJECT OVERVIEW
**Explainable RL-Based Intrusion Detection and Autonomous Response System (XRL-IDARS)** is a comprehensive cybersecurity pipeline that ingests real-time network traffic, extracts features, and leverages Machine Learning (Random Forest) and Deep Learning (LSTM) to classify anomalous/malicious behavior. It uses Explainable AI (SHAP) to interpret ML decisions, and Reinforcement Learning (DQN) to select the optimal autonomous response (e.g., BLOCK, ALERT). The backend consists of a Python FastAPI ML engine and a Node.js/Express orchestration server that communicates with a React dashboard, storing logs in PostgreSQL and real-time metrics in InfluxDB.

## B. CURRENT ARCHITECTURE
The actual implemented architecture:
REAL NETWORK (Scapy)
    ↓ (Queue)
FEATURE EXTRACTION (Scapy script local)
    ↓ (HTTP POST)
ML ENGINE (FastAPI)
    ├── Random Forest (Classification)
    ├── LSTM (Temporal Anomaly)
    ├── SHAP (Explainability)
    └── DQN (Decision Making)
    ↓ (Response)
SCAPY WORKER 
    ↓ (HTTP POST)
NODE BACKEND / EVENT STORAGE (PostgreSQL / InfluxDB)
    ↓ (SSE Stream)
FRONTEND DASHBOARD (React / Tailwind)

## C. COMPLETED WORK
### 1. Backend
- [x] Express server (server.ts) with API endpoints.
- [x] SSE streaming for real-time frontend updates.

### 2. Frontend
- [x] React Dashboard with functional views.
- [x] ModelPipelineView, XaiExplanationView, RlDqnView, FirewallActionView.

### 3. ML engine
- [x] FastAPI service (`ml_engine/api/main.py`) running on port 8000.
- [x] Inference endpoint (`/predict`).

### 4. Random Forest
- [x] Model implemented (`rf_model.py`).
- [x] Pre-trained artifact (`rf_model.joblib`) loading correctly.

### 5. LSTM
- [x] Model implemented (`lstm_model.py`).
- [x] PyTorch artifact (`lstm_model.pt`) loading correctly.

### 6. SHAP/XAI
- [x] Explainer implemented (`shap_engine.py`).
- [x] Background datasets loaded, successfully explaining RF predictions.

### 7. DQN/RL
- [x] Agent implemented (`dqn_model.py`).
- [x] PyTorch artifact (`dqn_model.pt`) loading correctly.

### 8. Packet sniffing
- [x] Real-time scapy sniffer (`scapy_sniffer.py`).
- [x] Extracts TCP/UDP/ICMP packets with BPF filter support.

### 9. Feature extraction
- [x] Flow-based feature extraction (pps, bps, lengths, TCP flags) directly in Python script.

### 10. Real-time event processing
- [x] Node.js `controlModule.ts` orchestrates events.
- [x] Scapy script forwards predictions to Node via `/api/internal/packet`.

### 11. LAN discovery
- [x] Dynamic interface, host, and gateway detection (`server.ts`).
- [x] Active probing using `arp-scan` (`sudo -n arp-scan --localnet`).

### 12. Firewall/autonomous response
- [x] Internal blocklist management in `controlModule.ts`.

### 13. PostgreSQL
- [x] Setup and initialization in `postgres.ts`.

### 14. InfluxDB
- [x] Setup and real-time telemetry writes in `scapy_sniffer.py`.

### 15. API integration
- [x] Predict API, DB API, LAN API all functional.

### 16. WebSocket/SSE
- [x] Functional Server-Sent Events (`/api/packets/stream`).

### 17. Model artifacts
- [x] All artifacts are present in `ml_engine/artifacts/`.

### 18. Documentation
- [x] Extensive doc updates (this document + README).

## D. VERIFIED CURRENT STATE
- Node backend runs on port 3000.
- `/api/health` returns operational.
- Python ML engine runs on port 8000.
- ML `/health` reports all models loaded.
- ML engine exposes `/predict`.
- Real LAN discovery endpoint is `/api/lan-devices`.
- Real LAN interface detected (e.g. `wlo1`).
- Current subnet is correctly parsed (e.g. `192.168.0.0/24`).
- LAN discovery uses active `sudo -n arp-scan` and correctly handles strict timeout and permission-related failures. `ip neigh` fallback has been completely removed to avoid faking active scans.
- No cached fallback or mock data is injected. Real discovered endpoints populate the frontend.
- npm lint and TypeScript compilation successfully pass.

## E. CURRENT ML/DL PIPELINE
1. **Packet Capture & Extraction**: `scapy_sniffer.py` captures raw packets and aggregates them into flows. Every 5 seconds (or rate-limited to 1s per flow), flow features are calculated.
2. **Preprocessing**: The ML engine's `/predict` endpoint scales incoming 10-feature vectors using a pre-trained `scaler.joblib`.
3. **Random Forest (Classification)**: The scaled features are evaluated by RF to calculate attack probability.
4. **LSTM (Temporal Anomaly)**: Sequences of 5 consecutive observations for a flow are evaluated for temporal anomalies.
5. **Risk Score**: A weighted risk score (0.6 * RF_Prob + 0.4 * LSTM_Score) is computed.
6. **SHAP (Explanation)**: SHAP EXPLAINS THE MODEL PREDICTION. SHAP DOES NOT DECIDE THE FIREWALL ACTION. It provides feature impact values.
7. **DQN (Decision Making)**: DQN evaluates the environment state (risk score, incident count, flow rates) and selects an action (ALLOW, ALERT, BLOCK).
8. **Action/Firewall**: `controlModule.ts` stores blocked IPs internally and emits SSE events to the frontend.

## F. FRONTEND
- **OverviewDashboard.tsx**: High-level system metrics (Total packets, Blocked IPs, Attack rates) reading from internal state.
- **ModelPipelineView.tsx**: Displays real-time feature flow into the RF and LSTM models and outputs raw probabilities.
- **XaiExplanationView.tsx**: Displays SHAP feature contributions (positive vs negative impact) in a waterfall/bar chart style.
- **RlDqnView.tsx**: Shows the Q-values, current state representation, and the final action chosen by the DQN agent.
- **FirewallActionView.tsx**: Lists active IP blocks, block reasons, and allows manual revocation.
- **HomeLanConfigModal.tsx**: LAN Scanner view. Triggers active `arp-scan` and maps native results.
- **AttackSimulator.tsx**: Sends mock events through the actual ML engine (simulates traffic when real packets aren't flowing).

## G. LAN DISCOVERY
- **Interface Detection**: Discovers the active IPv4 interface (ignoring `lo` and `docker`).
- **Subnet Detection**: Formats subnet directly from interface IPv4.
- **Gateway Detection**: Parses `ip route | grep default`.
- **arp-scan**: Executes `sudo -n arp-scan --interface=<IFACE> --localnet` with a strict 15s timeout.
- **Permissions**: Requires appropriate sudo privileges for `arp-scan`. If unavailable, actively fails with a 500 error explaining privileges are needed (no silent fallback).
- **Vendor Information**: Uses `arp-scan` vendor mappings; defaults to "Unknown".
- **Duplicate IP**: Deduplicates stale entries by wiping the list and inserting fresh scan results only.

## H. DATABASES
- **PostgreSQL**: Stores historical events via `events` table (handled in `postgres.ts`). Stores flow ID, source/dest IP, prediction, and action taken.
- **InfluxDB**: Time-series telemetry (attacks_count, blocked_count, packets_per_sec, risk_score) stored in `network_telemetry` measurement (handled by `scapy_sniffer.py`).

## I. API DOCUMENTATION
**Node Backend (Port 3000)**
- `GET /api/health` - Server status.
- `GET /api/lan-devices` - Executes native LAN `arp-scan` and returns discovered devices.
- `GET /api/packets/stream` - SSE stream of processed security events.
- `POST /api/internal/packet` - Webhook for Python sniffer to push results to frontend.
- `POST /api/db/events` - Save processed event to PostgreSQL.
- `POST /api/ml/predict` - Proxy route for the frontend to hit the ML engine.

**ML Engine (Port 8000)**
- `GET /health` - Model loading statuses.
- `POST /predict` - Synchronous endpoint. Expects `PredictRequest` (flow features, sequence). Returns class probabilities, SHAP values, LSTM score, and DQN action.

## J. KNOWN ISSUES / LIMITATIONS
- **Windows Incompatibility**: The backend deeply relies on Linux networking tools (`ip route`, `arp-scan`, `os.networkInterfaces()`) and raw packet capture (`scapy` + `libpcap`). Natively running on Windows is NOT supported without significant modifications.
- **Privilege Requirements**: `sudo` is required for both `arp-scan` and `scapy_sniffer.py`. Setting up `setcap` on Python/node binaries or allowing passwordless sudo for specific commands is required for production.
- **Simulator Code**: AttackSimulator.tsx and some mock generation paths are still present in the frontend and `controlModule.ts`. A full no-mock audit is pending.
- **Firewall Enforcement**: The `controlModule.ts` blocklist is currently application-layer only. It does not interface with host `iptables` or `nftables` to drop packets at the OS level.

## K. NEXT STEPS
- **P0**: Full no-mock audit: Remove Simulator components, `Math.random` generators, and mock payloads.
- **P0**: Verify every frontend value comes exclusively from real runtime data.
- **P1**: Verify autonomous response uses host firewall (`iptables`/`ufw`) to drop actual packets.
- **P1**: Document strict Linux capability setup (`setcap`) for production deployment.
- **P2**: Increase test coverage for Edge cases.

## L. PROJECT COMPLETION CHECKLIST
- [x] Node backend starts
- [x] ML engine starts
- [x] RF loads
- [x] LSTM loads
- [x] SHAP loads
- [x] DQN loads
- [x] Real LAN scan works (arp-scan)
- [x] Real packet capture verified (scapy)
- [x] Real packet reaches ML engine
- [x] Real RF prediction verified
- [x] Real LSTM prediction verified
- [x] Real SHAP explanation verified
- [x] Real DQN decision verified
- [ ] End-to-end real-time flow verified (Fully mocked-free)
- [ ] Zero mock/synthetic runtime data verified
- [ ] Real firewall OS-level action verified (iptables integration missing)
- [x] Linux setup verified
- [ ] Windows setup verified (Not Supported natively)
