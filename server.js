const path = require("path");
const express = require("express");
const helmet = require("helmet");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "CashIOL API", environment: process.env.NODE_ENV || "development", providerMode: "sandbox-ready" });
});

app.get("/api/products/load", (_req, res) => {
  res.json({ products: [
    { id: "globe-100", network: "Globe", name: "Globe Regular Load ₱100", amount: 100 },
    { id: "smart-100", network: "Smart", name: "Smart Regular Load ₱100", amount: 100 },
    { id: "dito-100", network: "DITO", name: "DITO Regular Load ₱100", amount: 100 }
  ]});
});

app.post("/api/transactions", (req, res) => {
  const { type, amount, mobile, productId } = req.body || {};

  if (!["cash-in", "cash-out", "load"].includes(type)) {
    return res.status(400).json({ error: "Unsupported transaction type." });
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A valid amount is required." });
  }
  if (type !== "cash-in" && !/^09\d{9}$/.test(String(mobile || ""))) {
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
    message: "Transaction created. Provider integration is required before live money movement.",
    transaction
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`CashIOL running at http://localhost:${PORT}`));
