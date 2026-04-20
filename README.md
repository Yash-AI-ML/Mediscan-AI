# 🏥 MediScan AI — Premium Health Analyzer

![MediScan AI Header](https://raw.githubusercontent.com/your-username/mediscan-ai/main/assets/banner.png)

> **Understand your health, instantly.** MediScan AI translates complex medical jargon into clear, actionable insights using Google Gemini AI.

MediScan AI is a state-of-the-art medical report analyzer that uses advanced AI to extract biomarkers, assess health risks, and provide personalized coaching—all while keeping your data private and secure.

---

## ✨ Key Features

- **🔬 AI Lab Extraction**: Upload PDFs or images of blood tests and reports.
- **🚨 Smart Triage**: Automatically flags "Critical", "Attention", and "Normal" values based on clinical ranges.
- **📊 Interactive Dashboard**: Visualize your health metrics with dynamic charts and risk dials.
- **🤖 AI Health Assistant**: Chat with a specialized AI to ask follow-up questions about your report.
- **🌍 20+ Languages**: Full multi-language support (English, Hindi, Spanish, etc.).
- **🔐 Secure & Private**: Uses SHA-256 local hashing and secure secret management.
- **📄 Professional PDF Export**: Generate and print a clean summary for your doctor.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, Modern CSS3 (Glassmorphism), Javascript (ES6+)
- **AI Engine**: Google Gemini AI (Pro & Flash)
- **Database/Auth**: Firebase (Firestore & Authentication)
- **Email/OTP**: EmailJS
- **Icons**: Phosphor Icons
- **Charts**: Chart.js

---

## 🚀 Setup & Installation

To protect private API keys, this project uses a `secrets.js` architecture.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/mediscan-ai.git
   cd mediscan-ai
   ```

2. **Configure Secrets**:
   - Locate `secrets.example.js` in the root directory.
   - **Rename** it to `secrets.js`.
   - Open `secrets.js` and fill in your Firebase and EmailJS credentials.
   - *Note: `secrets.js` is automatically ignored by git to keep your keys safe.*

3. **Run Locally**:
   Simply open `index.html` in any modern web browser or use a Live Server extension.

---

## 🛡️ Security & Privacy

MediScan AI is designed with privacy-first principles:
- **Zero-Storage Policy**: We do not store your medical reports on our servers.
- **Local Hashing**: Credentials are hashed on your device.
- **Git Protection**: Sensitive configuration is excluded from source control.

---

## 👨‍💻 Author

Built with ❤️ by **Yash**
*Made for the **World*** 🌎

---

## ⚠️ Disclaimer

**MediScan AI is an educational tool for informational purposes only.** It does not provide medical diagnoses, treatment advice, or professional opinions. Always seek the advice of a physician or other qualified health provider with any questions you may have regarding a medical condition.

---

*© 2026 MediScan AI. All rights reserved.*
