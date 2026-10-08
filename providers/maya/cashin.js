const MAYA_API_BASE_URL = (process.env.MAYA_API_BASE_URL || "").replace(/\/$/, "");

function requireConfig() {
  if (!MAYA_API_BASE_URL || !process.env.MAYA_SECRET_KEY) {
    const error = new Error("Maya sandbox is not configured. Set MAYA_API_BASE_URL and MAYA_SECRET_KEY on the server.");
    error.code = "MAYA_NOT_CONFIGURED";
    throw error;
  }
}

function authHeader() {
  return "Basic " + Buffer.from(`${process.env.MAYA_SECRET_KEY}:`).toString("base64");
}

async function mayaRequest(path, options = {}) {
  requireConfig();

  const response = await fetch(`${MAYA_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(body?.message || `Maya API returned HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function createTransfer({ cashInCode, amount, referenceId }) {
  if (!/^\d{7}$/.test(String(cashInCode || ""))) {
    const error = new Error("Maya Cash-In Code must be a 7-digit code.");
    error.code = "INVALID_CASH_IN_CODE";
    throw error;
  }

  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    const error = new Error("A valid cash-in amount is required.");
    error.code = "INVALID_AMOUNT";
    throw error;
  }

  return mayaRequest("/transfers", {
    method: "POST",
    body: JSON.stringify({
      amount: Number(amount),
      cashInCode: String(cashInCode),
      referenceId
    })
  });
}

async function executeTransfer(transferId) {
  if (!transferId) throw new Error("Maya transferId is required.");
  return mayaRequest(`/transfers/${encodeURIComponent(transferId)}/execute`, {
    method: "PUT",
    body: JSON.stringify({})
  });
}

async function getTransfer(transferId) {
  if (!transferId) throw new Error("Maya transferId is required.");
  return mayaRequest(`/transfers/${encodeURIComponent(transferId)}`, { method: "GET" });
}

async function getBalance() {
  return mayaRequest("/balance", { method: "GET" });
}

module.exports = {
  createTransfer,
  executeTransfer,
  getTransfer,
  getBalance
};
