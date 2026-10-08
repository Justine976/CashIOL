const state = { transactions: [], stream: null, adminUnlocked: false };
const ADMIN_PIN = "123456";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function setView(view) {
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}-view`));
  $$('[data-view]').forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  const titles = { dashboard: "Business overview", "cash-in": "Cash In", "cash-out": "Cash Out", load: "Mobile Load", transactions: "Transactions", admin: "Admin verification" };
  if ($("#page-title")) $("#page-title").textContent = titles[view] || "CashIOL";
}

function renderTransactions() {
  const list = $("#transaction-list");
  if (!list) return;
  if (!state.transactions.length) {
    list.innerHTML = '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';
    return;
  }
  list.innerHTML = state.transactions.map((t) => `
    <tr><td><strong>${escapeHtml(t.ref || t.id)}</strong></td><td>${escapeHtml((t.type || "").replaceAll("-", " "))}</td><td>${peso(t.amount)}</td><td>${escapeHtml((t.status || "").replaceAll("_", " "))}</td><td>${escapeHtml(new Date(t.createdAt).toLocaleString("en-PH"))}</td></tr>
  `).join("");
}

function renderStats() {
  const cards = $$(".stats-grid .stat-card strong");
  const pending = state.transactions.filter((t) => ["WAITING_FOR_CASH", "WAITING_FOR_DIGITAL_PAYMENT", "WAITING_FOR_ADMIN"].includes(t.status)).length;
  const successful = state.transactions.filter((t) => ["APPROVED_BY_ADMIN", "DIGITAL_CREDIT_READY", "CASH_RELEASED"].includes(t.status)).length;
  if (cards[1]) cards[1].textContent = state.transactions.length;
  if (cards[2]) cards[2].textContent = successful;
  if (cards[3]) cards[3].textContent = pending;
}

function renderAdmin() {
  const box = $("#pending-list");
  const count = $("#pending-count");
  if (!box || !count) return;
  const pending = state.transactions.filter((t) => ["WAITING_FOR_CASH", "WAITING_FOR_DIGITAL_PAYMENT", "WAITING_FOR_ADMIN"].includes(t.status));
  count.textContent = `${pending.length} pending`;
  box.innerHTML = pending.length ? pending.map((t) => `
    <article class="pending-item"><div><span class="pending-type">${escapeHtml((t.type || "").replaceAll("-", " "))}</span><h3>${escapeHtml(t.ref || t.id)}</h3><p>${escapeHtml(t.mobile || "No mobile number")} • ${peso(t.amount)}</p><p>${escapeHtml(t.network || t.productId || "Physical payment")} • ${escapeHtml((t.status || "").replaceAll("_", " "))}</p></div><div class="pending-actions"><button class="reject" type="button" data-admin-action="reject" data-id="${escapeHtml(t.id)}">Reject</button><button class="approve" type="button" data-admin-action="approve" data-id="${escapeHtml(t.id)}">Verify & Continue</button></div></article>
  `).join("") : '<p class="empty-admin">No pending transactions.</p>';
}

function upsert(t) {
  if (!t) return;
  const key = t.id || t.ref;
  const index = state.transactions.findIndex((x) => (x.id || x.ref) === key);
  if (index < 0) state.transactions.unshift(t); else state.transactions[index] = { ...state.transactions[index], ...t };
  renderTransactions(); renderStats(); renderAdmin();
}

async function loadTransactions() {
  try {
    const response = await fetch("/api/transactions");
    const data = await response.json();
    state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
    renderTransactions(); renderStats(); renderAdmin();
  } catch (error) {
    console.error(error);
    toast("Could not load transactions from the server.");
  }
}

function connectRealtime() {
  if (!window.EventSource) return;
  state.stream?.close();
  state.stream = new EventSource("/api/transactions/stream");
  state.stream.addEventListener("transaction-created", (event) => {
    try { const t = JSON.parse(event.data); upsert(t); toast(`New ${t.type} request: ${t.ref}`); } catch (e) { console.error(e); }
  });
  state.stream.addEventListener("transaction-updated", (event) => {
    try { const t = JSON.parse(event.data); upsert(t); } catch (e) { console.error(e); }
  });
}

async function createTransaction(form) {
  const data = Object.fromEntries(new FormData(form));
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid amount.");
  if (!/^09\d{9}$/.test(String(data.mobile || ""))) return toast("Enter a valid Philippine mobile number.");

  const networks = { "globe-100": "Globe", "smart-100": "Smart", "dito-100": "DITO" };
  const payload = { type: form.dataset.type, amount, mobile: data.mobile, productId: data.productId || null, network: networks[data.productId] || null };
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Transaction request failed.");
    upsert(result.transaction);
    form.reset();
    toast(`Request ${result.transaction.ref} created and sent to admin.`);
    setView("transactions");
  } catch (error) {
    console.error(error);
    toast(error.message || "Transaction request failed.");
  } finally {
    if (button) button.disabled = false;
  }
}

function ensureAdminView() {
  if ($("#admin-view")) return;
  const main = $("main.main");
  if (!main) return;
  const section = document.createElement("section");
  section.id = "admin-view";
  section.className = "view";
  section.innerHTML = `<div class="section-intro"><p class="eyebrow">Private admin workspace</p><h2>Admin verification</h2><p>Incoming requests update here in real time.</p></div><div class="panel"><div class="panel-heading"><div><p class="eyebrow">Pending queue</p><h3 id="pending-count">0 pending</h3></div><button class="primary" id="admin-refresh" type="button">Refresh</button></div><div id="pending-list"><p class="empty-admin">No pending transactions.</p></div></div>`;
  main.appendChild(section);
  section.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-admin-action]");
    if (!button) return;
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(button.dataset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: button.dataset.adminAction }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update transaction.");
      upsert(result.transaction);
      toast(button.dataset.adminAction === "approve" ? "Transaction verified." : "Transaction rejected.");
    } catch (error) { toast(error.message || "Admin action failed."); }
  });
  $("#admin-refresh").addEventListener("click", loadTransactions);
}

function openAdmin() {
  ensureAdminView();
  if (!state.adminUnlocked) {
    if (window.prompt("Enter admin PIN:") !== ADMIN_PIN) return toast("Incorrect admin PIN.");
    state.adminUnlocked = true;
  }
  setView("admin");
  renderAdmin();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) setView(button.dataset.view);
});

$$(".transaction-form").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); createTransaction(form); }));
document.addEventListener("keydown", (event) => { if (event.ctrlKey && event.key.toLowerCase() === "a") { event.preventDefault(); openAdmin(); } });

ensureAdminView();
setView("dashboard");
loadTransactions();
connectRealtime();
