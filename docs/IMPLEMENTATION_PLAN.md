# ConsumerShield: Precision-First Dark Pattern Detection
## Implementation Plan v1.0

**Date**: April 25, 2026
**Goal**: Zero false positives (precision-first approach)

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Problem Statement](#problem-statement)
3. [Vision Models](#vision-models)
4. [False Positive Analysis](#false-positive-analysis)
5. [Implementation Phases](#implementation-phases)
6. [Phase 1: Quick Wins](#phase-1-quick-wins)
7. [Phase 3: Genuine vs Fake Urgency](#phase-3-genuine-vs-fake-urgency)
8. [Platform-Specific Handling](#platform-specific-handling)
9. [Files to Create/Modify](#files-to-createmodify)
10. [Implementation Order](#implementation-order)
11. [Data Flow](#data-flow)
12. [Decisions Log](#decisions-log)

---

## Project Overview

**ConsumerShield** is a consumer protection system that detects:
- Privacy violations (trackers, fingerprinting, data sharing)
- Dark patterns (psychological manipulation tactics)

### Components
- Browser Extension (Chrome/Chromium Manifest v3)
- Backend Server (Python FastAPI)
- ML Models (Fine-tuned RoBERTa for dark pattern detection)
- Blockchain Integration (Ethereum Sepolia for evidence anchoring)

### Tech Stack
- **Extension**: JavaScript (Manifest v3)
- **Backend**: Python 3.8+, FastAPI, SQLAlchemy, PostgreSQL
- **ML**: PyTorch, Transformers, LoRA fine-tuning
- **Blockchain**: Web3.py, Ethereum Sepolia

---

## Problem Statement

**Issue**: The extension flags non-dark-patterns as dark patterns (false positives).

**Root Cause**: 
- Detection is primarily rule-based (260+ regex patterns), NOT ML-based
- No confidence thresholds for filtering
- Overly broad regex matching legitimate UI elements
- Educational/taxonomy pages mentioning dark patterns get flagged

### Examples of False Positives
| Scenario | Current Behavior | Desired Behavior |
|----------|------------------|------------------|
| "Sale" banner | Flagged as urgency | Not a dark pattern |
| "Only 3 left in stock" | Flagged as scarcity | Context-dependent |
| Preselected "Priority delivery" | Flagged as dark pattern | Not a dark pattern |
| Terms popup on first visit | Flagged as nagging | Legally mandated |
| Price anchoring (tiered pricing) | Flagged as misdirection | Usually not a dark pattern |

---

## Vision Models

### What Vision Models Do

The project uses **Qwen2.5-VL-7B** in a 4-tier AI architecture:

```
Tier 1: RoBERTa-base LoRA (text classification) → Always runs
Tier 2a: Qwen2.5-VL-7B (vision) → Analyzes screenshots + DOM text
Tier 2b: Gemini API → Deep forensic analysis  
Tier 3: Rule-based fallback
```

### What Qwen Analyzes
- Button sizes and visual prominence
- Color emphasis on elements
- Layout positioning
- Visual hierarchy (e.g., "Accept" button huge, "Decline" tiny)

It complements text-based detection by catching visual dark patterns that regex can't.

### Confidence Thresholds
- RoBERTa >= 0.85 → return immediately (Tier 1)
- Qwen >= 0.80 → skip Gemini (Tier 2a -Vision)
- Gemini >= 0.75 → skip rule-based (Tier 2b)
- Below all → rule-based fallback (Tier 3)

---

## False Positive Analysis

### Detection Categories & Conditions

| Category | Name | Severity | Detection Method |
|----------|------|----------|------------------|
| urgency | False Urgency | high | Text regex + DOM timers |
| sneaking | Hidden Costs (Drip Pricing) | high | Text regex + price container analysis |
| confirmshaming | Confirmshaming | medium | Text regex |
| trick_questions | Trick Questions | medium | Text regex + double-negative detection |
| forced_continuity | Forced Continuity | high | Text regex + subscription trap detection |
| disguised_ads | Disguised Advertisements | medium | Text regex |
| misdirection | Misdirection | medium | Text regex + visual interference + price anchoring |
| nagging | Nagging | medium | Modal/popup detection + sticky banners |
| obstruction | Obstruction / Roach Motel | high | Text regex + difficult cancellation |
| preselected | Pre-selected Options | medium | DOM checkbox detection |

### False Positive Sources

| Risk Level | Pattern | Triggering Scenario |
|-----------|---------|------------------|
| HIGH | urgency (regex) | Educational pages, blog posts about dark patterns |
| HIGH | enrichTaxonomy | Any site discussing dark pattern types |
| HIGH | misdirection (sticky) | Legitimate "sale" banner on any ecommerce site |
| MEDIUM | preselected | Insurance, gift wrap, "priority delivery" checkboxes |
| MEDIUM | nagging | Help modals, age verification popups |
| MEDIUM | sneaking | Shipping cost mentions in checkout |
| MEDIUM | misdirection (price anchoring) | Subscription tiers with visible pricing |
| LOW | confirmshaming | "No thanks, I don't want..." text anywhere |

---

## Implementation Phases

### Scope
- **Phase 1**: Quick wins (confidence filtering + benign exclusions)
- **Phase 3**: Genuine vs fake urgency differentiation
- **Skipped**: Phase 2 (context-aware rules) for now

---

## Phase 1: Quick Wins

### 1.1 Extension Changes (`extension/content.js`)

**Confidence Floor**
- Minimum threshold: 0.6
- All patterns below threshold → logged to `chrome.storage.debug`, NOT shown

**Pattern-Specific Exclusions**
| Pattern | Exclusion Rule |
|---------|----------------|
| Urgency | Exclude if contains: "sale", "promotion", "deal of the day", "discount" |
| Preselected | Exclude if label matches: "gift wrap", "priority delivery", "insurance" (legitimate add-ons) |
| Nagging | Exclude if popup matches: cookie consent, age verification, terms popup |
| Misdirection | Exclude if "price anchoring" with tiered pricing (standard retail) |
| All | Exclude if page contains "dark pattern" taxonomy mentions (educational pages) |

### 1.2 Popup Changes (`extension/popup.js`)

- Only display patterns with confidence >= 0.6
- Store filtered patterns in `chrome.storage.debug` (hidden from user)
- Add "Debug Mode" toggle to view filtered patterns (for testing)

### 1.3 Backend Classification Enhancement (`backend/main.py`)

**Add `urgency_type` sub-classification**
```python
UrgencySubType:
  - vague: "High demand!", "7 people viewing this" → HIGH severity
  - specific_date: "Sale ends April 26th" → MEDIUM severity  
  - numeric_unverifiable: "Only 3 left in stock" → LOW severity + warning badge
  - verified_genuine: Real inventory API confirmed → EXEMPT
```

---

## Phase 3: Genuine vs Fake Urgency Differentiation

### 3.1 State Tracking (`extension/content.js`, `extension/background.js`)

**Product-Scoped State**
```javascript
// Storage key structure
chrome.storage.local.set({
  urgencyState: {
    [domain]: {
      [productId]: {  // URL path hash as product ID
        timerValue: "00:05:30",
        firstSeen: timestamp,
        mutations: [{ old: "00:10:00", new: "00:10:00", timestamp }],
        status: "normal" | "suspicious" | "fake"
      }
    }
  }
});
```

**Mutation Detection Rules**
| Observed Behavior | Classification |
|-------------------|----------------|
| Timer reset to same value on page reload | FAKE |
| Timer jumps forward unexpectedly | FAKE |
| Timer stuck at round numbers (00:05, 00:10, 00:30) | LIKELY FAKE |
| Timer counts down normally to 0 | GENUINE |
| Specific end date (April 26 11:59 PM) visible | LIKELY GENUINE |

**Mutation Observer**
```javascript
// Watch for timer element changes
const observer = new MutationObserver(mutations => {
  mutations.forEach(m => {
    const oldVal = extractTimerValue(m.oldValue);
    const newVal = extractTimerValue(m.newValue);
    if (oldVal && newVal) {
      if (newVal > oldVal) recordMutation('reset_forward');
      if (isRoundNumber(newVal) && !isRoundNumber(oldVal)) recordMutation('stuck_at_round');
    }
  });
});
```

### 3.2 Network Interception (`extension/utils/network-analyzer.js`)

**New File: `extension/utils/network-analyzer.js`**
```javascript
class NetworkAnalyzer {
  constructor() {
    this.inventoryEndpoints = ['/inventory', '/stock', '/availability', '/product/stock'];
    this.apiCallsFound = [];
  }

  intercept() {
    // Override fetch/XHR to capture calls
    // Check if any URL contains inventory endpoints
    // Return: { hasInventoryAPI: bool, endpoints: string[] }
  }

  startIntercept() { /* activate on urgency detection */ }
  stopIntercept() { /* cleanup */ }
}
```

- Only activates when urgency patterns are detected
- Returns boolean to extension for backend payload
- **Script Snippet Capture**: Only suspicious scripts (Math.random(), hardcoded arrays)

### 3.3 Backend Endpoint (`backend/main.py`)

**New Endpoint: `POST /analyze-urgency-authenticity`**

```python
class UrgencyAuthenticityRequest(BaseModel):
    domain: str
    urgency_messages: List[UrgencyMessage]
    network_summary: NetworkSummary
    dom_text: str
    script_snippets: List[str] = []

class UrgencyMessage(BaseModel):
    text: str
    timer_state: str  # "normal" | "suspicious" | "fake"
    product_id: str   # URL path hash
    confidence: float

class UrgencyAuthenticityResponse(BaseModel):
    authenticity: Literal["fake", "likely_real", "uncertain"]
    reason: str
    urgency_type: Literal["vague", "specific_date", "numeric_unverifiable"]
    severity_adjustment: Literal["HIGH", "MEDIUM", "LOW", "EXEMPT"]
    confidence: float
```

**Analysis Pipeline**
1. Check `urgency_records` for identical message on same domain (7-day window)
2. NLP classification via Gemini prompt
3. Script analysis: detect `Math.random()`, hardcoded values
4. Network verification: boolean check
5. Return composite assessment

### 3.4 Database Schema (`backend/database.py`)

**New Table: `urgency_records`**
```python
class UrgencyRecord(Base):
    __tablename__ = "urgency_records"
    
    id = Column(Integer, primary_key=True)
    domain = Column(String(255), index=True)
    message = Column(Text)
    message_hash = Column(String(64), index=True)
    product_id = Column(String(255))
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    is_fake = Column(Boolean, nullable=True)
    source = Column(String(24))  # "extension", "backend", "gemini"
    timer_mutations = Column(JSONB)
    network_api_found = Column(Boolean)
    confidence_score = Column(Float)
```

**Retention**: Rolling 7-day window (delete records older than 7 days via cron job)

**Key Query**
```python
def check_historical_pattern(domain: str, message_hash: str, days: int = 7):
    cutoff = datetime.utcnow() - timedelta(days=days)
    records = session.query(UrgencyRecord).filter(
        UrgencyRecord.domain == domain,
        UrgencyRecord.message_hash == message_hash,
        UrgencyRecord.timestamp >= cutoff
    ).all()
    return {
        'count': len(records),
        'days_span': (records[-1].timestamp - records[0].timestamp).days if len(records) > 1 else 0,
        'all_fake': all(r.is_fake for r in records) if records else None
    }
```

### 3.5 NLP Enhancement (`backend/main.py`)

**Urgency Classification Prompt**
```
You are a Digital Forensic Auditor analyzing urgency messages.

Classify each message:
1. VAGUE (likely fake): Generic pressure tactics
   - "High demand!", "7 people viewing", "Hot deal!"
   - No specific time or quantity
   
2. SPECIFIC_DATE (likely real): Real countdown with end date
   - "Sale ends April 26th 11:59 PM"
   - Has verifiable timestamp
   
3. NUMERIC (verify): Stock quantity claims
   - "Only 3 left in stock"
   - Needs inventory API verification

Return JSON:
{
  "urgency_type": "vague" | "specific_date" | "numeric_unverifiable",
  "authenticity": "fake" | "likely_real" | "uncertain",
  "reason": "explanation",
  "suggested_severity": "HIGH" | "MEDIUM" | "LOW" | "EXEMPT"
}
```

---

## Platform-Specific Handling

### Strict Platforms
| Platform | Confidence Floor | Multi-Method Required |
|----------|------------------|----------------------|
| amazon.in | 0.75 | Yes |
| flipkart.com | 0.75 | Yes |
| zepto.in | 0.75 | Yes |
| blinkit.com | 0.75 | Yes |

### Detection Method
- Domain matching (simple string check)
- Stricter thresholds applied
- Require 2+ independent detection methods to flag

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `extension/utils/network-analyzer.js` | Network interception for inventory API detection |

### Modified Files
| File | Changes |
|------|---------|
| `extension/content.js` | Confidence floor, pattern exclusions, timer tracking, mutation observer |
| `extension/popup.js` | Debug mode toggle, filtered pattern display |
| `extension/background.js` | Timer state management, backend relay |
| `backend/main.py` | urgency_type classification, /analyze-urgency-authenticity endpoint, urgency analysis pipeline |
| `backend/database.py` | urgency_records table, historical query, retention logic |

### External
| Component | Setup |
|-----------|-------|
| Cron job | `0 0 * * *` → Run cleanup query daily |

---

## Implementation Order

| # | Task | Files | Est. Time |
|---|------|-------|-----------|
| 1 | Add confidence floor + pattern exclusions | `content.js` | 2-3 hrs |
| 2 | Add platform whitelist with strict thresholds | `content.js` | 1 hr |
| 3 | Build NetworkAnalyzer utility | `utils/network-analyzer.js` | 2 hrs |
| 4 | Implement timer state tracking + mutation detection | `content.js`, `background.js` | 3-4 hrs |
| 5 | Add platform whitelist for popup display | `popup.js` | 1 hr |
| 6 | Add urgency_type sub-classification | `main.py` | 1 hr |
| 7 | Create /analyze-urgency-authenticity endpoint | `main.py` | 2-3 hrs |
| 8 | Add urgency_records table + queries | `database.py` | 2 hrs |
| 9 | Set up cron cleanup job | External | 30 min |
| 10 | Integration testing + refinement | All | Ongoing |

**Total Estimated: ~16-18 hours**

---

## Data Flow

```
┌─ content.js ──────────────────────────────────────────┐
│ • Detect urgency patterns                              │
│ • Timer state tracking (product-scoped)                │
│ • Mutation observer (reset/jump/round numbers)         │
│ • NetworkAnalyzer (inventory API boolean)              │
│ • Confidence floor filtering                           │
│ • Pattern-specific exclusions                          │
└─────────────────────┬───────────────────────────────────┘
                      │ Send to backend
                      ↓
┌─ background.js ───────────────────────────────────────┐
│ • Relay to FastAPI backend                             │
│ • Store timer state in chrome.storage.local            │
│ • Fallback: if backend unreachable, downgrade         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ↓
┌─ backend (FastAPI) ────────────────────────────────────┐
│ POST /analyze-urgency-authenticity                     │
│ ├── Check urgency_records (7-day historical)          │
│ ├── NLP classification (Gemini)                       │
│ ├── Script analysis (Math.random detection)           │
│ ├── Network verification                               │
│ └── Return: authenticity + severity adjustment         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ↓
┌─ database (PostgreSQL) ────────────────────────────────┐
│ urgency_records table                                  │
│ ├── Domain, message, message_hash                     │
│ ├── product_id (URL path hash)                        │
│ ├── timer_mutations (JSONB)                           │
│ ├── network_api_found                                 │
│ └── Retention: 7-day rolling window                   │
└────────────────────────────────────────────────────────┘
```

---

## Decisions Log

| # | Decision | Selected Option | Rationale |
|---|----------|-----------------|-----------|
| 1 | Timer tracking scope | Product-scoped | Domain-scoped breaks with multiple product tabs |
| 2 | Network analysis detail | Basic boolean | Full parsing is maintenance nightmare |
| 3 | Debug logging retention | 7 days | 24hrs too short, indefinite too bloated |
| 4 | Platform detection | Domain matching | Visual DOM cues break on UI updates |
| 5 | Cleanup job frequency | Every 24hrs via cron | Startup-based cleanup risky for frequent restarts |
| 6 | Script snippet capture | Suspicious only | All scripts = massive payloads |
| 7 | Fallback behavior | Fail silently (downgrade) | Zero false positives is prime directive |
| 8 | Main priority | Precision over recall | Better to miss than false positive |
| 9 | Scope | Phase 1 + Phase 3 only | Skip Phase 2 for now |
| 10 | Platform handling | Both stricter thresholds + platform-specific rules | Hybrid approach |

---

## Key Design Principles

1. **Precision over recall** - Better to miss a dark pattern than flag legitimate UI
2. **Product-scoped tracking** - Timer state isolated per product (URL path hash)
3. **Fail closed** - If backend unreachable, downgrade confidence below threshold
4. **7-day rolling window** - Enough data for analysis without bloating database
5. **Suspicious script capture only** - Minimize payload sizes
6. **Hybrid approach** - Both stricter thresholds AND platform-specific rules
7. **Cron-based cleanup** - Reliable retention management independent of API restarts

---

## Testing Checklist

- [ ] Verify urgency patterns with confidence >= 0.6 are shown
- [ ] Verify urgency patterns with confidence < 0.6 are logged (not shown)
- [ ] Verify "sale", "promotion" keywords are excluded from urgency
- [ ] Verify preselected insurance/gift wrap checkboxes are excluded
- [ ] Verify terms/cookie/age popups are excluded from nagging
- [ ] Verify educational pages about dark patterns are not flagged
- [ ] Test timer mutation detection (reset, round numbers)
- [ ] Test product-scoped tracking across multiple tabs
- [ ] Test network analyzer detects inventory APIs
- [ ] Test backend endpoint returns authenticity scores
- [ ] Verify platform strict thresholds on amazon.in/flipkart.com
- [ ] Test debug mode toggle in popup
- [ ] Verify fallback behavior when backend is unreachable
- [ ] Test 7-day retention cron job

---

## Appendix: Urgency Type Classification

| Type | Example | Severity | Notes |
|------|---------|----------|-------|
| VAGUE | "High demand!", "7 people viewing" | HIGH | Likely fake - generic pressure |
| SPECIFIC_DATE | "Sale ends April 26th 11:59 PM" | MEDIUM | Likely real - verifiable time |
| NUMERIC | "Only 3 left in stock" | LOW + Badge | Needs inventory API verification |
| VERIFIED_GENUINE | Confirmed real inventory API | EXEMPT | No flag |

## Appendix: Mutation Classification

| Mutation Type | Indicator | Classification |
|--------------|-----------|----------------|
| Reset forward | Timer value increases on reload | FAKE |
| Round number stuck | Timer stops at 05, 10, 30, etc. | LIKELY FAKE |
| Normal countdown | Timer decreases normally to 0 | GENUINE |
| Specific date | Has real end date visible | LIKELY GENUINE |