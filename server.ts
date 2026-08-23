import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import os from 'os';
import { initializeDatabase, checkDatabaseHealth, saveSecurityEventToDb, getRecentActions } from './src/services/postgres.js';
import { initializeInfluxDB } from './src/services/influxdb.js';
import { actionExecutor } from './src/services/actionExecutor.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packetEmitter = new EventEmitter();
let snifferProcess: ChildProcess | null = null;
let trackedDevices: string[] = [];

function getWifiInfo(): { prefix: string | null; iface: string; hostIp: string | null; hostMac: string | null } {
  const interfaces = os.networkInterfaces();
  
  for (const [name, nets] of Object.entries(interfaces)) {
    if (!nets) continue;
    
    // Look for common active Wi-Fi or Ethernet interfaces, skipping loopback and docker
    if (
      !name.startsWith('lo') && 
      !name.startsWith('docker') && 
      !name.startsWith('br-') &&
      !name.startsWith('veth')
    ) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          const segments = net.address.split('.');
          return {
            prefix: `${segments[0]}.${segments[1]}.${segments[2]}.`,
            iface: name,
            hostIp: net.address,
            hostMac: net.mac
          };
        }
      }
    }
  }
  return { prefix: null, iface: 'any', hostIp: null, hostMac: null };
}

function startPacketCapture(forceRestart = false) {
  if (snifferProcess && !snifferProcess.killed) {
    console.log('[Packet Capture] Sniffer is already running, preventing duplicate instance.');
    return;
  }

  const { iface, hostIp } = getWifiInfo();
  
  // Construct BPF filter for tracked IPs
  let filter = '';
  if (trackedDevices && trackedDevices.length > 0) {
    const filterIps = new Set(trackedDevices);
    if (hostIp) {
      filterIps.add(hostIp);
    }
    filter = Array.from(filterIps).map(ip => `host ${ip}`).join(' or ');
  }

  // Use Python Scapy script for packet capture
  const scapyScript = path.join(process.cwd(), 'scapy_sniffer.py');
  const pythonPath = path.join(process.cwd(), '.venv', 'bin', 'python');

  const args = [pythonPath, scapyScript, '-i', iface];

  if (filter) {
    args.push('-f', filter);
    console.log(`[Packet Capture] Starting filtered capture on ${iface}: ${filter}`);
  } else {
    console.log(`[Packet Capture] Starting unfiltered capture on ${iface}.`);
  }

  // Use non-interactive sudo so the process never prompts for a password.
  // The exact pythonPath is permitted by the project's sudoers NOPASSWD rule.
  snifferProcess = spawn('sudo', ['-n', ...args]);
  
  snifferProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const pkt = JSON.parse(line);
        // If it's a status or error message from our scapy script
        if (pkt.status || pkt.error) {
          console.log(`[Scapy Sniffer]`, pkt);
          continue;
        }
        // Otherwise it's a parsed packet, send to frontend
        packetEmitter.emit('packet', pkt);
      } catch (err) {
        // Not a JSON line, probably debug/warning output from scapy
      }
    }
  });

  snifferProcess.stderr?.on('data', (data) => {
    console.error(`[Scapy Sniffer] ${data}`);
  });

  snifferProcess.on('close', (code) => {
    console.log(`[Scapy Sniffer] python process exited with code ${code}`);
    snifferProcess = null;
  });
}


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Endpoints for Intrusion Detection & Autonomous Response System
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'operational',
      project: 'Explainable RL-Based Intrusion Detection and Autonomous Response System (XRL-IDARS)',
      institution: 'VTU - JSS Academy of Technical Education, Bengaluru',
      timestamp: new Date().toISOString()
    });
  });

  // PostgreSQL Database Endpoints
  app.get('/api/database/health', async (req, res) => {
    const isHealthy = await checkDatabaseHealth();
    if (isHealthy) {
      res.json({ status: 'ok', database: process.env.PGDATABASE || 'xrl_idars' });
    } else {
      res.status(500).json({ status: 'error', error: 'Database connection failed' });
    }
  });

  app.post('/api/db/events', async (req, res) => {
    try {
      const event = req.body;
      const dqnAction = event.realPrediction?.dqn?.action || event.actionExecuted || 'ALLOW';
      const sourceIp = event.sourceIp || event.source_ip;
      
      if (sourceIp) {
        const executionResult = await actionExecutor.executeAction(dqnAction, sourceIp);
        
        event.executionStatus = executionResult.status;
        event.executionMode = executionResult.mode;
        event.firewallRuleId = executionResult.ruleId;
        event.executionError = executionResult.errorMessage;
        
        if (executionResult.action === 'BLOCK' && executionResult.status !== 'FAILED') {
          event.isBlocked = true;
        }
      }
      
      await saveSecurityEventToDb(event);
      res.status(201).json({ status: 'success' });
    } catch (err) {
      console.error('Failed to save event:', err);
      // Don't crash on DB error, just log it. The frontend handles errors gracefully.
      res.status(500).json({ status: 'error', error: 'Failed to save event' });
    }
  });

  app.get('/api/actions', async (req, res) => {
    try {
      const actions = await getRecentActions();
      res.json(actions);
    } catch (err) {
      res.status(500).json({ status: 'error', error: 'Failed to fetch actions' });
    }
  });

  // Telemetry is now handled natively by scapy_sniffer.py writing directly to InfluxDB.

  // ML Engine Proxy Endpoints
  app.get('/api/ml/health', async (req, res) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/health');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error proxying to ML health endpoint:', error);
      res.status(503).json({ error: 'ML engine unavailable' });
    }
  });

  app.post('/api/ml/predict', async (req, res) => {
    try {
      const FEATURE_SCHEMA = [
        "flow_duration_ms",
        "flow_packets_per_s",
        "flow_bytes_per_s",
        "packet_length_mean",
        "packet_length_std",
        "syn_count",
        "ack_count",
        "rst_count",
        "fin_count",
        "syn_ack_ratio"
      ];

      if (!req.body || !req.body.features) {
        console.error(`[ML Proxy] Validation error: Missing features object`);
        return res.status(400).json({ error: 'Missing features object' });
      }

      const missingFeatures: string[] = [];
      const invalidFeatures: string[] = [];

      for (const feature of FEATURE_SCHEMA) {
        const val = req.body.features[feature];
        if (val === undefined || val === null) {
          missingFeatures.push(feature);
        } else if (typeof val !== 'number' || !Number.isFinite(val)) {
          invalidFeatures.push(feature);
        }
      }

      if (missingFeatures.length > 0 || invalidFeatures.length > 0) {
        const errorMsg = `Validation failed. Missing: ${missingFeatures.join(', ')}. Invalid/Non-numeric: ${invalidFeatures.join(', ')}`;
        console.error(`[ML Proxy] Validation error: ${errorMsg}`);
        return res.status(400).json({ error: errorMsg });
      }

      const response = await fetch('http://127.0.0.1:8000/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[ML Proxy] /predict failed: ${response.status} ${errorBody}`);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error proxying to ML predict endpoint:', error);
      res.status(503).json({ error: 'ML engine unavailable' });
    }
  });

  // System Architecture metadata endpoint
  app.get('/api/architecture', (req, res) => {
    res.json({
      layers: [
        { id: 1, name: 'Network Traffic Layer', description: 'LAN packet stream capturing user browsing, file transfer, and attack patterns' },
        { id: 2, name: 'Packet Capture Layer', technology: 'Scapy (Python) / Node Engine', fields: ['Source IP', 'Destination IP', 'Protocol', 'Port', 'Packet Size'] },
        { id: 3, name: 'Feature Extraction Layer', metrics: ['Packets/sec', 'Unique Ports', 'Connection Duration', 'Failed Connections', 'SYN/ACK Ratio'] },
        { id: 4, name: 'Machine Learning Layer', model: 'Random Forest Classifier (50 Estimators)', output: 'Static Attack Probability Score' },
        { id: 5, name: 'Deep Learning Layer', model: 'LSTM Recurrent Neural Network (T=5)', output: 'Temporal Behavior Anomaly Score' },
        { id: 6, name: 'Risk Scoring Layer', formula: 'W_ML * P_RF + W_DL * P_LSTM + Heuristic', levels: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] },
        { id: 7, name: 'Explainable AI (XAI) Layer', framework: 'SHAP (TreeSHAP / KernelSHAP)', output: 'Feature Contribution Weights and Root-Cause Narrative' },
        { id: 8, name: 'Reinforcement Learning Layer', algorithm: 'Deep Q-Network (DQN - Hossain et al., 2025)', actions: ['ALLOW (0)', 'ALERT (1)', 'BLOCK (2)'] },
        { id: 9, name: 'Processing & Control Module', role: 'Central orchestrator managing data flow, model coordination, and decision execution' },
        { id: 10, name: 'Action Execution Layer', targets: ['Firewall IP drop table', 'Webhook payload', 'Email/SMS notification'] },
        { id: 11, name: 'Database Layer', schema: ['PostgreSQL (structured security audit logs & decisions)', 'InfluxDB (real-time telemetry)'] },
        { id: 12, name: 'Dashboard Layer', ui: 'Real-time SOC Monitoring (Grafana Style)' }
      ]
    });
  });

  // Real LAN Discovery Endpoint
  app.get('/api/lan-devices', async (req, res) => {
    try {
      const { prefix, iface, hostIp, hostMac } = getWifiInfo();
      
      let gatewayIp: string | null = null;
      try {
        const routeResult = await execAsync('ip route | grep default');
        const gwMatch = routeResult.stdout.match(/default via ([\d\.]+)/);
        if (gwMatch) gatewayIp = gwMatch[1];
      } catch (e) {
        // ignore
      }

      let stdout = '';
      let scanError = '';
      try {
        const result = await execAsync(`sudo -n arp-scan --interface=${iface} --localnet`, { timeout: 15000, killSignal: 'SIGKILL' });
        stdout = result.stdout;
      } catch (e: any) {
        console.warn('sudo arp-scan failed or timed out:', e.message);
        return res.status(500).json({ 
          success: false, 
          scanType: "active-arp",
          error: "Active LAN scan requires arp-scan with appropriate privileges. No cached-device fallback was used." 
        });
      }

      const lines = stdout.split('\n');
      const devices = [];
      
      const newlyTracked: string[] = [];
      const subnet = prefix ? `${prefix}0/24` : 'Unknown';

      // Add Host machine explicitly from OS network interfaces
      if (hostIp && prefix && hostIp.startsWith(prefix)) {
        devices.push({ 
          ip: hostIp, 
          mac: hostMac || 'Unknown', 
          vendor: 'Host Machine', 
          isGateway: hostIp === gatewayIp,
          isHost: true,
          source: 'os-interface'
        });
        newlyTracked.push(hostIp);
      }

      for (const line of lines) {
        let ip = null;
        let mac = null;
        let vendor = 'Unknown';
        
        const arpScanMatch = line.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F:-]+)(?:\s+(.*))?/);

        if (arpScanMatch) {
          ip = arpScanMatch[1];
          mac = arpScanMatch[2];
          vendor = arpScanMatch[3] || 'Unknown';
        }

        if (ip && mac) {
          if (prefix && ip.startsWith(prefix) && ip !== hostIp) {
            devices.push({ 
              ip, 
              mac, 
              vendor: vendor.trim(), 
              isGateway: ip === gatewayIp,
              isHost: false,
              source: 'arp-scan'
            });
            newlyTracked.push(ip);
          }
        }
      }
      
      // Update tracked IPs and restart sniffer filter if needed
      if (newlyTracked.length > 0) {
        trackedDevices = newlyTracked;
        if (snifferProcess) {
          startPacketCapture(true); // Restart with new filter
        }
      }

      res.json({ 
        success: true,
        interface: iface,
        subnet,
        hostIp, 
        gatewayIp,
        devices
      });
    } catch (error: any) {
      console.error('Error scanning LAN:', error);
      res.status(500).json({ success: false, error: 'Failed to scan LAN devices.' });
    }
  });

  // Internal Packet Ingestion for Standalone Sniffer
  app.post('/api/internal/packet', (req, res) => {
    packetEmitter.emit('packet', req.body);
    res.json({ status: 'ok' });
  });

  // Real Packet Stream Endpoint (SSE)
  app.get('/api/packets/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    startPacketCapture(); // Start capturing if not already

    const onPacket = (pkt: any) => {
      res.write(`data: ${JSON.stringify(pkt)}\n\n`);
    };

    packetEmitter.on('packet', onPacket);

    req.on('close', () => {
      packetEmitter.off('packet', onPacket);
    });
  });

  // Vite middleware for dev or static server for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[XRL-IDARS Backend] Running on http://0.0.0.0:${PORT}`);
  });
}

// Initialize PostgreSQL Schema and Start Server
initializeDatabase().then(() => {
  return initializeInfluxDB();
}).then(() => {
  startServer();
});
