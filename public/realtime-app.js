const state = { lastTransaction: null, inactivity: null };
const screens = ["home", "cashin", "cashout", "load", "payment", "success", "admin", "admin-cashin", "admin-cashout"];
const transactions = new Map();
const API_BASE = window.CASHIOL_API_URL || "";
const ADMIN_PIN = "123456";

const apiUrl = (path) => `${API_BASE}${path}`;

function showScreen(name, options = {}) {
  screens.forEach((screen) => {
    const element = document.getElementById(`${screen}-screen`);
    if (element) element.classList.toggle("active", screen === name);
  });
  if (!options.skipSave) localStorage.setItem("cashiol_current_screen", name);
  resetIdle();
  if (name === "admin") { renderAdmin(); loadTransactions(); }
}

function getSavedScreen() {
  const saved = localStorage.getItem("cashiol_current_screen");
  return saved && screens.includes(saved) ? saved : "home";
}

function resetIdle() {
  clearTimeout(state.inactivity);
  state.inactivity = setTimeout(() => showScreen("home"), 120000);
}

function toast(message) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3200);
}

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderAdmin() {
  const box = document.getElementById("pending-list");
  const count = document.getElementById("pending-count");
  if (!box || !count) return;
  const pending = [...transactions.values()].filter((t) => ["WAITING_FOR_CASH", "WAITING_FOR_DIGITAL_PAYMENT", "WAITING_FOR_ADMIN"].includes(t.status));
  count.textContent = `${pending.length} pending`;
  if (!pending.length) {
    box.innerHTML = '<p class="empty-admin">No pending physical-payment transactions.</p>';
    return;
  }
  box.innerHTML = pending.map((t) => `
    <article class="pending-item">
      <div><span class="pending-type">${String(t.type || "").replace("-", " ")}</span><h3>${t.ref || t.id}</h3><p>${t.mobile || "No customer-entered number"} • ${peso(t.amount)}</p><p>Status: ${String(t.status || "").replaceAll("_", " ")}</p></div>
      <div class="pending-actions"><button type="button" class="reject" data-admin-action="reject" data-ref="${t.id}">Reject</button><button type="button" class="approve" data-admin-action="approve" data-ref="${t.id}">Verify & Continue</button></div>
    </article>`).join("");
}

async function loadTransactions() {
  try {
    const response = await fetch(apiUrl("/api/transactions"));
    if (!response.ok) throw new Error("Realtime server unavailable.");
    const data = await response.json();
    transactions.clear();
    for (const t of data.transactions || []) transactions.set(t.id, t);
    renderAdmin();
  } catch (error) { console.error(error); }
}

function connectRealtime() {
  if (!window.EventSource) return;
  const stream = new EventSource(apiUrl("/api/transactions/stream"));
  stream.addEventListener("transaction-created", (event) => {
    const t = JSON.parse(event.data);
    transactions.set(t.id, t);
    renderAdmin();
    if (document.getElementById("admin-screen")?.classList.contains("active")) toast(`New ${t.type} transaction received.`);
  });
  stream.addEventListener("transaction-updated", (event) => {
    const t = JSON.parse(event.data);
    transactions.set(t.id, t);
    renderAdmin();
  });
  stream.onerror = () => console.warn("CashIOL realtime stream disconnected; browser will retry.");
}

async function handleAdminAction(action, id) {
  try {
    const response = await fetch(apiUrl(`/api/transactions/${encodeURIComponent(id)}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to update transaction.");
    transactions.set(data.transaction.id, data.transaction);
    renderAdmin();
    if (action === "approve") {
      document.getElementById("success-ref").textContent = data.transaction.ref;
      document.getElementById("success-message").textContent = data.transaction.type === "cash-out" ? "Digital transaction verified. The admin can now release the physical cash." : data.transaction.type === "cash-in" ? "Physical cash verified. The transaction is approved for digital credit/provider execution." : "Physical payment verified. The load is approved for provider execution.";
      showScreen("success");
    } else toast(`Transaction ${data.transaction.ref} was rejected.`);
  } catch (error) { console.error(error); toast(error.message || "Unable to update transaction."); }
}

async function submitKioskForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const type = form.dataset.type;
  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid amount.");
  if (!/^09\d{9}$/.test(String(data.mobile || ""))) return toast("Enter a valid Philippine mobile number.");

  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = "Processing…"; }

  try {
    const response = await fetch(apiUrl("/api/transactions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount, mobile: data.mobile || null, productId: data.productId || null, network: data.network || null })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to create transaction.");

    const t = result.transaction;
    transactions.set(t.id, t);
    state.lastTransaction = t;
    form.reset();

    if (type === "cash-in") {
      document.getElementById("cashin-summary").textContent = peso(amount);
      document.getElementById("cashin-admin-ref").textContent = t.ref;
      showScreen("admin-cashin");
    } else if (type === "load") {
      document.getElementById("transaction-ref").textContent = t.ref;
      document.getElementById("payment-message").textContent = "Physical payment selected. The admin must verify payment before the load is sent.";
      document.querySelector("#payment-screen .fake-qr")?.style.setProperty("display", "none");
      showScreen("payment");
    }
  } catch (error) {
    console.error(error);
    toast(error.message || "Unable to create transaction.");
  } finally {
    if (button) { button.disabled = false; button.textContent = type === "cash-in" ? "Continue to admin verification →" : "Continue →"; }
  }
}

document.addEventListener("click", (event) => {
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) showScreen(screenButton.dataset.screen);
  const adminAction = event.target.closest("[data-admin-action]");
  if (adminAction) handleAdminAction(adminAction.dataset.adminAction, adminAction.dataset.ref);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest(".kiosk-form");
  if (!form) return;
  event.preventDefault();
  submitKioskForm(form);
});

document.addEventListener("touchstart", resetIdle, { passive: true });

document.getElementById("admin-login-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const pin = document.getElementById("admin-pin");
  if (pin.value === ADMIN_PIN) {
    document.getElementById("admin-login").classList.add("hidden");
    document.getElementById("admin-content").classList.remove("hidden");
    loadTransactions();
    toast("Admin unlocked.");
  } else toast("Incorrect admin PIN.");
  pin.value = "";
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "a") { event.preventDefault(); showScreen("admin"); }
});

document.getElementById("machine-id").textContent = localStorage.getItem("cashiol_machine_id") || "CASHIOL-001";
loadTransactions();
connectRealtime();
showScreen(getSavedScreen(), { skipSave: true });
