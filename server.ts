import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { FraudType, TransactionStatus, Transaction, Case, CaseStatus, Alert, AlertStatus, AuditLog, ModelPerformance, GraphNode, GraphEdge } from "./src/types.js";

const app = express();
const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "db_state.json");

app.use(express.json());

// Multi-MFA / Session / Audit Logging Helpers
const logAudit = (user: string, role: string, action: string, ip: string, details: string) => {
  const newLog: AuditLog = {
    id: `LOG-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: new Date().toISOString(),
    user,
    role,
    action,
    ipAddress: ip || "127.0.0.1",
    details,
  };
  dbState.auditLogs.unshift(newLog);
  saveDbState();
};

// Raw Mock Datasets
const COUNTRIES = ["US", "GB", "DE", "FR", "CA", "JP", "BR", "IN", "ZA", "AU", "RU", "CN"];
const MERCHANTS = ["Amazon Retail", "Stripe Checkout", "Apple Store", "Binance Pay", "Steam Games", "Uber Trip", "Walmart Direct", "NordVPN", "Patreon Premium", "Netflix Streaming"];
const CATEGORIES = ["Online Retail", "Financial Services", "Electronics", "Crypto Purchase", "Gaming", "Travel/Mobility", "Subscription", "P2P Transfer"];
const DEVICES = ["iPhone 15 Pro", "macOS Sonoma (Safari)", "Windows 11 (Chrome)", "Android Samsung S24", "Linux (Firefox)", "iPad OS", "Unknown Device (Bot Header)"];

// Predefined model metrics 
const MODEL_PERFORMANCE_METRICS: Record<string, ModelPerformance> = {
  "XGBoost": {
    name: "XGBoost Classifier",
    accuracy: 0.985,
    precision: 0.972,
    recall: 0.961,
    f1Score: 0.966,
    rocAuc: 0.992,
    confusionMatrix: [[4850, 10], [15, 125]]
  },
  "Random Forest": {
    name: "Random Forest Ensemble",
    accuracy: 0.978,
    precision: 0.965,
    recall: 0.940,
    f1Score: 0.952,
    rocAuc: 0.987,
    confusionMatrix: [[4845, 15], [23, 117]]
  },
  "LightGBM": {
    name: "LightGBM Fast-Forest",
    accuracy: 0.982,
    precision: 0.979,
    recall: 0.948,
    f1Score: 0.963,
    rocAuc: 0.991,
    confusionMatrix: [[4852, 8], [20, 120]]
  },
  "Isolation Forest": {
    name: "Isolation Forest Anomaly Model",
    accuracy: 0.945,
    precision: 0.810,
    recall: 0.890,
    f1Score: 0.848,
    rocAuc: 0.932,
    confusionMatrix: [[4720, 140], [35, 105]]
  },
  "Deep Neural Networks": {
    name: "Deep Autoencoder",
    accuracy: 0.974,
    precision: 0.912,
    recall: 0.935,
    f1Score: 0.923,
    rocAuc: 0.976,
    confusionMatrix: [[4810, 50], [18, 122]]
  },
  "LSTM Sequential": {
    name: "Sequential LSTM Chain",
    accuracy: 0.989,
    precision: 0.983,
    recall: 0.968,
    f1Score: 0.975,
    rocAuc: 0.995,
    confusionMatrix: [[4855, 5], [12, 128]]
  }
};

interface DBState {
  transactions: Transaction[];
  cases: Case[];
  alerts: Alert[];
  auditLogs: AuditLog[];
  activeModelName: string;
}

let dbState: DBState = {
  transactions: [],
  cases: [],
  alerts: [],
  auditLogs: [],
  activeModelName: "XGBoost",
};

// Generates simulated transaction records
const generateRandomTransaction = (index: number = 0, isSpicy: boolean = false): Transaction => {
  const isFraud = isSpicy || Math.random() < 0.12;
  const tId = `TX-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const uId = `USR-${Math.floor(1000 + Math.random() * 9000)}`;
  const timestamp = new Date(Date.now() - (index * 45 * 60 * 1000)).toISOString();
  const amount = isFraud 
    ? Math.floor(800 + Math.random() * 9000) 
    : Math.floor(15 + Math.random() * 650);
  
  const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const country = isFraud && Math.random() < 0.40 ? COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)] : "US";
  const device = isFraud && Math.random() < 0.60 ? DEVICES[DEVICES.length - 1] : DEVICES[Math.floor(Math.random() * (DEVICES.length - 1))];
  const emailPrefixes = ["jane.doe", "mark.cyber", "alex.sys", "brian.gate", "linda.fin", "steve.wealth", "hacked.acc", "john.doe"];
  const email = `${emailPrefixes[Math.floor(Math.random() * emailPrefixes.length)]}${Math.floor(Math.random() * 99)}@gmail.com`;
  
  // IP Generation
  const ipPrefix = isFraud && Math.random() < 0.70 ? "198.51.100" : "192.168.1";
  const ipAddress = `${ipPrefix}.${Math.floor(2 + Math.random() * 254)}`;

  // Features
  const features = {
    timeSinceLastTxSec: isFraud ? Math.floor(Math.random() * 30) : Math.floor(600 + Math.random() * 25000),
    distanceFromLastTxKm: isFraud && Math.random() < 0.5 ? Math.floor(2500 + Math.random() * 12000) : Math.floor(Math.random() * 50),
    failedLoginsPrevHour: isFraud && Math.random() < 0.70 ? Math.floor(3 + Math.random() * 8) : 0,
    mouseHoverDurationMs: isFraud ? Math.floor(50 + Math.random() * 400) : Math.floor(2100 + Math.random() * 8000),
    deviceFingerprintRisk: isFraud ? parseFloat((0.80 + Math.random() * 0.20).toFixed(2)) : parseFloat((Math.random() * 0.15).toFixed(2)),
    isNewLocation: isFraud ? Math.random() < 0.80 : Math.random() < 0.05,
    isSuspiciousIp: isFraud ? Math.random() < 0.75 : Math.random() < 0.02,
    velocity1Hour: isFraud ? Math.floor(5 + Math.random() * 15) : Math.floor(1 + Math.random() * 2),
    cardZipMatchesBilling: isFraud ? Math.random() < 0.20 : Math.random() < 0.98,
  };

  // Calculate customized risk score
  let riskScore = 15;
  if (features.isSuspiciousIp) riskScore += 25;
  if (features.failedLoginsPrevHour > 2) riskScore += 20;
  if (features.distanceFromLastTxKm > 4000) riskScore += 25;
  if (features.deviceFingerprintRisk > 0.7) riskScore += 15;
  if (!features.cardZipMatchesBilling) riskScore += 15;
  if (features.mouseHoverDurationMs < 300) riskScore += 10; // bot pattern
  if (amount > 5000) riskScore += 10;
  
  riskScore = Math.min(Math.max(riskScore, 0), 99);
  
  let status = TransactionStatus.APPROVED;
  let fraudType = FraudType.AUTHENTIC;
  let explainReason = "Normal transactional behavior with safe device fingerprint and matched locations.";

  if (riskScore >= 75) {
    status = TransactionStatus.REJECTED;
    if (features.distanceFromLastTxKm > 4000 && features.timeSinceLastTxSec < 600) {
      fraudType = FraudType.IMPOSSIBLE_TRAVEL;
      explainReason = `Impossible Travel Flagged: Transaction in ${country} was initiated just ${Math.floor(features.timeSinceLastTxSec / 60)} minutes after prior purchase inside US. Estimated velocity is ${Math.round(features.distanceFromLastTxKm / (features.timeSinceLastTxSec / 3600))} km/h.`;
    } else if (features.failedLoginsPrevHour > 3) {
      fraudType = FraudType.ACCOUNT_TAKEOVER;
      explainReason = `Account Takeover suspect: Transaction authorized after high velocity of failed password attempts (${features.failedLoginsPrevHour} failed attempts in previous hour) combined with an unfamiliar device.`;
    } else if (features.mouseHoverDurationMs < 200 && features.deviceFingerprintRisk > 0.8) {
      fraudType = FraudType.BOT_VELOCITY;
      explainReason = `Automated Bot Threat: Interaction telemetry reports zero organic cursor tracking with standard hover durations (${features.mouseHoverDurationMs} ms). Suspicious bot user-agent identified.`;
    } else if (Math.random() < 0.5) {
      fraudType = FraudType.FRAUD_RING;
      explainReason = `Organized Fraud Ring Detected: IP Address range ${ipAddress} matches shared metadata parameters flagged under historical credit card fraud loops.`;
    } else {
      fraudType = FraudType.ID_THEFT;
      explainReason = `Identity Hijack suspected: Significant amount ($${amount}) spent under newly registered location coupled with card/billing ZIP validation failures.`;
    }
  } else if (riskScore >= 50) {
    status = TransactionStatus.FLAGGED;
    fraudType = FraudType.ID_THEFT;
    explainReason = `Suspicious Profile: Risk score of ${riskScore}% triggered by geographic anomaly, billing discrepancies, or device fingerprint variation.`;
  }

  // Autoencoder Anomaly Score simulator
  const anomalyScore = parseFloat((riskScore / 100).toFixed(3));

  // SHAP relative values calculations for explainable AI
  const shapValues: Record<string, number> = {
    "Amount Size": parseFloat(((amount > 1000 ? 0.15 : -0.05) + Math.random() * 0.05).toFixed(3)),
    "Geo Velocity": parseFloat((features.distanceFromLastTxKm > 2000 ? 0.35 : -0.15).toFixed(3)),
    "Failed Logins": parseFloat((features.failedLoginsPrevHour > 1 ? 0.25 : -0.10).toFixed(3)),
    "User Telementry": parseFloat((features.mouseHoverDurationMs < 500 ? 0.20 : -0.12).toFixed(3)),
    "Device Credibility": parseFloat((features.deviceFingerprintRisk > 0.5 ? 0.18 : -0.08).toFixed(3)),
  };

  return {
    id: tId,
    userId: uId,
    email,
    timestamp,
    amount,
    merchant,
    category,
    country,
    device,
    ipAddress,
    riskScore,
    status,
    fraudType,
    anomalyScore,
    explainReason,
    shapValues,
    features,
  };
};

// Start or load database state
const saveDbState = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2));
  } catch (err) {
    console.error("Failed to save local database state:", err);
  }
};

const initializeDatabase = () => {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      dbState = JSON.parse(data);
      console.log(`Database state loaded with ${dbState.transactions.length} items.`);
      return;
    } catch (e) {
      console.error("Stale database state, generating fresh logs.");
    }
  }

  // Pre-seed 60 transactions
  for (let i = 0; i < 60; i++) {
    dbState.transactions.push(generateRandomTransaction(i));
  }

  // Seed Active Alerts
  dbState.transactions
    .filter(t => t.status === TransactionStatus.REJECTED || t.status === TransactionStatus.FLAGGED)
    .slice(0, 12)
    .forEach((tx, idx) => {
      const alertId = `ALT-${1000 + idx}`;
      dbState.alerts.push({
        id: alertId,
        transactionId: tx.id,
        type: tx.fraudType,
        severity: tx.riskScore > 85 ? "Critical" : tx.riskScore > 65 ? "High" : "Medium",
        status: idx % 3 === 0 ? AlertStatus.ACTIVE : idx % 3 === 1 ? AlertStatus.INVESTIGATING : AlertStatus.RESOLVED,
        message: tx.explainReason,
        timestamp: tx.timestamp,
        channelsDispatched: ["Slack", "Email", "SMS", "Dashboard"]
      });
    });

  // Seed Cases
  const flaggedTxs = dbState.transactions.filter(t => t.status === TransactionStatus.REJECTED);
  flaggedTxs.slice(0, 6).forEach((tx, idx) => {
    const caseId = `CASE-${4000 + idx}`;
    const assignees = ["Agent Carver", "Agent Martinez", "Unassigned", "Agent Carver", "Investigator Sterling"];
    const assignee = assignees[idx % assignees.length];
    
    dbState.cases.push({
      id: caseId,
      transactionId: tx.id,
      riskScore: tx.riskScore,
      severity: tx.riskScore > 85 ? "Critical" : "High",
      status: idx % 2 === 0 ? CaseStatus.UNDER_REVIEW : idx % 3 === 0 ? CaseStatus.OPEN : CaseStatus.CLOSED_FRAUD,
      assignee,
      createdDate: tx.timestamp,
      notes: [
        {
          id: `NT-${idx}-1`,
          timestamp: tx.timestamp,
          author: "System Bot",
          content: `Real-time Kafka processor triggered audit alarm. Model risk probability stands at ${tx.riskScore}% matching category: ${tx.fraudType}.`
        },
        idx % 2 === 0 ? {
          id: `NT-${idx}-2`,
          timestamp: new Date(new Date(tx.timestamp).getTime() + 10 * 60 * 1000).toISOString(),
          author: "Agent Carver",
          content: "Investigating user association patterns. Connected emails show potential shared proxy networks matching suspicious device parameters."
        } : null
      ].filter(Boolean) as any[],
      evidenceFiles: idx % 2 === 0 ? ["IP_Lookup_Payload.pdf", "Device_Fingerprint_Capture.png"] : [],
      timeline: [
        {
          timestamp: tx.timestamp,
          event: "Ingest Flagged",
          description: `Transaction ${tx.id} exceeded alert score triggers.`
        },
        {
          timestamp: new Date(new Date(tx.timestamp).getTime() + 3000).toISOString(),
          event: "Alert Dispatched",
          description: "Notified team via #sec-fraud-alerts Slack hook."
        }
      ]
    });
  });

  // Seed Audit Logs
  const auditActions = [
    { action: "User Logged In", details: "Investigator abdulkashim444@gmail.com authenticated over session token (MFA Enabled)" },
    { action: "Case Transferred", details: "Case CASE-4001 assigned to Agent Martinez" },
    { action: "Model Switched", details: "Active pipeline model adjusted from Random Forest to XGBoost Classifier" },
    { action: "Alert Status Updated", details: "Alert ALT-1004 set to Investigating" },
    { action: "Case Investigated", details: "Closed Case CASE-4003 with outcome: Confirmed Organized Fraud Ring" },
  ];

  auditActions.forEach((aud, idx) => {
    dbState.auditLogs.push({
      id: `LOG-${Math.floor(100000 + Math.random() * 900000)}`,
      timestamp: new Date(Date.now() - (idx * 6 * 60 * 60 * 1000)).toISOString(),
      user: "abdulkashim444@gmail.com",
      role: "Investigator",
      action: aud.action,
      ipAddress: "192.168.1.155",
      details: aud.details
    });
  });

  saveDbState();
};

initializeDatabase();

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// HEALTH
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// SYSTEM STATE & METRICS
app.get("/api/dashboard/metrics", (req, res) => {
  const txs = dbState.transactions;
  const approved = txs.filter(t => t.status === TransactionStatus.APPROVED);
  const flagged = txs.filter(t => t.status === TransactionStatus.FLAGGED);
  const rejected = txs.filter(t => t.status === TransactionStatus.REJECTED);
  
  const totalAmount = txs.reduce((sum, t) => sum + t.amount, 0);
  const fraudAmount = txs.filter(t => t.status === TransactionStatus.REJECTED || t.status === TransactionStatus.FLAGGED)
    .reduce((sum, t) => sum + t.amount, 0);

  // protected value consists of total value of rejected transactions
  const revenueProtected = txs.filter(t => t.status === TransactionStatus.REJECTED)
    .reduce((sum, t) => sum + t.amount, 0);

  res.json({
    totalTransactions: txs.length,
    legitimateCount: approved.length,
    flaggedCount: flagged.length,
    fraudulentCount: rejected.length,
    fraudRate: txs.length > 0 ? parseFloat(((rejected.length / txs.length) * 100).toFixed(2)) : 0,
    revenueProtected,
    averageRiskScore: txs.length > 0 ? Math.round(txs.reduce((sum, t) => sum + t.riskScore, 0) / txs.length) : 0,
    activeModel: dbState.activeModelName,
  });
});

// GET TRANSACTION STREAM (Supports query limits for paging)
app.get("/api/transactions", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 1000;
  res.json(dbState.transactions.slice(0, limit));
});

// POST STREAM SIMULATED TRANSACTION
app.post("/api/transactions/stream-trigger", (req, res) => {
  const isSpicy = req.body.spicy === true;
  const newTx = generateRandomTransaction(0, isSpicy);
  
  dbState.transactions.unshift(newTx);
  if (dbState.transactions.length > 500) {
    dbState.transactions.pop();
  }

  // Create alert if appropriate
  if (newTx.status === TransactionStatus.REJECTED || newTx.status === TransactionStatus.FLAGGED) {
    const alertId = `ALT-${1000 + dbState.alerts.length}`;
    const channels: ("Email" | "SMS" | "Slack" | "Dashboard")[] = ["Dashboard"];
    if (newTx.riskScore > 85) channels.push("Slack", "SMS", "Email");

    const newAlert: Alert = {
      id: alertId,
      transactionId: newTx.id,
      type: newTx.fraudType,
      severity: newTx.riskScore > 85 ? "Critical" : newTx.riskScore > 65 ? "High" : "Medium",
      status: AlertStatus.ACTIVE,
      message: newTx.explainReason,
      timestamp: newTx.timestamp,
      channelsDispatched: channels,
    };
    dbState.alerts.unshift(newAlert);

    // Create automatic Case too
    const caseId = `CASE-${4000 + dbState.cases.length}`;
    dbState.cases.unshift({
      id: caseId,
      transactionId: newTx.id,
      riskScore: newTx.riskScore,
      severity: newTx.riskScore > 85 ? "Critical" : "High",
      status: CaseStatus.OPEN,
      assignee: "Unassigned",
      createdDate: newTx.timestamp,
      notes: [{
        id: `NT-${Date.now()}`,
        timestamp: newTx.timestamp,
        author: "Kafka Stream Listener",
        content: `Ingesting transaction ${newTx.id} - flagged with risk score of ${newTx.riskScore} (${newTx.explainReason}).`
      }],
      evidenceFiles: [],
      timeline: [
        { timestamp: newTx.timestamp, event: "Kafka Stream Ingestion", description: "Stream registered high threat score." },
        { timestamp: newDatePlus(newTx.timestamp, 1500), event: "Alert Casted", description: `Slack push dispatch completed for: ${newTx.fraudType}` }
      ]
    });
  }

  logAudit(
    "Automated Generator",
    "Kafka Engine",
    "Ingested Real-time Transaction",
    newTx.ipAddress,
    `Transaction ${newTx.id} processed from user: ${newTx.email} - status: ${newTx.status}`
  );

  saveDbState();
  res.json({ transaction: newTx, didAlert: newTx.status !== TransactionStatus.APPROVED });
});

// ALERTS RESOURCE
app.get("/api/alerts", (req, res) => {
  res.json(dbState.alerts);
});

app.put("/api/alerts/:id", (req, res) => {
  const alertId = req.params.id;
  const { status } = req.body;
  const found = dbState.alerts.find(a => a.id === alertId);
  if (found) {
    found.status = status;
    logAudit("abdulkashim444@gmail.com", "Investigator", "Updated Alert", "127.0.0.1", `Set alert ${alertId} status to ${status}`);
    saveDbState();
    res.json(found);
  } else {
    res.status(404).json({ error: "Alert not found" });
  }
});

// CASE MANAGEMENT REST API
app.get("/api/cases", (req, res) => {
  res.json(dbState.cases);
});

app.post("/api/cases", (req, res) => {
  const { transactionId, severity, status, assignee, notesText } = req.body;
  const tx = dbState.transactions.find(t => t.id === transactionId);
  if (!tx) {
    return res.status(400).json({ error: "Source transaction not found" });
  }

  const caseId = `CASE-${4000 + dbState.cases.length}`;
  const newCase: Case = {
    id: caseId,
    transactionId,
    riskScore: tx.riskScore,
    severity: severity || "High",
    status: status || CaseStatus.OPEN,
    assignee: assignee || "Unassigned",
    createdDate: new Date().toISOString(),
    notes: notesText ? [{
      id: `NT-${Date.now()}`,
      timestamp: new Date().toISOString(),
      author: "abdulkashim444@gmail.com",
      content: notesText
    }] : [],
    evidenceFiles: [],
    timeline: [
      { timestamp: new Date().toISOString(), event: "Manual Case Creation", description: `Case initialized from transaction: ${transactionId}` }
    ]
  };

  dbState.cases.unshift(newCase);
  logAudit("abdulkashim444@gmail.com", "Investigator", "Created Case", "127.0.0.1", `Case ${caseId} raised on transaction ${transactionId}`);
  saveDbState();
  res.status(210).json(newCase);
});

app.put("/api/cases/:id", (req, res) => {
  const caseId = req.params.id;
  const { status, assignee, noteText, evidenceFile, severity } = req.body;
  const found = dbState.cases.find(c => c.id === caseId);
  if (found) {
    if (status) found.status = status;
    if (assignee) found.assignee = assignee;
    if (severity) found.severity = severity;
    if (noteText) {
      found.notes.push({
        id: `NT-${Date.now()}`,
        timestamp: new Date().toISOString(),
        author: "abdulkashim444@gmail.com",
        content: noteText
      });
      found.timeline.push({
         timestamp: new Date().toISOString(),
         event: "Note Added",
         description: `Investigator added annotation: "${noteText.substring(0,30)}..."`
      });
    }
    if (evidenceFile) {
      found.evidenceFiles.push(evidenceFile);
      found.timeline.push({
        timestamp: new Date().toISOString(),
        event: "Evidence Uploaded",
        description: `Attached security manifest file: ${evidenceFile}`
     });
    }
    logAudit("abdulkashim444@gmail.com", "Investigator", "Modified Case Details", "127.0.0.1", `Updated Case values for ${caseId}`);
    saveDbState();
    res.json(found);
  } else {
    res.status(404).json({ error: "Case not found" });
  }
});

// GRAPH GENERATOR - Dynamic Relationship link graph calculated based on transactions matching user emails, devices, IP
app.get("/api/graph", (req, res) => {
  const txs = dbState.transactions.slice(0, 30); // Use 30 recent transactions to keep graph legible
  const nodesMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  txs.forEach((tx) => {
    // Transaction Node
    nodesMap.set(tx.id, {
      id: tx.id,
      label: `Tx: $${tx.amount}`,
      type: "Transaction",
      riskScore: tx.riskScore,
      group: tx.fraudType === FraudType.AUTHENTIC ? "Authentic" : "Suspicious"
    });

    // User/Email Node
    const emailNodeId = `EMAIL-${tx.email}`;
    nodesMap.set(emailNodeId, {
      id: emailNodeId,
      label: tx.email,
      type: "Email",
      riskScore: tx.status === TransactionStatus.REJECTED ? tx.riskScore : 10,
      group: tx.status === TransactionStatus.REJECTED ? "Suspicious" : "Authentic"
    });

    // Device Node
    const deviceNodeId = `DEV-${tx.device.replace(/\s+/g, "_")}`;
    nodesMap.set(deviceNodeId, {
      id: deviceNodeId,
      label: tx.device,
      type: "Device",
      riskScore: tx.features.deviceFingerprintRisk * 100,
      group: tx.features.deviceFingerprintRisk > 0.6 ? "Suspicious" : "Authentic"
    });

    // IP Node
    const ipNodeId = `IP-${tx.ipAddress}`;
    nodesMap.set(ipNodeId, {
      id: ipNodeId,
      label: tx.ipAddress,
      type: "Ip",
      riskScore: tx.features.isSuspiciousIp ? 80 : 10,
      group: tx.features.isSuspiciousIp ? "Suspicious" : "Authentic"
    });

    // Create associations
    edges.push({
      source: tx.id,
      target: emailNodeId,
      label: "initiated_by",
      type: "associated_with"
    });
    edges.push({
      source: tx.id,
      target: deviceNodeId,
      label: "used_device",
      type: "processed"
    });
    edges.push({
      source: tx.id,
      target: ipNodeId,
      label: "sent_from",
      type: "linked"
    });
  });

  res.json({
    nodes: Array.from(nodesMap.values()),
    edges,
  });
});

// MODEL SWITCH SELECTION
app.get("/api/models/performance", (req, res) => {
  res.json(MODEL_PERFORMANCE_METRICS);
});

app.post("/api/models/select", (req, res) => {
  const { name } = req.body;
  if (MODEL_PERFORMANCE_METRICS[name]) {
    dbState.activeModelName = name;
    logAudit("abdulkashim444@gmail.com", "Investigator", "Changed Pipeline Model", "127.0.0.1", `Active execution classification adjusted to: ${name}`);
    saveDbState();
    res.json({ status: "success", activeModel: name });
  } else {
    res.status(400).json({ error: "Invalid model selection" });
  }
});

// AUDIT RESOURCE
app.get("/api/audit-logs", (req, res) => {
  res.json(dbState.auditLogs);
});

// CO-PILOT ASSISTANT WITH GEMINI CLIENT (With robust expert fallback if key is unconfigured)
const getGeminiClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "MY_GEMINI_API_KEY" || key.trim() === "") {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

app.post("/api/copilot/chat", async (req, res) => {
  const { message, contextCase, contextTx } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Query message is required" });
  }

  const ai = getGeminiClient();
  let systemPrompt = `You are the SafeGuard Enterprise AI Fraud Investigator Copilot.
You assist financial analysts, compliance managers, and cybersecurity investigators in identifying card fraud, fraud rings, and account takeover patterns.
Speak with high professional composure, analytical precision, and absolute domain competence (FS-ISAC style).`;

  if (contextCase) {
    systemPrompt += `\nYou are currently analyzing Case: ${contextCase.id}.
Transaction Target: ${contextCase.transactionId}
Reported Risk Score: ${contextCase.riskScore}%
Reported Threat Category: ${contextCase.notes?.[0]?.content || "Suspicious transaction"}
Timeline log details: ${JSON.stringify(contextCase.timeline)}`;
  } else if (contextTx) {
    systemPrompt += `\nYou are currently analyzing Transaction: ${contextTx.id}.
Amount: $${contextTx.amount} | Country: ${contextTx.country} | Device: ${contextTx.device} | IP: ${contextTx.ipAddress}
Risk Score: ${contextTx.riskScore}% | Alert Reason: ${contextTx.explainReason}
Captured telemetry log: time-since-last-tx=${contextTx.features?.timeSinceLastTxSec}s, geo-distance=${contextTx.features?.distanceFromLastTxKm}km, failed-logins-hour=${contextTx.features?.failedLoginsPrevHour}`;
  }

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: message,
        config: {
          systemInstruction: systemPrompt,
        }
      });
      res.json({ answer: response.text });
    } catch (e: any) {
      console.error("Gemini invocation failed:", e);
      // Fallback response with error details
      const fallbackAns = generateExpertFallbackResponse(message, contextCase, contextTx, e.message);
      res.json({ answer: fallbackAns });
    }
  } else {
    // No model key configuration -> Serve rich, interactive local Expert Rule System analysis which is extremely competent
    const fallbackAns = generateExpertFallbackResponse(message, contextCase, contextTx, "API Key unconfigured or using template default value.");
    res.json({ answer: fallbackAns });
  }
});

// TRANSACTION / CASE REPORT EXPLAINER
app.post("/api/copilot/explain", async (req, res) => {
  const { transactionId } = req.body;
  const tx = dbState.transactions.find(t => t.id === transactionId);
  if (!tx) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  const ai = getGeminiClient();
  const queryPrompt = `Provide a full, detailed, professional regulatory compliance fraud investigation brief for the following transaction:
- ID: ${tx.id}
- Amount: $${tx.amount}
- User Email: ${tx.email}
- Threat Classification: ${tx.fraudType}
- Technical Metrics Profile:
  - Ip Range: ${tx.ipAddress} (IP Flagged SUSPICIOUS: ${tx.features.isSuspiciousIp})
  - Fingerprint Anomaly Index: ${tx.features.deviceFingerprintRisk}
  - Hover Action Speed: ${tx.features.mouseHoverDurationMs} ms
  - Prior Failed Attempts: ${tx.features.failedLoginsPrevHour} logins
  - Space Interval Distance: ${tx.features.distanceFromLastTxKm} km within ${tx.features.timeSinceLastTxSec} seconds.

Please format the brief with these specific sections:
1. EXECUTIVE SUMMARY & DECISION ALGORITHM
2. TECHNICAL ANOMALY DEEP-DIVE (Analyzing mouse speed, device profile, login count)
3. IMPLICATED REPUTATIONAL OR COMPLIANCE THREATS
4. ACTIONABLE PROTOCOLS FOR THE DEPUTED RESPONSE TEAM (Case assignment, lockout, SAR filings)`;

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: queryPrompt,
        config: {
          systemInstruction: "You are an automated regulatory risk analyst and Deep Learning model interpreter. Generate dense, structured, professional explanations with high compliance value."
        }
      });
      res.json({ report: response.text });
    } catch (e: any) {
      res.json({ report: generateExpertReportFallback(tx, e.message) });
    }
  } else {
    res.json({ report: generateExpertReportFallback(tx) });
  }
});

// Helper calculators
function newDatePlus(isoString: string, ms: number): string {
  return new Date(new Date(isoString).getTime() + ms).toISOString();
}

function generateExpertFallbackResponse(msg: string, contextCase: any, contextTx: any, apiErr: string): string {
  const lowerMsg = msg.toLowerCase();
  
  let header = `### SafeGuard AI Copilot (Expert Engine Mode)\n*Note: Operating under local compliance ruleset constraints as process.env.GEMINI_API_KEY is utilizing the default sandbox token.* \n\n`;
  
  if (contextCase) {
    if (lowerMsg.includes("summary") || lowerMsg.includes("summarize")) {
      return header + `**Analytical Case Review for ${contextCase.id}**
- **Trigger**: System registered transaction fraud alert of level **${contextCase.severity}** (Score: ${contextCase.riskScore}%).
- **Target Fraud Mechanics**: Associated with transaction risk type **${contextCase.notes?.[0]?.content}**.
- **Investigation Status**: Curated as **${contextCase.status}** and delegated to **${contextCase.assignee}**.
- **Assessment**: Analysis reveals high proximity correlation with coordinated proxy pools. The user device signature displays severe configuration inconsistencies.
- **Recommended Action**: Retain temporal freeze on associated crypto deposits; request official proof of hardware possession via multi-factor credentials.`;
    }
    if (lowerMsg.includes("sar") || lowerMsg.includes("suspicious activity report")) {
      return header + `**DRAFT: Suspicious Activity Report (SAR-114)**
- **Filing Date**: ${new Date().toLocaleDateString()}
- **Subject Case/Tx**: Flagged Transaction in Case ${contextCase.id}
- **Suspect Entity**: ${contextCase.assignee !== "Unassigned" ? contextCase.assignee : "External Account Holder"}
- **Fraud Classification**: Organized Proxy Routing / Identity Compromise
- **Context Narrative**: Live alert flagged anomalous velocity variables. Spatial mismatch of coordinates constitutes high statistical certainty of automated credential swapping. Access points indicate the IP belongs to temporary commercial VPN nodes.
- **Action Directed**: Recommended for full regulatory filing and account termination.`;
    }
  }

  if (lowerMsg.includes("fraud ring") || lowerMsg.includes("organized")) {
    return header + `#### Organized Fraud Ring Detection Blueprint
1. **Network Cluster Proximity**: Standard fraud rings utilize shared vectors: matching registration ZIPs, common device fingerprints, and identical subnets (mostly IP blocks of the form '198.51.100.x').
2. **Behavioral Indicators**: Robotic navigation velocities, 100% success rate on key entry with 0ms delay between password inputs (indicates automated bot automation), and rapid succession transactions across discrete accounts in <2 minutes.
3. **Prevention Strategy**: Apply PageRank routing to locate central connection nodes in transaction graphs. Block IP ranges immediately and force immediate multi-factor video recognition challenge loops.`;
  }

  if (lowerMsg.includes("failed logins") || lowerMsg.includes("login") || lowerMsg.includes("mfa")) {
    return header + `#### Account Takeover (ATO) Prevention Protocols
- **Symptom**: Spikes in credential failed counts (e.g. 5+ failed attempts followed by immediate high-value purchase).
- **Secondary Flag**: Instantaneous switch from mobile client to automated headless scrapers.
- **Action Standard**: Terminate session access cookie immediately, trigger real-time trigger SMS-out of 6-digit challenge code, and require confirmation of biometric credentials.`;
  }

  return header + `**Security Query Resolved: Analytical Expert System Advice**
I am here to guide your investigation. You asked: "*${msg}*"

Here is our specialized fraud mitigation guideline:
1. **Explainable Features**: Verify SHAP metrics for dynamic risk weights: Geo velocity outliers contribute the highest weight inside our neural model.
2. **Continuous Spark Streaming Monitoring**: Real-time traffic tracking is operational (status: nominal, latency: 14ms).
3. **Graph Co-associations**: Inspect the Graph Network visualizer to identify shared hardware tokens or common emails.
4. **Interactive Actions**: You can update cases, input custom clinical notes, attach logs, or invoke direct account freezes using the primary investigation card tools.`;
}

function generateExpertReportFallback(tx: Transaction, errorDetails?: string): string {
  const errorAlert = errorDetails ? `*Analytical Notice: Report synthesized via safe expert rule classification engine. (API Key Notice: ${errorDetails})*\n\n` : "";
  
  return `${errorAlert}# COMPLIANCE AUDIT & THREAT EVALUATION BRIEF
## REFERENCE ID: COMP-${tx.id} | THREAT CLASSIFICATION: ${tx.fraudType}

### 1. EXECUTIVE SUMMARY & DECISION ALGORITHM
On ${new Date(tx.timestamp).toLocaleString()}, the platform's high-performance machine learning models observed a financial operation valued at **$${tx.amount.toLocaleString()}** that breached acceptable threat containment levels. The transaction status is assigned as **${tx.status}** with a rigorous risk index of **${tx.riskScore}%**. 

**Decision Boundary Formula Status:** 
$$\\text{Risk Score} = w_1 \\cdot \\text{SusIp} (25) + w_2 \\cdot \\text{GeoVelocity} (25) + w_3 \\cdot \\text{LoginAttempts} (20) + w_4 \\cdot \\text{FingRisk} (15)$$
Our isolation threshold ($75$) was officially breached. Dynamic alarm dispatch protocol was initiated within 11.4ms of ingest.

---

### 2. TECHNICAL ANOMALY DEEP-DIVE
An analysis of sensory, spatial, network, and environmental telemetry records reveals:
*   **Behavioral Interface Interaction**: The mouse tracking telemetry records a total hover period of **${tx.features.mouseHoverDurationMs} ms** prior to final commit. Standard human latency stands between 1500ms and 5000ms. Velocities below 300ms signify direct headless scripted injections (bot execution).
*   **Failed Authentication Footprint**: Investigation records flag **${tx.features.failedLoginsPrevHour} validation failures** in the hour preceding this event. The velocity index denotes brute-force, dictionary, or credential stuffing operations.
*   **Geospatial Impossible Travel Velocity**: Geolocation telemetry registers a coordinate leap of **${tx.features.distanceFromLastTxKm} kilometers** within **${tx.features.timeSinceLastTxSec} seconds**. This requires a linear velocity exceeding 40,000 km/h, breaching fundamental spatial laws (Impossible Travel confirmed).

---

### 3. RELATIONAL ANALYSIS & SUSPECT SUB-NETS
*   **IP Address Address Space**: Flagged endpoint is **${tx.ipAddress}**. Database queries identify this address range as belonging to commercial bulletproof VPN hosting lockers in region: ${tx.country}.
*   **Shared Token Infrastructure**: The client device identifier (**${tx.device}**) correlates with similar high-risk authentication incidents across multiple independent emails, suggesting active fraud rings.

---

### 4. MANDATED COMPLIANCE PROTOCOLS
To fulfill anti-money laundering (AML) and financial threat compliance statutes, the deputed response team has enacted these countermeasures:
1.  **Immediate Settlement Suspension**: Hold the transfer of instructions for $${tx.amount.toLocaleString()} to merchant *${tx.merchant}*.
2.  **Account Access Revocation**: Unlink associated device tokens and flag user account *${tx.email}* as lock-out status under state code: 8A-SUSPECT.
3.  **Active Case Assignment**: Transfer case to automated compliance queue under severity rating **HIGH**. Filing of official SAR (Suspicious Activity Report) is scheduled within 24 Hours.`;
}

// Serve Vite frontend in dev, static files in production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Support React Router / SPA fallbacks
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SafeGuard Engine] Fraud Intelligence Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
