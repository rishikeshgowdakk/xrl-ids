# Explainable RL-Based Intrusion Detection and Autonomous Response System (XRL-IDARS)

## 1. Project Title
**XRL-IDARS**: Explainable Reinforcement Learning-Based Intrusion Detection and Autonomous Response System.

## 2. Project Description
XRL-IDARS is a comprehensive, AI-driven cybersecurity pipeline designed to monitor local network traffic, detect malicious activity using deep learning, explain the reasoning behind its detections, and autonomously respond to threats. It combines conventional Machine Learning (Random Forest) for broad classification, Deep Learning (LSTM) for temporal anomaly detection, Explainable AI (SHAP) for transparent decision-making, and Reinforcement Learning (DQN) for optimal autonomous firewall mitigation. 

## 3. Objectives
- **Detection**: Accurately classify benign and malicious network flows in real-time.
- **Explainability**: Provide human-readable, transparent insights (XAI) into why a model flagged a specific flow as malicious.
- **Autonomy**: Use Reinforcement Learning to determine the most effective mitigation action dynamically, reducing the burden on human analysts.
- **Observability**: Maintain a modern, responsive SOC (Security Operations Center) dashboard providing real-time metrics, historical databases, and LAN topology analysis.

## 4. Key Features
- **Real-Time Packet Sniffing**: Uses Python `scapy` to capture live packets and aggregate flow-based features on the fly.
- **Dual-Model Inference**: Evaluates flows using both a Random Forest Classifier and an LSTM Sequential Anomaly Detector.
- **SHAP Waterfall Diagnostics**: Transparently details the exact network features (e.g., connection duration, packet size) contributing to the risk score.
- **DQN Autonomous Agent**: Suggests or enacts firewall rules (ALLOW, ALERT, BLOCK) based on an environment state encompassing risk scores and historical incident counts.
- **Active LAN Discovery**: Uses root-level `arp-scan` to maintain an active inventory of connected subnets and endpoints.
- **Live SOC Dashboard**: React/Vite frontend with Server-Sent Events (SSE) for sub-second telemetry visualization.

## 5. Architecture
The system architecture flows as follows:
1. **Network Interface** -> `scapy_sniffer.py` captures raw traffic and extracts 10-dimensional flow features.
2. **Feature Payload** -> Sent via HTTP POST to the ML Engine (`/predict`).
3. **ML Engine (FastAPI)** -> Scales features -> RF predicts class -> LSTM evaluates sequence -> SHAP extracts explanations -> DQN selects action.
4. **Sniffer Worker** -> Forwards the prediction and features to the Node.js Backend.
5. **Node Backend** -> Persists the event to PostgreSQL, logs metrics to InfluxDB, and streams data via SSE.
6. **Frontend Dashboard** -> React application visualizes the attack, displays SHAP values, and updates internal blocklists.

## 6. Technology Stack
- **Frontend**: React 19, TailwindCSS, Vite, Lucide React, Recharts.
- **Backend**: Node.js (TSX/Express) for orchestration; PostgreSQL & InfluxDB for storage.
- **ML Engine**: Python 3, FastAPI, Uvicorn, Scikit-Learn, PyTorch, SHAP.
- **Network Layer**: Scapy, `arp-scan`, `iproute2`.

## 7. Repository Structure
```
.
├── ml_engine/                # Python backend, ML models, FastAPI routing
│   ├── api/main.py           # FastAPI server
│   ├── artifacts/            # Pre-trained models (.joblib, .pt)
│   ├── models/               # PyTorch and SKLearn model definitions
│   └── explainability/       # SHAP integration
├── src/                      # React frontend and Node services
│   ├── components/           # UI Components (Dashboard, Firewalls, LAN)
│   └── services/             # Node controllers (controlModule, packetEngine, DBs)
├── scapy_sniffer.py          # Real-time packet capture daemon
├── server.ts                 # Node.js API and SSE Stream provider
├── package.json              # NPM Dependencies
└── README.md                 # Project Documentation
```

## 8. Prerequisites
- **OS**: Linux (Ubuntu 22.04/24.04 recommended). *Windows natively is not supported.*
- **Node.js**: v20+
- **Python**: v3.10+
- **Databases**: PostgreSQL 14+, InfluxDB 1.8+
- **System Tools**: `arp-scan`, `libpcap-dev`, `iproute2`

## 9. Linux Installation
1. Clone the repository.
2. Install system dependencies:
   ```bash
   sudo apt-update
   sudo apt install arp-scan libpcap-dev postgresql influxdb
   ```

## 10. Linux Configuration
Ensure the network interface you intend to sniff is up and accessible. Identify your primary interface (e.g., `wlo1` or `eth0`) using `ip addr`.

## 11. Linux Permissions
To execute real-time packet capture and active LAN scans, root privileges are strictly required.
- `arp-scan` requires CAP_NET_RAW.
- `scapy_sniffer.py` requires CAP_NET_RAW.
You must run the Python sniffer with `sudo` or configure Linux capabilities (`setcap cap_net_raw+ep`) for your Python binary and `arp-scan` executable.

## 12. Python Virtual Environment
1. Create a virtual environment: `python3 -m venv .venv`
2. Activate: `source .venv/bin/activate`
3. Install requirements: `pip install -r ml_engine/requirements.txt`

## 13. Node.js Setup
1. Install dependencies: `npm install`
2. Set up environment variables (see Section 17).

## 14. PostgreSQL Setup
1. Start PostgreSQL: `sudo systemctl start postgresql`
2. Create database: `createdb xrl_idars` (or configure via `.env`).
The backend (`server.ts`) will automatically initialize the schema on boot.

## 15. InfluxDB Setup
1. Start InfluxDB: `sudo systemctl start influxdb`
2. The Python sniffer will automatically attempt to create the `xrl_idars` database and write telemetry metrics.

## 16. ML Model/Artifact Requirements
The following pre-trained artifacts must reside in `ml_engine/artifacts/`:
- `rf_model.joblib`
- `scaler.joblib`
- `shap_background.joblib`
- `dqn_model.pt`
- `lstm_model.pt`
*(Do not boot the ML API without these files).*

## 17. Environment Variables
Create a `.env` file in the root directory:
```
DB_USER=postgres
DB_HOST=127.0.0.1
DB_NAME=xrl_idars
DB_PASSWORD=yourpassword
DB_PORT=5432
INFLUX_HOST=127.0.0.1
```

## 18. How to start ML engine
```bash
source .venv/bin/activate
uvicorn ml_engine.api.main:app --host 127.0.0.1 --port 8000
```

## 19. How to start Node/backend/frontend
```bash
npm run dev
```
*(This launches `tsx server.ts` and the Vite dev server).*

## 20. How to verify services
- Node Health: `curl http://127.0.0.1:3000/api/health`
- ML Health: `curl http://127.0.0.1:8000/health` (Ensure all models show `loaded: true`).

## 21. How to run LAN discovery
Navigate to the "LAN Network & Device Manager" in the UI and click "Scan Subnet".
This sends a request to `/api/lan-devices`, which executes `sudo -n arp-scan --localnet` on the backend. **It will fail if you have not configured passwordless sudo or capabilities for arp-scan.**

## 22. How packet capture works
`scapy_sniffer.py` uses `libpcap` to asynchronously capture packets on the specified interface (`-i wlo1`). It maintains stateful flows (source, dest, ports, protocol) and calculates per-second metrics (pps, bps, flags) which are bundled into JSON payloads.

## 23. How ML inference works
The Python script sends the JSON payload to the ML FastAPI `/predict` route. 
The API transforms the dictionary into a scaled numpy array, passes it to the Random Forest model for classification probabilities, and evaluates the last 5 sequences against the PyTorch LSTM model.

## 24. How SHAP works
The `SHAPEngine` maintains a KernelExplainer initialized with a background dataset (`shap_background.joblib`). When an inference occurs, it calculates the marginal contribution of each feature (e.g., how much `flow_duration_ms` increased the risk probability).

## 25. How DQN works
The Reinforcement Learning agent ingests an environment state containing the current Risk Score, LSTM score, incident history, and packet velocity. It queries a neural network (`dqn_model.pt`) to evaluate Q-values for three discrete actions: ALLOW, ALERT, BLOCK, selecting the optimal mitigation strategy.

## 26. How firewall response works
Currently, action blocks are managed via an application-layer blocklist in `controlModule.ts`. When the DQN recommends BLOCK, the IP is added to the internal active blocklist, dropping simulated internal UI traffic and dispatching an alert to the dashboard. *(OS-level `iptables` integration is planned for the future).*

## 27. API endpoints
**Node.js (Port 3000)**
- `GET /api/health`: Validates Node server status.
- `GET /api/lan-devices`: Executes native `arp-scan` and returns discovered endpoints.
- `GET /api/packets/stream`: Provides a continuous Server-Sent Events (SSE) stream of processed packets.
- `POST /api/internal/packet`: Webhook allowing the Python sniffer to inject packet results into the Node SSE stream.
- `POST /api/db/events`: Writes a finalized security event to PostgreSQL.

**ML Engine (Port 8000)**
- `GET /health`: Validates ML artifact loading status.
- `POST /predict`: Ingests flow features/sequences and returns RF, LSTM, SHAP, and DQN outputs.

## 28. Database information
- **PostgreSQL**: Stores long-term structured security events (IPs, Predictions, Actions taken).
- **InfluxDB**: Stores highly volatile, real-time time-series telemetry (packets/sec, block/attack ratios) updated continuously by the sniffer daemon.

## 29. Troubleshooting
- **LAN Scan Fails**: Ensure `arp-scan` is installed and you can run `sudo -n arp-scan --localnet` without being prompted for a password.
- **ML API 500 Errors**: Ensure your Python version matches the artifacts, and all `.joblib` and `.pt` files exist in `ml_engine/artifacts/`.
- **No Packets in UI**: Ensure `scapy_sniffer.py` is actively running with root privileges on an interface currently receiving traffic.

## 30. Windows installation
**Native Windows installation is NOT supported.** The backend architecture relies heavily on Linux-specific networking tools, routing tables, and ARP implementations.

## 31. Windows limitations
- `arp-scan` is not natively available or reliable on Windows.
- `ip route` and Linux network interface parsing (e.g., `wlo1`) fail on Windows.
- `scapy` requires installing Npcap or WinPcap, and behaves differently at the socket level.
- Sudo/privilege escalation logic implemented in the backend will fail.

## 32. Linux vs Windows differences
If attempting to develop the UI on Windows, you must rely exclusively on the `AttackSimulator.tsx` (mock data generation) as live sniffing and LAN active probing will fail. It is highly recommended to use WSL2 (Windows Subsystem for Linux), though WSL2 presents significant challenges bridging physical network interfaces for promiscuous mode sniffing.

## 33. Security/privilege requirements
Do **not** run the Node.js server as root. Instead, grant specific capabilities to `arp-scan` and the Python binary:
```bash
sudo setcap cap_net_raw+ep /usr/sbin/arp-scan
sudo setcap cap_net_raw+ep /path/to/.venv/bin/python
```
This follows the principle of least privilege while enabling necessary low-level network access.

## 34. Development workflow
1. Edit React components in `src/components/`.
2. Edit Node APIs in `server.ts` or `src/services/`.
3. Edit ML routing in `ml_engine/api/main.py`.
4. Hot-reloading is handled by Vite for the frontend. You must restart the Node backend or Uvicorn server for backend changes.

## 35. Testing
The project currently relies on manual End-to-End validation. Run `npm run lint` and `npx tsc --noEmit` to validate TypeScript interfaces before committing.

## 36. Project status
The project is structurally complete. Real-time packet capture, inference, XAI explanations, LAN discovery, and database logging are functionally integrated. A full No-Mock UI audit is currently underway to strip out legacy simulator fallbacks.

## 37. Known limitations
- Automated OS-level firewall execution (`iptables`/`nftables`) is not yet invoked by the DQN agent.
- `AttackSimulator.tsx` mock-generators are still present in the UI codebase pending a final clean-up.

## 38. Future work
- Integration of DQN outputs directly into Linux `iptables` for true autonomous mitigation.
- Enhancing LSTM to evaluate variable-length sequences dynamically.
- Transitioning the UI blocklist to pull historical blocks directly from PostgreSQL on boot.
