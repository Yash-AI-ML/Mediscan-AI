// ============================================================
// MediScan AI — Public Configuration (v2.0.0)
// ============================================================
//
// CONFIGURATION NOTE:
// Sensitive keys (Firebase, EmailJS) are now stored in secrets.js
// which is ignored by git for security.
// ============================================================

const SECRETS = window.MEDISCAN_SECRETS || {};

window.MEDISCAN_CONFIG = {
  FIREBASE_CONFIG: SECRETS.FIREBASE_CONFIG || {},
  EMAILJS_CONFIG: SECRETS.EMAILJS_CONFIG || {},

  // App constants
  APP_VERSION: "2.0.0",
  MAX_HISTORY_ITEMS: 50,
  API_RATE_LIMIT_MS: 5000,
  MAX_CHAT_MESSAGES: 50,
  MODELS_TO_TRY: ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.0-flash', 'gemini-2.5-flash-lite'],
};
