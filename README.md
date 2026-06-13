# 🏥 MediScan AI
> Understand your health, instantly.

[![Made with Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5-blue?logo=google)](https://ai.google.dev)
[![RAG Pipeline](https://img.shields.io/badge/RAG-Pinecone%20%2B%20LangChain-purple)](https://pinecone.io)
[![Backend](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Firebase-orange?logo=firebase)](https://firebase.google.com)
[![License](https://img.shields.io/badge/License-Educational-lightgrey)](#)
[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen)](https://mediscan-ai-2007.web.app)

MediScan AI analyzes medical lab reports using Google Gemini AI — extracting biomarkers, validating them against **30+ clinical reference ranges**, and explaining results in plain, jargon-free language. The AI chat assistant is powered by a **production-grade RAG pipeline** with vector search, conversation memory, and query rewriting. Supports 20+ languages.

---

## 📸 Screenshots

### Landing Page
![MediScan Landing Page](screenshot/landing.png)

### Dashboard — Triage Alerts & Risk Score
![MediScan Dashboard](screenshot/dashboard.png)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔬 **AI Report Analysis** | Upload PDF or image → structured biomarker extraction via Gemini 2.5 Flash |
| 🚨 **Smart Triage** | Flags Critical / Attention / Monitor / Normal with color coding |
| ✅ **Client-Side Validation** | AI output cross-checked against 30+ clinical reference ranges — AI cannot override medical facts |
| 📊 **Interactive Dashboard** | Risk score ring, triage alerts, health coaching |
| 🤖 **RAG Chat Assistant** | Vector search over your report — answers grounded in your actual data, not AI guesses |
| 🧠 **Conversation Memory** | Sliding window memory — bot remembers context across the full session |
| 🔍 **Query Rewriting** | Vague questions like "is that normal?" are rewritten into specific medical queries before search |
| 🌍 **20+ Languages** | Hindi, Spanish, French, Arabic, Japanese, and more |
| 🔒 **Privacy-First** | Report embeddings scoped to user session — auto-isolated per Firebase UID |
| 👨‍👩‍👧 **Family Profiles** | Track reports for Self, Mother, Father, Child |
| 📄 **PDF Export** | Clean downloadable summary report |
| 🔊 **Voice I/O** | Speak symptoms, listen to your summary |

---

## 🧠 How It Works

### Report Analysis Pipeline
```
Upload medical report (PDF / Image)
↓
Gemini AI extracts structured biomarker data
↓
validateAIOutput() cross-checks 30+ clinical reference ranges
↓
Risk score + triage levels assigned
↓
Interactive dashboard + charts rendered
```

### RAG Chat Pipeline
```
PDF uploaded → chunked (300 tokens, 50 overlap)
↓
Gemini text-embedding-001 generates vectors for each chunk
↓
Vectors stored in Pinecone (user-scoped by Firebase UID)
↓
User asks question → query rewritten into medical search query
↓
Pinecone vector search → top 3 relevant chunks retrieved
↓
Similarity threshold (0.5) filters irrelevant results
↓
Sliding window memory (last 6 messages) added to prompt
↓
Groq LLM generates grounded answer from retrieved context only
↓
"Answer only from report data" rule prevents hallucination
```

---

## 🛡️ Security Model

| Layer | Implementation |
|---|---|
| **Gemini API Key** | User-entered → `localStorage` only. Never in source code. |
| **Firestore Rules** | User-scoped: `request.auth.uid == userId`. Default deny. |
| **RAG Session Isolation** | Pinecone vectors filtered by Firebase UID — users can never access each other's report data |
| **Hallucination Prevention** | LLM instructed to answer ONLY from retrieved context. Returns "not in your report" if similarity threshold not met |
| **XSS Prevention** | `escapeHTML()` on all user-injected DOM content |
| **Rate Limiting** | 5-second cooldown between API calls |
| **Response Caching** | LRU cache prevents duplicate API costs |
| **Input Validation** | AI output overridden when it conflicts with reference ranges |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| AI — Analysis | Google Gemini 2.5 Flash |
| AI — Embeddings | Google Gemini text-embedding-001 (3072 dimensions) |
| AI — Chat | Groq LLM (llama-3.1-8b-instant) |
| Vector Database | Pinecone (cosine similarity, user-scoped namespaces) |
| RAG Framework | LangChain (RecursiveCharacterTextSplitter) |
| RAG Backend | FastAPI + Uvicorn (deployed on Render) |
| Auth & Database | Firebase Authentication + Firestore |
| Charts | Chart.js |
| Hosting | Firebase Hosting |

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│     MediScan Frontend (JS)      │
│  Firebase Hosted · Vanilla JS   │
└────────────┬────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌───────────┐   ┌─────────────────────┐
│ Gemini AI │   │  FastAPI RAG Backend│
│ (Analysis)│   │  Render.com Hosted  │
└───────────┘   └────────┬────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        ┌──────────┐         ┌────────────┐
        │ Pinecone │         │  Groq LLM  │
        │ Vector DB│         │  (Chat)    │
        └──────────┘         └────────────┘
```

---

## 🚀 Run Locally

### Frontend
**You'll need:** A free [Gemini API key](https://aistudio.google.com/apikey) (takes 2 minutes)

```bash
git clone https://github.com/Yash-AI-ML/Mediscan-AI.git
cd Mediscan-AI
npx serve .
```
Open `http://localhost:3000` → Enter your Gemini API key → Upload a report.

### RAG Backend
**You'll need:** Gemini API key, Pinecone API key, Groq API key (all free)

```bash
git clone https://github.com/Yash-AI-ML/mediscan-rag.git
cd mediscan-rag
pip install -r requirements.txt
# Add your API keys to .env
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

---

## 🔮 Roadmap

- [x] RAG-powered chatbot with Pinecone vector search
- [x] Conversation memory with sliding window
- [x] Query rewriting for vague questions
- [x] FastAPI backend deployed on Render
- [ ] Multimodal RAG — understand charts and images in reports
- [ ] Firebase Functions backend (server-side Gemini calls)
- [ ] Unit tests with Jest
- [ ] TypeScript migration

---

## ⚠️ Disclaimer

MediScan AI is an **educational portfolio project**. It is not a licensed medical device and does not provide medical advice. Always consult a qualified physician. See [TERMS.md](TERMS.md) for full details.

---

*Built by **Yash** · 2nd year B.Tech AIML · Greater Noida · Made for the World ❤️*
*Inspired by watching my family struggle to understand medical reports for years.*
