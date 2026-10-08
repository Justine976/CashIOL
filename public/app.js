const state = { lastTransaction: null, inactivity: null };
const screens = ["home", "cashin", "cashout", "load", "payment", "success", "admin", "admin-cashin", "admin-cashout"];
const transactions = [];
const ADMIN_PIN = "123456";

function showScreen(name) {
  screens.forEach((screen) => {
    const element = document.getElementById(`${screen}-screen`);
    if (element) element.classList.toggle("active", screen === name);
  });
  resetIdle();
}

function resetIdle() {
  clearTimeout(state.inactivity);
  state.inactivity = setTimeout(() => showScreen("home"), 120000);
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3200);
}

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function makeRef() {
  return `CIO-${Date.now().toString(36).toUpperCase().slice(-7)}`;
}

function renderAdmin() {
  const box = document.getElementById("pending-list");
  const pending = transactions.filter((transaction) =>
    ["WAITING_FOR_CASH", "WAITING_FOR_DIGITAL_PAYMENT", "WAITING_FOR_ADMIN"].includes(transaction.status)
  );

  document.getElementById("pending-count").textContent = `${pending.length} pending`;

  if (!pending.length) {
    box.innerHTML = '<p class="empty-admin">No pending physical-payment transactions.</p>';
    return;
  }

  box.innerHTML = pending.map((transaction) => `
    <article class="pending-item">
      <div>
        <span class="pending-type">${transaction.type.replace("-", " ")}</span>
        <h3>${transaction.ref}</h3>
        <p>${transaction.mobile || "No mobile number"} • ${peso(transaction.amount)}</p>
        <p>Status: ${transaction.status.replaceAll("_", " ")}</p>
      </div>
      <div class="pending-actions">
        <button class="reject" data-admin-action="reject" data-ref="${transaction.ref}">Reject</button>
        <button class="approve" data-admin-action="approve" data-ref="${transaction.ref}">Verify & Continue</button>
      </div>
    </article>
  `).join("");
}

function handleAdminAction(action, ref) {
  const transaction = transactions.find((item) => item.ref === ref);
  if (!transaction) return;

  if (action === "approve") {
    transaction.status = transaction.type === "cash-in"
      ? "DIGITAL_CREDIT_READY"
      : transaction.type === "cash-out"
        ? "CASH_RELEASED"
        : "APPROVED_BY_ADMIN";
    transaction.adminApprovedAt = new Date().toISOString();

    document.getElementById("success-ref").textContent = transaction.ref;
    document.getElementById("success-message").textContent =
      transaction.type === "cash-in"
        ? "Physical cash received and verified. Digital credit is approved for provider execution."
        : transaction.type === "cash-out"
          ? "Digital withdrawal verified. The admin can now release the physical cash to the customer."
          : "Physical payment verified. The load is approved for provider execution.";

    renderAdmin();
    showScreen("success");
    return;
  }

  transaction.status = "REJECTED_BY_ADMIN";
  renderAdmin();
  toast(`Transaction ${ref} was rejected.`);
}

document.addEventListener("click", (event) => {
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) showScreen(screenButton.dataset.screen);

  const adminAction = event.target.closest("[data-admin-action]");
  if (adminAction) handleAdminAction(adminAction.dataset.adminAction, adminAction.dataset.ref);
});

document.addEventListener("touchstart", resetIdle, { passive: true });

document.getElementById("admin-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const pin = document.getElementById("admin-pin");

  if (pin.value === ADMIN_PIN) {
    document.getElementById("admin-login").classList.add("hidden");
    document.getElementById("admin-content").classList.remove("hidden");
    renderAdmin();
    toast("Admin unlocked.");
  } else {
    toast("Incorrect admin PIN.");
  }

  pin.value = "";
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    showScreen("admin");
  }
});

document.querySelectorAll(".kiosk-form").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form));
    const type = form.dataset.type;
    const amount = Number(data.amount);

    if (!amount || amount <= 0) {
      toast("Enter a valid amount.");
      return;
    }

    if (type !== "cash-in" && !/^09\d{9}$/.test(data.mobile || "")) {
      toast("Enter a valid Philippine mobile number.");
      return;
    }

    const ref = makeRef();
    const status = type === "cash-out" ? "WAITING_FOR_DIGITAL_PAYMENT" : "WAITING_FOR_CASH";
    const transaction = {
      ref,
      type,
      amount,
      ...data,
      paymentMethod: "physical",
      status,
      createdAt: new Date().toISOString()
    };

    transactions.unshift(transaction);
    state.lastTransaction = transaction;
    renderAdmin();

    if (type === "cash-in") {
      document.getElementById("cashin-summary").textContent = peso(amount);
      document.getElementById("cashin-admin-ref").textContent = ref;
      showScreen("admin-cashin");
    } else if (type === "cash-out") {
      document.getElementById("cashout-admin-ref").textContent = ref;
      showScreen("admin-cashout");
    } else {
      document.getElementById("transaction-ref").textContent = ref;
      document.getElementById("payment-message").textContent =
        "Physical payment selected. The admin must verify payment before the load is sent.";
      document.querySelector(".fake-qr").style.display = "none";
      showScreen("payment");
    }
  });
});

document.getElementById("machine-id").textContent =
  localStorage.getItem("cashiol_machine_id") || "CASHIOL-001";

document.getElementById("cashin-admin-open")?.addEventListener("click", () => showScreen("admin"));
document.getElementById("cashout-admin-open")?.addEventListener("click", () => showScreen("admin"));

showScreen("home");
