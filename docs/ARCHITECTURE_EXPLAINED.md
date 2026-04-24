# 🛡️ ConsumerShield — Complete Architecture Explanation

## Overview

ConsumerShield is a **dual-threat consumer protection system** that:
1. **Detects privacy violations** (trackers, data sharing, fingerprinting)
2. **Detects dark patterns** (manipulation tactics like false urgency, trick wording, sneaking)
3. **Enforces Indian consumer laws**: DPDP Act 2023, CCPA Guidelines 2023, Consumer Protection Act 2019

It works as a **browser extension** that analyzes websites in real-time and sends findings to an optional **backend server** for deeper AI analysis and blockchain evidence storage.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       BROWSER (Your Computer)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │          CHROME EXTENSION (ConsumerShield)                │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │                                                            │ │
│  │  [popup.html/js]   [popup.css]      [icons/]              │ │
│  │   ↓                 ↓                 ↓                     │ │
│  │   User Interface    Styling          Visual Assets         │ │
│  │                                                            │ │
│  │  [background.js] (Service Worker - runs constantly)       │ │
│  │   • Coordinates between scripts                           │ │
│  │   • Manages storage                                       │ │
│  │   • Routes messages                                       │ │
│  │                                                            │ │
│  │  [content.js] (Runs on every webpage)                     │ │
│  │   • Extracts trackers from DOM & network requests        │ │
│  │   • Scans HTML for dark pattern signatures               │ │
│  │   • Calculates risk scores locally                        │ │
│  │                                                            │ │
│  │  [dual-risk-calculator.js]                               │ │
│  │   • Privacy Risk (0-10): Based on trackers found         │ │
│  │   • Manipulation Risk (0-10): Based on patterns found    │ │
│  │   • Overall Risk: Max of both scores                     │ │
│  │                                                            │ │
│  │  Chrome Storage API                                       │ │
│  │   • Caches analysis results                              │ │
│  │   • Stores user settings                                 │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ↓ (Optional) Sends deep analysis request                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓ HTTP POST
                    (if backend is running)
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND SERVER (Python FastAPI)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [main.py] FastAPI Application                                   │
│  ├── POST /analyze-complete → Full analysis (privacy+dark)      │
│  ├── POST /analyze-privacy → Privacy only                       │
│  ├── POST /analyze-dark-patterns → Dark patterns only           │
│  └── GET /health → Server status                                │
│                                                                   │
│  [database.py] SQLite Storage                                    │
│  ├── Stores all analysis reports                                │
│  ├── Tracks blockchain anchoring status                         │
│  ├── Indexes by domain, timestamp, risk score                   │
│  └── Enables report history & trends                            │
│                                                                   │
│  [regulatory_database.py] Law Mappings                           │
│  ├── DPDP Act 2023 violations                                   │
│  ├── CCPA Dark Pattern Guidelines 2023                          │
│  ├── Consumer Protection Act 2019                               │
│  └── Penalty & authority information                            │
│                                                                   │
│  [AI Analysis] (Optional - Gemini API)                          │
│  ├── Deep psychological analysis of dark patterns              │
│  ├── Confirms BERT classifier predictions                      │
│  ├── Explains legal implications                               │
│  └── Uses "Digital Forensic Auditor" system prompt             │
│                                                                   │
│  [Blockchain Anchoring] (Optional - Ethereum Sepolia)           │
│  ├── Stores report hash on-chain as evidence                   │
│  ├── Creates tamper-proof audit trail                          │
│  ├── Enables later verification                                │
│  └── Manages transaction status tracking                       │
│                                                                   │
│  [Tracker Radar] (Optional - radar_lite.json)                   │
│  ├── Known tracker database (domains + entity info)            │
│  ├── Maps trackers to companies & categories                   │
│  ├── Enriches heuristic detection with entity names            │
│  └── Enables risk scoring by company reputation                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow — Step by Step

### 1️⃣ You visit a website

User opens any website (e.g., www.example-shop.com)

### 2️⃣ Extension's content.js activates

The `content.js` script automatically runs on the page and:

```javascript
// STEP 1: Extract all trackers
- Scan all <script>, <img>, <iframe> tags
- Check network requests for known tracker domains
- Match against signature patterns (Google Analytics, Facebook Pixel, etc.)
- Result: List of 20+ trackers found

// STEP 2: Extract dark pattern signatures
- Scan button text: Look for shame ("No, I'd rather pay full price")
- Scan urgency language: "Only 2 left!", "Buy now!"
- Scan sneaking patterns: Hidden checkboxes, auto-checked boxes
- Scan visual interference: Color contrast of buttons
- Scan trick wording: Double negatives, confusing language
- Result: List of 5 dark patterns found

// STEP 3: Scan privacy policy (if available)
- Check for "third party sharing" mentions
- Check for "opt-out" mechanisms
- Check for fingerprinting language
- Result: Privacy risk indicators

// STEP 4: Calculate risk scores locally
const calculator = new DualRiskCalculator();

// Privacy Risk (0-10)
// 4 points = trackers found
// 1.5 points = third-party sharing
// 1.5 points = no opt-out mechanism
// 2 points = fingerprinting detected
// Result: privacy_risk = 9.0

// Manipulation Risk (0-10)
// Urgency (high): 4.0 × confidence
// Sneaking (high): 4.0 × confidence
// Trick wording (medium): 2.0 × confidence
// Result: manipulation_risk = 6.4

// Overall Risk = max(9.0, 6.4) = 9.0 (RED: HIGH RISK)
```

### 3️⃣ Results stored in Chrome storage

```javascript
// Cached in browser storage (no need to re-analyze same domain)
chrome.storage.local.set({
  "example-shop.com": {
    trackers: [
      { name: "Google Analytics", domain: "google-analytics.com" },
      { name: "Facebook Pixel", domain: "connect.facebook.net" },
      // ... 18 more trackers
    ],
    patterns: [
      { type: "urgency", text: "Only 2 left!", severity: "high" },
      { type: "sneaking", text: "Newsletter checkbox auto-checked" },
      // ... 3 more patterns
    ],
    privacy_risk: 9.0,
    manipulation_risk: 6.4,
    overall_risk: 9.0,
    timestamp: 2026-04-23T10:30:00Z
  }
})
```

### 4️⃣ User clicks extension icon → Popup appears

The popup.js loads the cached analysis and renders:

```
┌─────────────────────────────────────┐
│  🛡️ ConsumerShield                 │
├─────────────────────────────────────┤
│  [Overview] [Privacy] [Patterns]    │ ← Tabs
├─────────────────────────────────────┤
│                                     │
│  OVERALL RISK:                      │
│  🔴 9.0/10 — HIGH (Dangerous)      │
│                                     │
│  Privacy Risk:   🔴 9.0/10          │
│  Manipulation:   🟡 6.4/10          │
│                                     │
│  [🔄 Rescan] [📋 Full Report]      │
│                                     │
└─────────────────────────────────────┘
```

### 5️⃣ (Optional) Send for backend deep analysis

If user clicks "Full Report", the extension sends the analysis to the backend:

```json
POST /analyze-complete
{
  "url": "https://example-shop.com/checkout",
  "domain": "example-shop.com",
  "trackers": [...],
  "patterns": [...],
  "policy_text": "..."
}
```

### 6️⃣ Backend performs AI analysis (if Gemini API enabled)

```python
# Backend receives the data and:

# 1. Use local BERT classifier for dark pattern confirmation
from transformers import pipeline
classifier = pipeline("text-classification", 
    model="aditizingre07/distilroberta-dark-pattern")
result = classifier(pattern_text)
# Returns: 0.95 confidence = Dark pattern confirmed

# 2. Call Google Gemini AI for psychological analysis
gemini_prompt = f"""
You are a Digital Forensic Auditor.
Analyze this button text for psychological manipulation:
Button 1: "Accept all" (high contrast, bright green)
Button 2: "Reject all" (low contrast, barely visible)
Identify the dark pattern type and explain the manipulation.
"""
response = gemini_client.generate_content(gemini_prompt)
# Returns detailed explanation of visual interference

# 3. Map violations to Indian laws
violations = {
  "urgency": {
    "law": "CCPA Dark Patterns Guidelines 2023",
    "penalty": "₹10 lakh – ₹50 lakh",
    "authority": "Central Consumer Protection Authority"
  },
  "visual_interference": {
    "law": "CCPA Dark Patterns Guidelines 2023",
    "penalty": "₹10 lakh – ₹50 lakh"
  }
}

# 4. Store in database
db_report = ReportRecord(
    report_id=uuid.uuid4(),
    url=url,
    domain=domain,
    risk_score=9.0,
    detected_patterns=["urgency", "visual_interference"],
    privacy_risk=9.0,
    manipulation_risk=6.4,
    timestamp=datetime.utcnow()
)
db.add(db_report)
db.commit()
```

### 7️⃣ (Optional) Anchor evidence on blockchain

For legal proof, the backend can store report hash on Ethereum Sepolia testnet:

```python
# Create cryptographic proof of report
report_hash = SHA256(report_data)
# e.g., hash = "0xabc123def456..."

# Store on blockchain
tx_hash = store_report_hash_on_chain(
    contract_address="0x...",
    report_hash=report_hash,
    rpc_url="https://sepolia.infura.io/...",
    private_key="0x..."
)
# Result: Permanent, tamper-proof evidence stored forever
# Transaction: https://sepolia.etherscan.io/tx/{tx_hash}

# Can later verify:
is_authentic = verify_report_hash_on_chain(report_hash)
# Returns: True if hash hasn't been tampered with
```

### 8️⃣ Backend returns enhanced report to extension

```json
{
  "overall_risk": 9.0,
  "risk_level": "CRITICAL",
  "privacy_risk": {
    "score": 9.0,
    "trackers_found": 23,
    "categories": ["analytics", "advertising", "data_broker"],
    "violations": [
      {
        "type": "tracking_without_consent",
        "law": "DPDP Act 2023, Section 6",
        "penalty": "₹50 crore – ₹250 crore"
      }
    ]
  },
  "manipulation_risk": {
    "score": 6.4,
    "patterns": [
      {
        "type": "urgency",
        "severity": "high",
        "examples": ["Only 2 left!", "Sale ends in 1 hour"],
        "law": "CCPA Dark Patterns Guidelines 2023",
        "penalty": "₹10 lakh – ₹50 lakh",
        "explanation": "This site artificially creates urgency using false scarcity..."
      },
      {
        "type": "visual_interference",
        "severity": "high",
        "explanation": "The 'Reject' button uses 93% less contrast than 'Accept'..."
      }
    ]
  },
  "blockchain_proof": {
    "anchored": true,
    "tx_hash": "0xabc123def456...",
    "verified": true
  }
}
```

---

## 🎯 What Each File Does

### **Backend Files**

| File | Purpose |
|------|---------|
| `main.py` | FastAPI server with 3 endpoints; coordinates Gemini AI, BERT model, blockchain storage |
| `database.py` | SQLite schema & ORM; stores all reports with indexing by domain/risk/time |
| `regulatory_database.py` | Maps violations to Indian laws (DPDP, CCPA, CPA 2019) with penalties & citations |
| `ethereum_anchor.py` | Blockchain integration; calculates report hash & stores on Sepolia testnet |
| `requirements.txt` | Python dependencies (FastAPI, SQLAlchemy, transformers, google-genai, web3) |

### **Extension Files**

| File | Purpose |
|------|---------|
| `manifest.json` | Extension metadata; declares permissions & entry points |
| `content.js` | Main analysis logic; extracts trackers & patterns from DOM |
| `background.js` | Service worker; coordinates scripts & manages storage |
| `popup.js` | Popup UI script; renders tabs & loads cached analysis |
| `popup.html` | Popup UI structure; has tabs for Overview/Privacy/Patterns |
| `popup.css` | Popup styling; colors, layout, responsive design |
| `dual-risk-calculator.js` | Risk scoring algorithm; privacy + manipulation → overall risk |
| `report.html` | Detailed report page with full violation breakdown |
| `report.js` | Report page logic; fetches detailed data from backend |

---

## 📊 Risk Scoring System

### **Privacy Risk (0-10)**

| Factor | Points |
|--------|--------|
| 1-2 trackers | 1 |
| 3-5 trackers | 2 |
| 6-9 trackers | 3 |
| 10+ trackers | 4 |
| Third-party data sharing mentioned | 1.5 |
| No opt-out mechanism | 1.5 |
| Extensive data collection language | 1 |
| Fingerprinting / Canvas tracking | 2 |
| **Maximum score** | **10** |

### **Manipulation Risk (0-10)**

| Pattern | Severity | Weight |
|---------|----------|--------|
| Urgency / False Scarcity | High | 4.0 |
| Sneaking / Hidden Consent | High | 4.0 |
| False Hierarchy | High | 4.0 |
| Trick Wording | Medium | 2.0 |
| Visual Interference | High | 4.0 |
| Confirmshaming | High | 4.0 |
| Disguised Ads | Medium | 2.0 |
| Forced Action | High | 4.0 |
| **Maximum score** | | **10** |

### **Overall Risk**

```
Overall Risk = max(Privacy Risk, Manipulation Risk)
```

**Risk Levels:**
- 🚨 **CRITICAL**: 8.5–10 (Aggressive exploitation)
- ⚠️ **HIGH**: 6.5–8.4 (Significant concerns)
- 🔔 **MEDIUM**: 4.0–6.4 (Moderate concerns)
- ✅ **LOW**: 2.0–3.9 (Minor concerns)
- ✅ **MINIMAL**: 0–1.9 (Trustworthy)

---

## 🔍 Example Scenario

### Website: www.cheap-flight-deals.com

**What happens:**

1. **Extension scans page:**
   - Finds 28 trackers (Google Analytics, Facebook Pixel, Criteo, etc.)
   - Finds urgency patterns: "Book now! Sale ends in 2 hours!"
   - Finds hidden checkbox: Newsletter auto-subscribed
   - Finds button manipulation: "Book Flight" (green, large) vs "Cancel" (gray, small)

2. **Local risk calculation:**
   ```
   Privacy Risk = 4 (28 trackers) + 1.5 (3rd party sharing) + 2 (fingerprinting) = 7.5
   Manipulation Risk = 4.0 (urgency) + 4.0 (sneaking) + 4.0 (visual) = 12.0 → capped at 10
   Overall = max(7.5, 10.0) = 10.0 🚨 CRITICAL
   ```

3. **Popup shows:**
   ```
   🛡️ ConsumerShield
   ────────────────────
   🚨 10.0/10 — CRITICAL
   
   Privacy:      🔴 7.5/10
   Manipulation: 🔴 10.0/10
   
   This site aggressively exploits you on BOTH fronts — 28 trackers stealing your data
   and 3+ manipulation tactics distorting your decisions. Proceed with extreme caution.
   ```

4. **User clicks "Full Report":**
   - Backend analysis confirms patterns with AI
   - Maps violations to laws:
     - "Urgency" → CCPA Dark Patterns Guidelines 2023 (₹10L–50L)
     - "Tracking without consent" → DPDP Act 2023 (₹50Cr–250Cr)
   - Stores blockchain proof (optional)

---

## 🔐 Regulatory Mapping

### Detected by Extension → Mapped to Law

| Dark Pattern | Law | Penalty |
|--------------|-----|---------|
| **Urgency** (false scarcity, time pressure) | CCPA Guidelines 2023 | ₹10L–50L |
| **Sneaking** (hidden subscriptions, auto-checks) | CCPA Guidelines 2023 | ₹10L–50L |
| **Trick Wording** (double negatives, confusing) | CCPA Guidelines 2023 | ₹10L–50L |
| **False Hierarchy** (opt-out buried 3+ clicks deep) | CCPA Guidelines 2023 | ₹10L–50L |
| **Visual Interference** (button contrast manipulation) | CCPA Guidelines 2023 | ₹10L–50L |
| **Confirmshaming** (shame user for saying "No") | CCPA Guidelines 2023 | ₹10L–50L |
| **Trackers without consent** | DPDP Act 2023, Section 6 | ₹50Cr–250Cr |
| **No opt-out mechanism** | DPDP Act 2023, Section 12 | ₹10Cr–250Cr |
| **Third-party data sharing** | DPDP Act 2023, Section 8 | ₹50Cr–250Cr |

---

## ⚙️ How to Use It

### **For End Users:**

1. Install extension from `chrome://extensions/ → Load unpacked`
2. Browse normally — extension analyzes automatically
3. Click icon to see risk score & patterns
4. Visit suspicious sites? Get instant legal warnings

### **For Developers:**

1. **Start backend** (optional):
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

2. **Check API docs**: http://localhost:8000/docs

3. **Example API call**:
   ```bash
   curl -X POST http://localhost:8000/analyze-complete \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://example.com",
       "domain": "example.com",
       "trackers": [...],
       "patterns": [...]
     }'
   ```

---

## 🚀 Key Features

✅ **Real-time Detection** — Analysis happens instantly as you browse
✅ **Dual Analysis** — Catches privacy AND manipulation (most tools only do one)
✅ **Offline by Default** — Works fully offline; backend is optional
✅ **AI-Powered** — Gemini API for deep psychological pattern analysis
✅ **Local BERT** — Fast dark pattern classification without network calls
✅ **Blockchain Proof** — Optional Ethereum anchoring for legal evidence
✅ **Indian Law Compliant** — Maps violations to DPDP Act, CCPA Guidelines, CPA 2019
✅ **Zero Data Selling** — Analysis stays on your computer

---

## 📚 Summary

ConsumerShield works like a **personal lawyer** that:
1. **Watches** every website you visit
2. **Detects** privacy violations (trackers, data sharing)
3. **Detects** manipulation tactics (fake urgency, sneaky design)
4. **Scores** the risk (0–10)
5. **Maps** violations to laws you can report
6. **(Optionally)** Creates blockchain proof for legal action

**All this happens instantly, locally, on your machine.**

---

Last Updated: April 23, 2026
