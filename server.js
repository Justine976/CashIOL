const path = require("path");
const express = require("express");
const helmet = require("helmet");
require("dotenv").config();

const mayaCashIn = require("./providers/maya/cashin");

const app = express();
const PORT = process.env.PORT || 3000;
const transactions = new Map();
const clients = new Set();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function publicTransaction(transaction) {
  return { ...transaction };
}

function broadcast(event, transaction) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(publicTransaction(transaction))}\n\n`;
  for (const response of clients) response.write(payload);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CashIOL API",
    environment: process.env.NODE_ENV || "development",
    providerMode: process.env.MAYA_API_BASE_URL && process.env.MAYA_SECRET_KEY ? "maya-configured" : "sandbox-not-configured",
    realtime: "sse"
  });
});

app.get("/api/products/load", (_req, res) => {
  res.json({ products: [
    { id: "globe-100", network: "Globe", name: "Globe Regular Load ₱100", amount: 100 },
    { id: "smart-100", network: "Smart", name: "Smart Regular Load ₱100", amount: 100 },
    { id: "dito-100", network: "DITO", name: "DITO Regular Load ₱100", amount: 100 }
  ]});
});

app.get("/api/transactions", (_req, res) => {
  res.json({ transactions: [...transactions.values()].map(publicTransaction) });
});

app.get("/api/transactions/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.post("/api/transactions", (req, res) => {
  const { type, amount, mobile, productId, network } = req.body || {};
  const numericAmount = Number(amount);

  if (!["cash-in", "cash-out", "load"].includes(type)) {
    return res.status(400).json({ error: "Unsupported transaction type." });
  }
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "A valid amount is required." });
  }
  if (type === "load" && !/^09\d{9}$/.test(String(mobile || ""))) {
    return res.status(400).json({ error: "Enter a valid Philippine mobile number." });
  }

  const id = `CIO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const transaction = {
    id,
    ref: id,
    type,
    amount: numericAmount,
    mobile: mobile || null,
    productId: productId || null,
    network: network || null,
    status: type === "cash-out" ? "WAITING_FOR_DIGITAL_PAYMENT" : "WAITING_FOR_CASH",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  transactions.set(id, transaction);
  broadcast("transaction-created", transaction);
  res.status(201).json({ transaction: publicTransaction(transaction) });
});

app.patch("/api/transactions/:id", (req, res) => {
  const transaction = transactions.get(req.params.id);
  if (!transaction) return res.status(404).json({ error: "Transaction not found." });

  const { action } = req.body || {};
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Action must be approve or reject." });
  }

  transaction.status = action === "reject"
    ? "REJECTED_BY_ADMIN"
    : transaction.type === "cash-in"
      ? "DIGITAL_CREDIT_READY"
      : transaction.type === "cash-out"
        ? "CASH_RELEASED"
        : "APPROVED_BY_ADMIN";
  transaction.adminApprovedAt = action === "approve" ? new Date().toISOString() : null;
  transaction.updatedAt = new Date().toISOString();

  transactions.set(transaction.id, transaction);
  broadcast("transaction-updated", transaction);
  res.json({ transaction: publicTransaction(transaction) });
});

app.post("/api/cash-in/maya/initiate", async (req, res) => {
  const { cashInCode, amount } = req.body || {};
  const numericAmount = Number(amount);
  if (!/^\d{7}$/.test(String(cashInCode || ""))) return res.status(400).json({ error: "Enter a valid 7-digit Maya Cash-In Code." });
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: "Enter a valid cash-in amount." });
  const referenceId = `CIO-${Date.now()}`;

  try {
    const maya = await mayaCashIn.createTransfer({ cashInCode, amount: numericAmount, referenceId });
    res.status(202).json({ message: "Maya cash-in transfer created. Admin confirmation is required before execution.", transaction: { id: referenceId, type: "cash-in", provider: "maya", amount: numericAmount, status: maya.status || "CREATED", transferId: maya.transferId || maya.id || null, providerResponse: maya } });
  } catch (error) {
    console.error("Maya initiate error:", error.message);
    res.status(error.status || 502).json({ error: error.code === "MAYA_NOT_CONFIGURED" ? "Maya sandbox is not configured on the CashIOL server yet." : error.message, provider: "maya" });
  }
});

app.post("/api/cash-in/maya/execute", async (req, res) => {
  const { transferId } = req.body || {};
  if (!transferId) return res.status(400).json({ error: "Maya transferId is required." });
  try {
    const maya = await mayaCashIn.executeTransfer(transferId);
    res.json({ message: "Maya cash-in execution requested.", transaction: { provider: "maya", transferId, status: maya.status || "PROCESSING", providerResponse: maya } });
  } catch (error) {
    console.error("Maya execute error:", error.message);
    res.status(error.status || 502).json({ error: error.message, provider: "maya" });
  }
});

app.get("/api/cash-in/maya/:transferId", async (req, res) => {
  try {
    const maya = await mayaCashIn.getTransfer(req.params.transferId);
    res.json({ provider: "maya", transaction: maya });
  } catch (error) {
    console.error("Maya retrieve error:", error.message);
    res.status(error.status || 502).json({ error: error.message, provider: "maya" });
  }
});

app.get("/api/cash-in/maya/balance", async (_req, res) => {
  try {
    const maya = await mayaCashIn.getBalance();
    res.json({ provider: "maya", balance: maya });
  } catch (error) {
    console.error("Maya balance error:", error.message);
    res.status(error.status || 502).json({ error: error.message, provider: "maya" });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`CashIOL running at http://localhost:${PORT}`));
