/* ==========================================================================
   HungerTap × Cashfree Payment UI — Interaction Layer
   Pure front-end simulation: no real network/payment calls are made.
   ========================================================================== */

const SCREEN_ORDER = ['checkout', 'processing', 'success', 'failed'];
const SCREEN_LABELS = {
  checkout: 'Checkout — All Payment Methods',
  processing: 'Processing',
  success: 'Payment Success',
  failed: 'Payment Failed',
};

let qrInterval = null;
let currentMethod = 'upi';

function goTo(screenId) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(`screen-${screenId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.screen === screenId);
  });

  const idx = SCREEN_ORDER.indexOf(screenId);
  const label = document.getElementById('stageLabel');
  if (label && idx > -1) {
    label.textContent = `Screen ${idx + 1} of ${SCREEN_ORDER.length} — ${SCREEN_LABELS[screenId]}`;
  }

  if (screenId !== 'checkout') stopQrTimer();
}

// ---------- Sidebar wiring ----------
document.querySelectorAll('.nav-item[data-screen]').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.screen));
});

// ---------- Order summary disclosure ----------
function toggleOrderDetails() {
  const details = document.getElementById('orderDetails');
  const disclosure = document.getElementById('orderDisclosure');
  const isOpen = details.style.display !== 'none';
  details.style.display = isOpen ? 'none' : 'block';
  disclosure.classList.toggle('open', !isOpen);
}

// ---------- Payment method tabs (single-screen checkout) ----------
function switchMethod(method) {
  currentMethod = method;

  document.querySelectorAll('.method-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.method === method);
  });
  document.querySelectorAll('.pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === `pane-${method}`);
  });

  if (method !== 'upi') {
    document.getElementById('qrBox').style.display = 'none';
    const qrBtn = document.getElementById('qrToggleBtn');
    if (qrBtn) qrBtn.classList.remove('open');
    stopQrTimer();
  }

  updatePayButton();
}

function updatePayButton() {
  const btn = document.getElementById('payBtn');
  const label = btn.querySelector('.btn-label');

  if (currentMethod === 'netbanking') {
    const bank = document.getElementById('bankSelect').value;
    const chosen = bank && bank !== 'Select your bank';
    btn.disabled = !chosen;
    label.textContent = chosen ? 'Pay ₹248.00' : 'Select a bank above';
  } else if (currentMethod === 'wallet') {
    btn.disabled = true;
    label.textContent = 'Tap a wallet above';
  } else {
    btn.disabled = false;
    label.textContent = 'Pay ₹248.00';
  }
}

const bankSelectEl = document.getElementById('bankSelect');
if (bankSelectEl) bankSelectEl.addEventListener('change', updatePayButton);

// ---------- Inline QR toggle (inside the UPI pane) ----------
function toggleQr() {
  const box = document.getElementById('qrBox');
  const btn = document.getElementById('qrToggleBtn');
  const willOpen = box.style.display === 'none';
  box.style.display = willOpen ? 'flex' : 'none';
  btn.classList.toggle('open', willOpen);
  if (willOpen) startQrTimer();
  else stopQrTimer();
}

function startQrTimer() {
  stopQrTimer();
  let seconds = 4 * 60 + 32;
  const el = document.getElementById('qrTimer');
  if (!el) return;
  qrInterval = setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) { stopQrTimer(); return; }
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }, 1000);
}
function stopQrTimer() {
  if (qrInterval) clearInterval(qrInterval);
  qrInterval = null;
}

// ---------- Card form ----------
const cardNumberEl = document.getElementById('cardNumber');
const cardExpiryEl = document.getElementById('cardExpiry');
const cardCvvEl = document.getElementById('cardCvv');
const cardBrandIcon = document.getElementById('cardBrandIcon');

if (cardNumberEl) {
  cardNumberEl.addEventListener('input', (e) => {
    let digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = digits.replace(/(.{4})/g, '$1  ').trim();
    detectCardBrand(digits);
  });
}
if (cardExpiryEl) {
  cardExpiryEl.addEventListener('input', (e) => {
    let digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (digits.length > 2) digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    e.target.value = digits;
  });
}
if (cardCvvEl) {
  cardCvvEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });
}

function detectCardBrand(digits) {
  if (!cardBrandIcon) return;
  let label = '';
  let color = 'var(--ink-400)';
  if (/^4/.test(digits)) { label = 'VISA'; color = '#1a1f71'; }
  else if (/^5[1-5]/.test(digits)) { label = 'MC'; color = '#eb001b'; }
  else if (/^6/.test(digits)) { label = 'RuPay'; color = '#0f9d58'; }
  else if (/^3[47]/.test(digits)) { label = 'AMEX'; color = '#2e77bc'; }
  cardBrandIcon.innerHTML = label
    ? `<span style="font-size:10px;font-weight:800;color:${color}">${label}</span>`
    : '';
}

// ---------- Unified Pay button ----------
function handlePay() {
  if (currentMethod === 'card') return handleCardPay();
  if (currentMethod === 'upi') return handleUpiPay();
  if (currentMethod === 'netbanking') return handleNetbankingPay();
  // Wallet has no direct pay path — the button stays disabled until a wallet icon is tapped.
}

function handleUpiPay() {
  const upiId = document.getElementById('upiIdInput').value.trim();
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) {
    document.getElementById('upiIdInput').classList.add('invalid');
    return;
  }
  document.getElementById('upiIdInput').classList.remove('invalid');
  setButtonLoading('payBtn', true);
  setTimeout(() => {
    setButtonLoading('payBtn', false);
    goTo('processing');
    runProcessing('success');
  }, 900);
}

function handleCardPay() {
  const number = (cardNumberEl?.value || '').replace(/\D/g, '');
  const expiry = cardExpiryEl?.value || '';
  const cvv = cardCvvEl?.value || '';
  let valid = true;

  toggleInvalid(cardNumberEl, number.length < 12, () => { valid = false; });
  toggleInvalid(cardExpiryEl, !/^\d{2}\/\d{2}$/.test(expiry), () => { valid = false; });
  toggleInvalid(cardCvvEl, cvv.length < 3, () => { valid = false; });

  if (!valid) return;

  setButtonLoading('payBtn', true);
  setTimeout(() => {
    setButtonLoading('payBtn', false);
    goTo('processing');
    // Last-digit heuristic purely for demo purposes: odd final digit -> declined.
    const outcome = Number(number.slice(-1)) % 2 === 0 ? 'success' : 'failed';
    runProcessing(outcome);
  }, 900);
}

function handleNetbankingPay() {
  const bank = document.getElementById('bankSelect').value;
  if (!bank || bank === 'Select your bank') return;
  setButtonLoading('payBtn', true);
  setTimeout(() => {
    setButtonLoading('payBtn', false);
    goTo('processing');
    runProcessing('success');
  }, 900);
}

function toggleInvalid(el, isInvalid, onInvalid) {
  if (!el) return;
  el.classList.toggle('invalid', isInvalid);
  if (isInvalid) onInvalid();
}

// ---------- Processing → outcome ----------
function runProcessing(outcome) {
  const title = document.getElementById('processingTitle');
  if (title) title.textContent = 'Processing your payment…';
  setTimeout(() => {
    goTo(outcome === 'success' ? 'success' : 'failed');
  }, 1800);
}

// ---------- Generic button loading helper ----------
function setButtonLoading(btnId, isLoading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
}
