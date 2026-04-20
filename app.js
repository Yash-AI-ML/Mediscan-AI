// ============================================================
// MediScan AI v2.0 — Refactored with security & medical logic
// ============================================================

// ==================== UTILITIES ====================

/** Escape HTML to prevent XSS injection */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Custom error class for consistent error handling */
class AppError extends Error {
  constructor(message, code = 'UNKNOWN', userFacing = true) {
    super(message);
    this.code = code;
    this.userFacing = userFacing;
  }
}

/** Show a toast notification instead of alert() */
function showToast(message, type = 'error') {
  const existing = document.querySelectorAll('.app-toast');
  if (existing.length > 3) existing[0].remove();
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  toast.innerHTML = `<i class="ph ph-${type === 'error' ? 'warning-circle' : type === 'success' ? 'check-circle' : 'info'}"></i> ${escapeHTML(message)}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4500);
}

/** Rate limiter for API calls */
const RateLimiter = {
  _lastCall: 0,
  canCall() {
    const limit = (window.MEDISCAN_CONFIG || {}).API_RATE_LIMIT_MS || 5000;
    return Date.now() - this._lastCall >= limit;
  },
  remaining() {
    const limit = (window.MEDISCAN_CONFIG || {}).API_RATE_LIMIT_MS || 5000;
    return Math.max(0, limit - (Date.now() - this._lastCall));
  },
  record() { this._lastCall = Date.now(); }
};

// ==================== MEDICAL PARAMETER DATABASE ====================
const MEDICAL_RANGES = {
  'hemoglobin': { min: 12.0, max: 17.5, unit: 'g/dL' },
  'glucose': { min: 70, max: 100, unit: 'mg/dL' },
  'glucose fasting': { min: 70, max: 100, unit: 'mg/dL' },
  'glucose pp': { min: 70, max: 140, unit: 'mg/dL' },
  'creatinine': { min: 0.6, max: 1.2, unit: 'mg/dL' },
  'total cholesterol': { min: 0, max: 200, unit: 'mg/dL' },
  'ldl cholesterol': { min: 0, max: 100, unit: 'mg/dL' },
  'hdl cholesterol': { min: 40, max: 60, unit: 'mg/dL' },
  'triglycerides': { min: 0, max: 150, unit: 'mg/dL' },
  'tsh': { min: 0.4, max: 4.0, unit: 'mIU/L' },
  'wbc': { min: 4000, max: 11000, unit: '/µL' },
  'rbc': { min: 4.5, max: 5.5, unit: 'million/µL' },
  'platelet': { min: 150000, max: 400000, unit: '/µL' },
  'hba1c': { min: 4.0, max: 5.7, unit: '%' },
  'uric acid': { min: 3.5, max: 7.2, unit: 'mg/dL' },
  'vitamin d': { min: 30, max: 100, unit: 'ng/mL' },
  'vitamin b12': { min: 200, max: 900, unit: 'pg/mL' },
  'iron': { min: 60, max: 170, unit: 'µg/dL' },
  'calcium': { min: 8.5, max: 10.5, unit: 'mg/dL' },
  'albumin': { min: 3.5, max: 5.5, unit: 'g/dL' },
  'bilirubin': { min: 0.1, max: 1.2, unit: 'mg/dL' },
  'sgpt': { min: 7, max: 56, unit: 'U/L' },
  'sgot': { min: 10, max: 40, unit: 'U/L' },
  'alkaline phosphatase': { min: 44, max: 147, unit: 'U/L' },
  'urea': { min: 7, max: 20, unit: 'mg/dL' },
  'sodium': { min: 136, max: 145, unit: 'mEq/L' },
  'potassium': { min: 3.5, max: 5.0, unit: 'mEq/L' },
  'esr': { min: 0, max: 20, unit: 'mm/hr' },
  'ferritin': { min: 12, max: 300, unit: 'ng/mL' },
  'transferrin': { min: 200, max: 360, unit: 'mg/dL' }
};

/** Validate AI output against known medical ranges */
function validateAIOutput(data) {
  if (!data || !data.triageResults) return data;
  data.triageResults.forEach(param => {
    const key = (param.parameter || '').toLowerCase().trim();
    const ref = MEDICAL_RANGES[key];
    if (ref && param.value) {
      const numVal = parseFloat(String(param.value).replace(/[^\d.]/g, ''));
      if (!isNaN(numVal)) {
        const computed = numVal < ref.min ? 'Low' : numVal > ref.max ? 'High' : 'Normal';
        const aiStatus = (param.status || '').toLowerCase();
        if (aiStatus === 'normal' && computed !== 'Normal') {
          param.validationNote = `⚠ AI marked Normal, but ${numVal} ${ref.unit} is ${computed} (range: ${ref.min}–${ref.max})`;
          param.status = computed === 'Low' ? 'Attention' : 'Critical';
        }
      }
    }
  });
  // Ensure risk score is within bounds
  if (typeof data.riskScore === 'number') {
    data.riskScore = Math.max(0, Math.min(100, Math.round(data.riskScore)));
  }
  return data;
}

// ==================== CONSTANTS ====================
const CONFIG = window.MEDISCAN_CONFIG || {};
const MODELS_TO_TRY = CONFIG.MODELS_TO_TRY || ['gemini-2.5-flash'];
const MAX_HISTORY = CONFIG.MAX_HISTORY_ITEMS || 50;
const MAX_CHAT_MSGS = CONFIG.MAX_CHAT_MESSAGES || 50;

// ==================== RESPONSE CACHE ====================
/** Cache API responses by file signature to avoid redundant Gemini calls */
const ResponseCache = {
  _cache: new Map(),
  _maxSize: 10,

  /** Generate a cache key from file metadata + symptoms */
  key(file, symptoms) {
    return `${file.name}_${file.size}_${file.lastModified}_${(symptoms || '').trim()}`;
  },

  get(file, symptoms) {
    return this._cache.get(this.key(file, symptoms)) || null;
  },

  set(file, symptoms, data) {
    if (this._cache.size >= this._maxSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(this.key(file, symptoms), { data, timestamp: Date.now() });
  }
};

/** Save/restore the last analysis to sessionStorage so page refresh doesn't lose data */
const SessionPersistence = {
  save(data) {
    try { sessionStorage.setItem('mediscan_current', JSON.stringify(data)); }
    catch (e) { /* sessionStorage full or unavailable — ignore */ }
  },
  restore() {
    try {
      const raw = sessionStorage.getItem('mediscan_current');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  clear() { sessionStorage.removeItem('mediscan_current'); }
};

// ==================== AUTH SYSTEM ====================
// Note: We use the Firebase Compat SDK for maximum reliability in static HTML environments.
let auth;
let generatedOTP = null;
let pendingUser = null;
let otpTimerInterval = null;

// Initialize Firebase with config from config.js
try {
  const firebaseConfig = (window.MEDISCAN_CONFIG && window.MEDISCAN_CONFIG.FIREBASE_CONFIG) || {};
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "REPLACE_WITH_YOUR_FIREBASE_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
  } else {
    console.warn("Firebase configuration missing or default. Authentication will not work.");
    // Mock auth object to prevent immediate errors
    auth = { onAuthStateChanged: () => { }, currentUser: null };
  }
} catch (error) {
  console.error("Firebase initialization failed:", error);
  auth = { onAuthStateChanged: () => { }, currentUser: null };
}

// ==================== AUTH SYSTEM ====================

function getSession() {
  return auth.currentUser;
}

// --- UI helpers ---
window.openAuthModal = function (tab = 'login') {
  const modal = document.getElementById('authModal');
  modal.style.display = 'flex';
  switchAuthTab(tab);
};

window.closeAuthModal = function () {
  document.getElementById('authModal').style.display = 'none';
};

window.switchAuthTab = function (tab) {
  document.getElementById('authFormLogin').classList.toggle('hidden', tab !== 'login');
  document.getElementById('authFormSignup').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('authFormOTP').classList.toggle('hidden', tab !== 'otp');

  document.getElementById('authTabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('authTabSignup').classList.toggle('active', tab === 'signup' || tab === 'otp');

  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('signupError').classList.add('hidden');
  document.getElementById('otpError').classList.add('hidden');
};

window.togglePwd = function (inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.querySelector('i').className = isHidden ? 'ph ph-eye-slash' : 'ph ph-eye';
};

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function updateAuthUI() {
  const user = auth.currentUser;
  const loggedIn = !!user;

  // Landing nav
  const navLogin = document.getElementById('btnNavLogin');
  const navSignup = document.getElementById('btnNavSignup');
  const navPill = document.getElementById('navUserPill');
  const navName = document.getElementById('navUserName');

  if (navLogin) navLogin.classList.toggle('hidden', loggedIn);
  if (navSignup) navSignup.classList.toggle('hidden', loggedIn);
  if (navPill) navPill.classList.toggle('hidden', !loggedIn);
  if (navName && user) navName.textContent = user.displayName || user.email;

  // App header
  const appPill = document.getElementById('appUserPill');
  const appUserName = document.getElementById('appUserName');
  const appLoginBtn = document.getElementById('btnAppLogin');

  if (appPill) appPill.classList.toggle('hidden', !loggedIn);
  if (appUserName && user) appUserName.textContent = user.displayName || user.email;
  if (appLoginBtn) appLoginBtn.classList.toggle('hidden', loggedIn);
}

// Listen for Auth Changes
auth.onAuthStateChanged((user) => {
  updateAuthUI();
  loadHistory(); // Reload history for the new user
});

// --- Sign Up ---
window.authSignup = async function () {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (!name) return showAuthError('signupError', '⚠ Please enter your full name.');
  if (!email || !email.includes('@')) return showAuthError('signupError', '⚠ Please enter a valid email.');
  if (password.length < 8) return showAuthError('signupError', '⚠ Password must be at least 8 characters.');
  if (password !== confirm) return showAuthError('signupError', '⚠ Passwords do not match.');

  const signupBtn = document.querySelector('#authFormSignup .btn-primary');
  const originalText = signupBtn.innerHTML;

  try {
    signupBtn.disabled = true;
    signupBtn.innerHTML = `<i class="ph ph-circle-notch animate-spin"></i> Sending OTP...`;

    // Generate real random OTP
    generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
    pendingUser = { name, email, password };

    // Send via EmailJS
    const emailConfig = (window.MEDISCAN_CONFIG && window.MEDISCAN_CONFIG.EMAILJS_CONFIG) || {};

    if (emailConfig.SERVICE_ID && emailConfig.SERVICE_ID !== "REPLACE_WITH_SERVICE_ID") {
      // Ensure EmailJS is initialized
      emailjs.init(emailConfig.PUBLIC_KEY);

      const now = new Date();
      const expiryTime = new Date(now.getTime() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const result = await emailjs.send(
        emailConfig.SERVICE_ID,
        emailConfig.TEMPLATE_ID,
        {
          to_name: name,
          email: email,
          passcode: generatedOTP,
          time: expiryTime,
          app_name: "MediScan AI"
        }
      );
      console.log("OTP sent successfully!", result.status, result.text);
    } else {
      console.warn("EmailJS not configured. OTP will be logged to console for development.");
      console.log("%c[DEV] Your OTP is: " + generatedOTP, "color: #00ff00; font-weight: bold; font-size: 1.2rem;");
    }

    switchAuthTab('otp');
    document.getElementById('otpSubtext').innerHTML = `We've sent a 6-digit code to <strong>${email}</strong>.<br>Please check your inbox (and spam folder).`;
    startOTPTimer();

  } catch (error) {
    console.error("Failed to send OTP:", error);
    showAuthError('signupError', '⚠ Failed to send verification code. Please try again later.');
  } finally {
    signupBtn.disabled = false;
    signupBtn.innerHTML = originalText;
  }
};

function startOTPTimer() {
  let sec = 30;
  const timerEl = document.getElementById('timerSec');
  const timerWrap = document.getElementById('otpTimer');
  const resendBtn = document.getElementById('btnResendOTP');

  resendBtn.classList.add('hidden');
  timerWrap.classList.remove('hidden');
  timerEl.textContent = sec;

  if (otpTimerInterval) clearInterval(otpTimerInterval);

  otpTimerInterval = setInterval(() => {
    sec--;
    timerEl.textContent = sec;
    if (sec <= 0) {
      clearInterval(otpTimerInterval);
      timerWrap.classList.add('hidden');
      resendBtn.classList.remove('hidden');
    }
  }, 1000);
}

window.verifyOTP = async function () {
  const input = document.getElementById('otpInput').value.trim();
  if (input !== generatedOTP) {
    return showAuthError('otpError', '⚠ Invalid OTP. Please try again.');
  }

  const { name, email, password } = pendingUser;

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await userCredential.user.updateProfile({ displayName: name });

    // Clear OTP state
    generatedOTP = null;
    pendingUser = null;
    if (otpTimerInterval) clearInterval(otpTimerInterval);

    closeAuthModal();
  } catch (error) {
    showAuthError('otpError', '⚠ ' + error.message);
  }
};

// --- Login ---
window.authLogin = async function () {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) return showAuthError('loginError', '⚠ Please fill in all fields.');

  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeAuthModal();
  } catch (error) {
    showAuthError('loginError', '⚠ ' + error.message);
  }
};

// --- Logout ---
window.authLogout = async function () {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Sign out error", error);
  }
};

// Close modal on backdrop click
document.getElementById('authModal').addEventListener('click', function (e) {
  if (e.target === this) closeAuthModal();
});

// ==================== STATE ====================
// State
let currentProfile = 'Self';
let currentLanguage = 'en';
const langMap = {
  'en': 'en-US', 'hi': 'hi-IN', 'es': 'es-ES', 'fr': 'fr-FR',
  'de': 'de-DE', 'pt': 'pt-BR', 'it': 'it-IT', 'ru': 'ru-RU',
  'ar': 'ar-SA', 'zh': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR',
  'bn': 'bn-BD', 'te': 'te-IN', 'mr': 'mr-IN', 'ta': 'ta-IN',
  'ur': 'ur-PK', 'tr': 'tr-TR', 'nl': 'nl-NL', 'pl': 'pl-PL',
  'vi': 'vi-VN', 'th': 'th-TH'
};
let lastReportData = null; // Store latest structured data for chat context
let chartInstance = null;

// Models are now defined in CONSTANTS section above

// DOM Elements - Navigation
const landingPage = document.getElementById('landingPage');
const appView = document.getElementById('appView');

// DOM Elements - Setup
const themeToggles = document.querySelectorAll('.theme-toggle-btn');
const profileSelect = document.getElementById('profileSelect');
const languageSelect = document.getElementById('languageSelect');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// DOM Elements - Input
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('reportFile');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const analyzeBtn = document.getElementById('analyzeBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const symptomsInput = document.getElementById('symptomsInput');
const btnVoiceInput = document.getElementById('btnVoiceInput');
const voiceStatus = document.getElementById('voiceStatus');

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');

// Dashboard Elements
const dashboardEmpty = document.getElementById('dashboardEmpty');
const dashboardContent = document.getElementById('dashboardContent');
const dashboardActions = document.getElementById('dashboardActions');
const dashRiskScore = document.getElementById('dashRiskScore');
const riskRingProgress = document.getElementById('riskRingProgress');
const dashUrgency = document.getElementById('dashUrgency');
const dashTriageAlerts = document.getElementById('dashTriageAlerts');
const dashHealthCoach = document.getElementById('dashHealthCoach');
const dashFollowUp = document.getElementById('dashFollowUp');
const dashSymptomCorrelation = document.getElementById('dashSymptomCorrelation');
const btnSpeakSummary = document.getElementById('btnSpeakSummary');
const historyList = document.getElementById('historyList');

// Feedback Elements
const feedbackSection = document.getElementById('feedbackSection');
const btnFeedbackUp = document.getElementById('btnFeedbackUp');
const btnFeedbackDown = document.getElementById('btnFeedbackDown');
const feedbackThanks = document.getElementById('feedbackThanks');

// Chat Elements
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatWidget = document.getElementById('chatWidget');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatBody = document.getElementById('chatBody');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

// View Routing
window.startApp = function () {
  landingPage.classList.remove('active-view');
  landingPage.classList.add('hidden-view');

  appView.classList.remove('hidden-view');
  appView.classList.add('active-view');

  // If user has history, click dashboard, otherwise New Scan
  if (getHistory().length > 0) {
    document.querySelector('[data-tab="dashboard"]').click();
  } else {
    document.querySelector('[data-tab="new-scan"]').click();
  }
};

window.showLanding = function () {
  appView.classList.remove('active-view');
  appView.classList.add('hidden-view');

  landingPage.classList.remove('hidden-view');
  landingPage.classList.add('active-view');
};

// Initialization
function init() {
  // API key loaded ONLY from localStorage — never from source code
  const savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }

  // Show consent modal on first visit
  if (!localStorage.getItem('mediscan_consent_accepted')) {
    const modal = document.getElementById('consentModal');
    if (modal) modal.style.display = 'flex';
  }

  // Load Theme
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.replace('light-mode', 'dark-mode');
    themeToggles.forEach(b => {
      const icon = b.querySelector('i');
      if (icon) icon.className = 'ph ph-sun';
    });
  }

  loadHistory();

  // Restore last analysis from session (survives page refresh)
  const sessionData = SessionPersistence.restore();
  if (sessionData) {
    lastReportData = sessionData;
    renderDashboard(sessionData);
  }

  // Auth state is handled by onAuthStateChanged
}

// Theme Toggle
themeToggles.forEach(btn => {
  btn.addEventListener('click', () => {
    if (document.body.classList.contains('light-mode')) {
      document.body.classList.replace('light-mode', 'dark-mode');
      localStorage.setItem('theme', 'dark');
      themeToggles.forEach(b => b.querySelector('i').className = 'ph ph-sun');
    } else {
      document.body.classList.replace('dark-mode', 'light-mode');
      localStorage.setItem('theme', 'light');
      themeToggles.forEach(b => b.querySelector('i').className = 'ph ph-moon');
    }
  });
});

// Profile & Language Change
profileSelect.addEventListener('change', (e) => {
  currentProfile = e.target.value;
  loadHistory();
});

languageSelect.addEventListener('change', (e) => {
  currentLanguage = e.target.value;
});

// API Key Auto-Save
apiKeyInput.addEventListener('change', () => {
  localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
});

// Tabs Logic
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Drag & Drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
  dropZone.addEventListener(e, preventDefaults, false);
});
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
['dragenter', 'dragover'].forEach(e => { dropZone.addEventListener(e, () => dropZone.classList.add('dragover'), false); });
['dragleave', 'drop'].forEach(e => { dropZone.addEventListener(e, () => dropZone.classList.remove('dragover'), false); });

dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', function () { handleFiles(this.files); });

function handleFiles(files) {
  if (files.length > 0) {
    const file = files[0];
    fileNameDisplay.textContent = `Selected: ${file.name}`;
    analyzeBtn.disabled = false;
  }
}

// Voice Input (SpeechRecognition)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  document.getElementById('httpsWarning').style.display = 'block';
  btnVoiceInput.style.display = 'none';
} else if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;

  btnVoiceInput.addEventListener('click', () => {
    recognition.lang = langMap[currentLanguage] || currentLanguage;
    recognition.start();
    voiceStatus.style.display = 'block';
  });

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    symptomsInput.value += (symptomsInput.value ? ' ' : '') + transcript;
    voiceStatus.style.display = 'none';
  };

  recognition.onerror = () => {
    voiceStatus.style.display = 'none';
    alert("Voice recognition error.");
  };
} else {
  btnVoiceInput.style.display = 'none';
}

// Voice Output (SpeechSynthesis)
window.readTextAloud = function (text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langMap[currentLanguage] || currentLanguage;
  window.speechSynthesis.speak(utterance);
};

btnSpeakSummary.addEventListener('click', () => {
  if (!lastReportData || !lastReportData.healthCoach) return;
  const text = `${lastReportData.healthCoach}. Next step: ${lastReportData.followUp}`;
  readTextAloud(text);
});

// Helper for Gemini API with Fallback & Retries
async function callGeminiAPI(apiKey, payload, useJsonMode = false) {
  let lastError = null;

  for (const model of MODELS_TO_TRY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            generationConfig: useJsonMode ? { ...payload.generationConfig, responseMimeType: "application/json" } : payload.generationConfig
          })
        });

        if (response.ok) {
          return await response.json();
        }

        const errData = await response.json().catch(() => ({}));
        const msg = errData.error?.message || "API request failed";

        if (response.status === 503 || response.status === 429 || msg.toLowerCase().includes('high demand')) {
          console.warn(`Model ${model} reported high demand. Attempt ${attempt + 1}/2. Waiting...`);
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg);
      } catch (err) {
        lastError = err;
        if (err.message.toLowerCase().includes('high demand')) continue;
        throw err;
      }
    }
    console.warn(`Model ${model} failed or is too busy. Trying next model...`);
  }
  throw lastError || new Error("All models are currently experiencing high demand. Please try again in a few minutes.");
}

// Convert File to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

// Analyze API Call
analyzeBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  const apiKey = apiKeyInput.value.trim();
  const symptoms = symptomsInput.value.trim();

  if (!apiKey) return showToast('Please enter your Gemini API Key in the field above.', 'error');
  if (!file) return showToast('Please upload a medical report file.', 'error');

  loader.style.display = 'flex';
  loaderText.innerText = "Analyzing Health Data...";

  // Rate limiting check
  if (!RateLimiter.canCall()) {
    const wait = Math.ceil(RateLimiter.remaining() / 1000);
    showToast(`Please wait ${wait}s before analyzing again.`, 'info');
    loader.style.display = 'none';
    return;
  }

  // Check response cache — avoid redundant API calls
  const cached = ResponseCache.get(file, symptoms);
  if (cached) {
    lastReportData = cached.data;
    renderDashboard(cached.data);
    document.querySelector('[data-tab="dashboard"]').click();
    showToast('Loaded from cache (same file + symptoms).', 'info');
    loader.style.display = 'none';
    return;
  }

  try {
    const base64Image = await fileToBase64(file);
    let mimeType = file.type || "image/jpeg";
    if (file.name.toLowerCase().endsWith('.pdf')) mimeType = "application/pdf";

    // Build medical ranges context for the AI
    const rangesContext = Object.entries(MEDICAL_RANGES)
      .map(([name, r]) => `${name}: ${r.min}–${r.max} ${r.unit}`)
      .join('; ');

    const prompt = `
You are a clinical data extraction assistant. The user uploaded a medical lab report.

CRITICAL RULES:
- Extract ONLY values that are ACTUALLY PRESENT in the report image/PDF.
- Do NOT invent, guess, or hallucinate any values.
- If a value is unclear or unreadable, mark its status as "Monitor" and explain.
- Compare each extracted value against these standard medical reference ranges: ${rangesContext}
- The riskScore should reflect how many values are out of range and by how much (0=healthy, 100=critical).
- Explain in extremely simple, crisp, jargon-free language a 5th grader can understand.

User reported symptoms: "${symptoms || 'None reported'}".
Selected Language: ${currentLanguage}. All output text (except JSON keys) MUST be in this language.

Return ONLY a valid JSON object with this exact structure:
{
  "riskScore": (number 0-100),
  "urgency": "Short urgency string",
  "triageResults": [
    {"parameter": "Hemoglobin", "value": "11.2", "baseline": "13.5-17.5", "status": "Critical|Attention|Monitor|Normal", "explanation": "Simple explanation"}
  ],
  "symptomCorrelation": "How symptoms connect to the lab results",
  "healthCoach": "Short encouraging lifestyle advice",
  "followUp": "Next step recommendation",
  "confidence": "HIGH|MEDIUM|LOW",
  "limitations": "Anything the AI could not determine from the report"
}
Do not use markdown blocks. Return only JSON.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }]
    };

    RateLimiter.record();
    const jsonResponse = await callGeminiAPI(apiKey, payload, true);
    let responseText = jsonResponse.candidates[0].content.parts[0].text;
    responseText = responseText.replace(/^\s*`{3}(json)?/i, '').replace(/`{3}\s*$/, '').trim();

    let data = JSON.parse(responseText);
    // Validate AI output against our medical ranges database
    data = validateAIOutput(data);
    lastReportData = data;

    // Cache the response
    ResponseCache.set(file, symptoms, data);
    SessionPersistence.save(data);

    // Save to History
    saveToHistory(data);

    // Reset feedback UI
    resetFeedback();

    // Switch to Dashboard Tab
    renderDashboard(data);
    document.querySelector('[data-tab="dashboard"]').click();
    showToast('Analysis complete!', 'success');

  } catch (err) {
    console.error(err);
    // Graceful error recovery: show last cached result if available
    const fallback = SessionPersistence.restore();
    if (fallback && !lastReportData) {
      lastReportData = fallback;
      renderDashboard(fallback);
      document.querySelector('[data-tab="dashboard"]').click();
      showToast('Analysis failed — showing your last result. Error: ' + err.message, 'error');
    } else {
      showToast('Analysis failed: ' + err.message, 'error');
    }
  } finally {
    loader.style.display = 'none';
  }
});

// Render Dashboard
function renderDashboard(data) {
  dashboardEmpty.style.display = 'none';
  dashboardActions.style.display = 'flex';
  dashboardContent.style.display = 'block';

  // Basic Info
  const score = data.riskScore || 0;
  dashRiskScore.innerText = score;

  let riskColorStr = 'var(--success)';
  if (score > 70) riskColorStr = 'var(--danger)';
  else if (score > 40) riskColorStr = 'var(--warning)';

  dashRiskScore.style.color = riskColorStr;

  // Update SVG Ring
  const ringCircumference = 251.2;
  const offset = ringCircumference - (score / 100) * ringCircumference;
  riskRingProgress.style.strokeDashoffset = offset;
  riskRingProgress.style.stroke = riskColorStr;

  dashUrgency.innerText = data.urgency || '';
  dashUrgency.style.color = riskColorStr;

  dashHealthCoach.innerText = data.healthCoach || '';
  dashFollowUp.innerText = data.followUp || '';
  dashSymptomCorrelation.innerText = data.symptomCorrelation || 'No correlation provided.';

  // Triage Alerts
  dashTriageAlerts.innerHTML = '';
  if (data.triageResults && data.triageResults.length > 0) {
    data.triageResults.forEach(item => {
      const cls = (item.status || 'normal').toLowerCase();
      const validNote = item.validationNote ? `<div class="validation-note">${escapeHTML(item.validationNote)}</div>` : '';
      dashTriageAlerts.innerHTML += `
        <div class="triage-alert ${cls}">
          <strong>${escapeHTML(item.parameter)}: ${escapeHTML(String(item.value))}</strong>
          <span>${escapeHTML(item.explanation || '')}</span>
          ${validNote}
        </div>
      `;
    });
  } else {
    dashTriageAlerts.innerHTML = '<p style="color: var(--text-muted);">No specific alerts found.</p>';
  }

  // Confidence & Limitations (Phase 3 additions)
  let extraInfo = '';
  if (data.confidence) {
    const confClass = data.confidence === 'HIGH' ? 'conf-high' : data.confidence === 'LOW' ? 'conf-low' : 'conf-med';
    extraInfo += `<div class="confidence-badge ${confClass}"><i class="ph ph-shield-check"></i> AI Confidence: ${escapeHTML(data.confidence)}</div>`;
  }
  if (data.limitations) {
    extraInfo += `<div class="limitations-note"><i class="ph ph-info"></i> <strong>Limitations:</strong> ${escapeHTML(data.limitations)}</div>`;
  }
  const extraEl = document.getElementById('dashExtraInfo');
  if (extraEl) extraEl.innerHTML = extraInfo;

  renderChart(data);
}

// Chart.js implementation for Current Report
function renderChart(data) {
  if (!data || !data.triageResults || data.triageResults.length === 0) return;

  const labels = data.triageResults.map(item => item.parameter);
  const dataPoints = data.triageResults.map(item => {
    const match = item.value.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  });

  const baselinePoints = data.triageResults.map((item, index) => {
    if (item.baseline) {
      const match = item.baseline.match(/[\d.]+/);
      return match ? parseFloat(match[0]) : dataPoints[index];
    }
    return dataPoints[index];
  });

  const backgroundColors = data.triageResults.map(item => {
    const status = (item.status || '').toLowerCase();
    return status === 'normal' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)';
  });

  const borderColors = data.triageResults.map(item => {
    const status = (item.status || '').toLowerCase();
    return status === 'normal' ? '#10B981' : '#EF4444';
  });

  const ctx = document.getElementById('trendChart').getContext('2d');

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          type: 'line',
          label: 'Normal Baseline',
          data: baselinePoints,
          borderColor: '#10B981',
          borderDash: [5, 5],
          borderWidth: 2,
          stepped: 'middle',
          fill: false,
          pointRadius: 0,
          order: 1
        },
        {
          type: 'bar',
          label: 'Levels',
          data: dataPoints,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
        x: {
          ticks: {
            font: { weight: 'bold', family: 'Inter' }
          }
        }
      },
      plugins: {
        legend: { labels: { font: { family: 'Inter' } } }
      }
    }
  });
}

// History Storage Management
function saveToHistory(data) {
  const user = auth.currentUser;
  // Scope key: if logged in, use email so reports are account-bound; else use guest key
  const scopeKey = user ? `user_${user.email}` : `guest_${currentProfile}`;

  let histories = JSON.parse(localStorage.getItem('mediscan_history')) || {};
  if (!histories[scopeKey]) histories[scopeKey] = [];

  histories[scopeKey].push({
    date: new Date().toISOString(),
    profile: currentProfile,
    data: data
  });

  // Cap history to prevent localStorage bloat
  if (histories[scopeKey].length > MAX_HISTORY) {
    histories[scopeKey] = histories[scopeKey].slice(-MAX_HISTORY);
  }

  localStorage.setItem('mediscan_history', JSON.stringify(histories));

  // Nudge guests to sign up so they don't lose data
  if (!user) {
    showSaveBanner();
  }

  loadHistory();
}

function getScopeKey() {
  const user = auth.currentUser;
  return user ? `user_${user.email}` : `guest_${currentProfile}`;
}

// Show a non-intrusive toast nudging guests to create an account
function showSaveBanner() {
  if (document.getElementById('saveBanner')) return; // already shown

  const banner = document.createElement('div');
  banner.id = 'saveBanner';
  banner.className = 'save-banner';
  banner.innerHTML = `
    <i class="ph ph-cloud-slash"></i>
    <span>Report saved locally. <strong>Sign up free</strong> to access reports on any device.</span>
    <button class="save-banner-cta" onclick="openAuthModal('signup'); dismissSaveBanner();">Sign Up</button>
    <button class="save-banner-close" onclick="dismissSaveBanner()"><i class="ph ph-x"></i></button>
  `;
  document.body.appendChild(banner);

  // Auto-dismiss after 8 seconds
  setTimeout(dismissSaveBanner, 8000);
}

window.dismissSaveBanner = function () {
  const b = document.getElementById('saveBanner');
  if (b) { b.classList.add('banner-hiding'); setTimeout(() => b.remove(), 350); }
};

function getHistory() {
  let histories = JSON.parse(localStorage.getItem('mediscan_history')) || {};
  return histories[getScopeKey()] || [];
}

function loadHistory() {
  const history = getHistory();
  historyList.innerHTML = '';

  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-text">No history available for this profile.</p>';
    dashboardEmpty.style.display = 'block';
    dashboardContent.style.display = 'none';
    dashboardActions.style.display = 'none';
    return;
  }

  // Load last scan to dashboard
  lastReportData = history[history.length - 1].data;
  renderDashboard(lastReportData);
  resetFeedback();

  // Render list (reverse chronological)
  [...history].reverse().forEach((item, index) => {
    const d = new Date(item.date).toLocaleDateString();
    historyList.innerHTML += `
      <div class="history-item" onclick="renderDashboardFromHistory(${history.length - 1 - index})">
        <div>
          <span class="history-date">Scan on ${d}</span>
          <span class="history-score">Risk Score: <strong>${item.data.riskScore || 'N/A'}</strong></span>
        </div>
        <i class="ph ph-caret-right"></i>
      </div>
    `;
  });
}

window.renderDashboardFromHistory = function (index) {
  const history = getHistory();
  lastReportData = history[index].data;
  renderDashboard(lastReportData);
  resetFeedback();
  document.querySelector('[data-tab="dashboard"]').click();
};

// Dashboard Action Buttons
document.getElementById('btnToggleChart').addEventListener('click', () => {
  document.getElementById('chartModal').style.display = 'flex';
});

document.getElementById('closeChartModal').addEventListener('click', () => {
  document.getElementById('chartModal').style.display = 'none';
});

// Feedback Logic
const feedbackTextContainer = document.getElementById('feedbackTextContainer');
const btnSubmitFeedback = document.getElementById('btnSubmitFeedback');
const feedbackTextInput = document.getElementById('feedbackTextInput');

function resetFeedback() {
  btnFeedbackUp.classList.remove('active');
  btnFeedbackDown.classList.remove('active');
  feedbackThanks.classList.add('hidden');
  if (feedbackTextContainer) feedbackTextContainer.classList.add('hidden');
  if (feedbackTextInput) feedbackTextInput.value = '';
}

btnFeedbackUp.addEventListener('click', () => {
  btnFeedbackUp.classList.add('active');
  btnFeedbackDown.classList.remove('active');
  feedbackTextContainer.classList.remove('hidden');
  feedbackThanks.classList.add('hidden');
});

btnFeedbackDown.addEventListener('click', () => {
  btnFeedbackDown.classList.add('active');
  btnFeedbackUp.classList.remove('active');
  feedbackTextContainer.classList.remove('hidden');
  feedbackThanks.classList.add('hidden');
});

btnSubmitFeedback.addEventListener('click', () => {
  feedbackTextContainer.classList.add('hidden');
  feedbackThanks.classList.remove('hidden');
  // Later: send to DB
});

// Export PDF
document.getElementById('btnExportPdf').addEventListener('click', async () => {
  if (!lastReportData) return showToast('No report data to export. Please run a scan first.', 'info');

  const btn = document.getElementById('btnExportPdf');
  btn.innerHTML = '<i class="ph ph-spinner"></i> Generating...';
  btn.disabled = true;

  const data = lastReportData;

  const triageRowsHtml = (data.triageResults || []).map(item => {
    const s = (item.status || 'normal').toLowerCase();
    const palette = {
      critical: { bg: '#FEE2E2', text: '#B91C1C', border: '#DC2626' },
      attention: { bg: '#FEF3C7', text: '#92400E', border: '#D97706' },
      monitor: { bg: '#E0F2FE', text: '#0369A1', border: '#0EA5E9' },
      normal: { bg: '#D1FAE5', text: '#065F46', border: '#10B981' },
    };
    const c = palette[s] || palette.normal;
    return `
      <div style="margin-bottom:10px;padding:12px 16px;background:${c.bg};border-left:5px solid ${c.border};border-radius:6px;">
        <div style="font-weight:700;color:${c.text};font-size:14px;">${item.parameter}: ${item.value}</div>
        <div style="color:${c.text};font-size:13px;margin-top:4px;">${item.explanation || ''}</div>
      </div>`;
  }).join('');

  const riskColor = (data.riskScore > 70) ? '#DC2626' : (data.riskScore > 40) ? '#D97706' : '#059669';

  const pdfHtml = `
    <div style="font-family:'Segoe UI',Roboto,Helvetica,sans-serif;background:#ffffff;color:#0F172A;padding:32px;max-width:750px;margin:0 auto;">
      <div style="display:flex;align-items:center;border-bottom:3px solid #3B82F6;padding-bottom:16px;margin-bottom:24px;">
        <span style="font-size:26px;font-weight:900;color:#3B82F6;letter-spacing:-1px;">MediScan AI</span>
        <span style="font-size:12px;color:#64748B;margin-left:auto;">Generated: ${new Date().toLocaleString()}</span>
      </div>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Health Risk Score</div>
        <div style="font-size:56px;font-weight:900;color:${riskColor};line-height:1;">${data.riskScore || 0}</div>
        <div style="font-size:14px;color:#334155;font-weight:600;margin-top:8px;">${data.urgency || ''}</div>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:14px;">🔬 Triage Alerts</div>
          ${triageRowsHtml || '<div style="color:#64748B;font-size:13px;">No alerts found.</div>'}
        </div>
        <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:10px;">🩺 AI Health Coach</div>
          <div style="font-size:13px;color:#334155;line-height:1.7;">${data.healthCoach || ''}</div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid #E2E8F0;">
            <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Next Step</div>
            <div style="font-size:13px;color:#3B82F6;font-weight:600;margin-top:4px;">${data.followUp || ''}</div>
          </div>
        </div>
      </div>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:18px;margin-bottom:20px;">
        <div style="font-size:14px;font-weight:700;color:#1E3A8A;margin-bottom:8px;">⚗️ Symptom Correlation</div>
        <div style="font-size:13px;color:#1E3A8A;line-height:1.7;font-style:italic;">${data.symptomCorrelation || 'No correlation provided.'}</div>
      </div>

      <div style="border-top:1px solid #E2E8F0;padding-top:12px;font-size:11px;color:#94A3B8;text-align:center;">
        This report is AI-generated and is for informational purposes only. Always consult a qualified medical professional for diagnosis and treatment.
      </div>
    </div>`;

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(pdfHtml);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow.print();
    } catch (err) {
      console.error('Print Error:', err);
      alert('Error triggering print: ' + err.message);
    } finally {
      document.body.removeChild(iframe);
      btn.innerHTML = '<i class="ph ph-download-simple"></i> Export PDF';
      btn.disabled = false;
    }
  }, 500);
});

// Chat Widget Logic
chatToggleBtn.addEventListener('click', () => {
  chatWidget.classList.toggle('open');
});
chatCloseBtn.addEventListener('click', () => {
  chatWidget.classList.remove('open');
});

chatSendBtn.addEventListener('click', handleChat);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleChat(); });

async function handleChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return showToast('API Key required for chat.', 'error');

  // Rate limit chat too
  if (!RateLimiter.canCall()) {
    const wait = Math.ceil(RateLimiter.remaining() / 1000);
    return showToast(`Please wait ${wait}s before sending another message.`, 'info');
  }

  chatBody.innerHTML += `
    <div class="chat-msg user">
      <div class="msg-bubble">${escapeHTML(text)}</div>
    </div>`;

  // Cap chat messages to prevent memory leaks
  const msgs = chatBody.querySelectorAll('.chat-msg');
  if (msgs.length > MAX_CHAT_MSGS) {
    for (let i = 0; i < msgs.length - MAX_CHAT_MSGS; i++) msgs[i].remove();
  }
  chatInput.value = '';
  chatBody.scrollTop = chatBody.scrollHeight;

  const loadingId = 'msg-' + Date.now();
  chatBody.innerHTML += `
    <div class="chat-msg ai" id="${loadingId}">
      <div class="msg-bubble">Thinking...</div>
    </div>`;
  chatBody.scrollTop = chatBody.scrollHeight;

  try {
    RateLimiter.record();
    const context = lastReportData ? JSON.stringify(lastReportData) : "No report uploaded yet.";

    const prompt = `
You are MediScan AI assistant. Answer the user's question based strictly on their medical report data provided below.
If they ask something unrelated, politely decline.
Explain your answer in extremely simple, crisp language suitable for a 5th grader.
Language: ${currentLanguage}.
Report Data Context:
${context}

User Question: ${text}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    const json = await callGeminiAPI(apiKey, payload, false);
    const reply = json.candidates[0].content.parts[0].text;

    const escapedReply = reply.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');

    document.getElementById(loadingId).innerHTML = `
      <div class="msg-bubble">${reply}</div>
      <button onclick="readTextAloud('${escapedReply}')" style="background:none; border:none; color:var(--primary); cursor:pointer; margin-top:4px; font-size:0.8rem; display:flex; align-items:center; gap:4px; margin-left: 8px;">
        <i class="ph-fill ph-speaker-high"></i> Listen
      </button>
    `;
  } catch (err) {
    document.getElementById(loadingId).innerHTML = `<div class="msg-bubble" style="color:var(--danger);">Error: Could not fetch response.</div>`;
  }
  chatBody.scrollTop = chatBody.scrollHeight;
}

init();

// ==================== SPECIALIST FINDER ====================
window.findSpecialist = function () {
  if (!lastReportData) return showToast('Please analyze a report first to find a relevant specialist.', 'info');

  // Try to find a specialty keyword from follow-up or triage results
  const textToSearch = (lastReportData.followUp + ' ' + (lastReportData.triageResults?.map(r => r.parameter).join(' ') || '')).toLowerCase();

  let specialty = 'General Physician';
  if (textToSearch.includes('heart') || textToSearch.includes('cardio') || textToSearch.includes('bp')) specialty = 'Cardiologist';
  else if (textToSearch.includes('sugar') || textToSearch.includes('diabet') || textToSearch.includes('glucose')) specialty = 'Endocrinologist';
  else if (textToSearch.includes('skin') || textToSearch.includes('derm')) specialty = 'Dermatologist';
  else if (textToSearch.includes('kidney') || textToSearch.includes('renal')) specialty = 'Nephrologist';
  else if (textToSearch.includes('stomach') || textToSearch.includes('gastric')) specialty = 'Gastroenterologist';
  else if (textToSearch.includes('blood') || textToSearch.includes('hemoglobin')) specialty = 'Hematologist';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const url = `https://www.google.com/maps/search/${specialty}+near+me/@${latitude},${longitude}`;
      window.open(url, '_blank');
    }, () => {
      // Fallback if location denied
      const url = `https://www.google.com/maps/search/${specialty}+near+me`;
      window.open(url, '_blank');
    });
  } else {
    const url = `https://www.google.com/maps/search/${specialty}+near+me`;
    window.open(url, '_blank');
  }
};
