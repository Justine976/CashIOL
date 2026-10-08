const path = require("path");
const express = require("express");
const helmet = require("helmet");
require("dotenv").config();

const mayaCashIn = require("./providers/maya/cashin");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CashIOL API",
    environment: process.env.NODE_ENV || "development",
    providerMode: process.env.MAYA_API_BASE_URL && process.env.MAYA_SECRET_KEY ? "maya-configured" : "sandbox-not-configured"
  });
});

app.get("/api/products/load", (_req, res) => {
  res.json({ products: [
    { id: "globe-100", network: "Globe", name: "Globe Regular Load ₱100", amount: 100 },
    { id: "smart-100", network: "Smart", name: "Smart Regular Load ₱100", amount: 100 },
    { id: "dito-100", network: "DITO", name: "DITO Regular Load ₱100", amount: 100 }
  ]});
});

app.post("/api/cash-in/maya/initiate", async (req, res) => {
  const { cashInCode, amount } = req.body || {};
  const numericAmount = Number(amount);

  if (!/^\d{7}$/.test(String(cashInCode || ""))) {
    return res.status(400).json({ error: "Enter a valid 7-digit Maya Cash-In Code." });
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Enter a valid cash-in amount." });
  }

  const referenceId = `CIO-${Date.now()}`;

  try {
    const maya = await mayaCashIn.createTransfer({
      cashInCode,
      amount: numericAmount,
      referenceId
    });

    res.status(202).json({
      message: "Maya cash-in transfer created. Admin confirmation is required before execution.",
      transaction: {
        id: referenceId,
        type: "cash-in",
        provider: "maya",
        amount: numericAmount,
        status: maya.status || "CREATED",
        transferId: maya.transferId || maya.id || null,
        providerResponse: maya
      }
    });
  } catch (error) {
    console.error("Maya initiate error:", error.message);
    res.status(error.status || 502).json({
      error: error.code === "MAYA_NOT_CONFIGURED"
        ? "Maya sandbox is not configured on the CashIOL server yet."
        : error.message,
      provider: "maya"
    });
  }
});

app.post("/api/cash-in/maya/execute", async (req, res) => {
  const { transferId } = req.body || {};

  if (!transferId) {
    return res.status(400).json({ error: "Maya transferId is required." });
  }

  try {
    const maya = await mayaCashIn.executeTransfer(transferId);
    res.json({
      message: "Maya cash-in execution requested.",
      transaction: {
        provider: "maya",
        transferId,
        status: maya.status || "PROCESSING",
        providerResponse: maya
      }
    });
  } catch (error) {
    console.error("Maya execute error:", error.message);
    res.status(error.status || 502).json({
      error: error.message,
      provider: "maya"
    });
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

app.post("/api/transactions", (req, res) => {
  const { type, amount, mobile, productId } = req.body || {};

  if (!["cash-in", "cash-out", "load"].includes(type)) {
    return res.status(400).json({ error: "Unsupported transaction type." });
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A valid amount is required." });
  }
  if (type === "cash-out") {
    return res.status(400).json({ error: "Cash-out is QR-only and does not accept customer-entered information." });
  }
  if (type === "load" && !/^09\d{9}$/.test(String(mobile || ""))) {
    return res.status(400).json({ error: "Enter a valid Philippine mobile number." });
  }

  const transaction = {
    id: "CIO-" + Date.now(),
    type,
    amount: Number(amount),
    mobile: mobile || null,
    productId: productId || null,
    status: "PENDING_PROVIDER",
    createdAt: new Date().toISOString()
  };

  res.status(202).json({
    message: "Transaction created. Use the provider-specific endpoint for live provider movement.",
    transaction
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`CashIOL running at http://localhost:${PORT}`));
