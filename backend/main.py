"""
ConsumerShield — FastAPI Backend
Provides: AI-enhanced analysis, regulatory mapping, dual risk scoring
Endpoints:
  POST /analyze-complete       → full analysis (privacy + manipulation)
  POST /analyze-privacy        → privacy-only
  POST /analyze-dark-patterns  → manipulation-only
  GET  /health
"""

import os
import asyncio
import threading
import json
import base64
import math
import logging
import re
import time
import uuid
import ipaddress
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
import json
from sqlalchemy.orm import Session

from regulatory_database import (
    get_privacy_violations,
    get_manipulation_violations,
    REGULATORY_FRAMEWORK,
)
from database import (
    ReportRecord,
    SessionLocal,
    init_db,
    get_db,
    clear_reports_table,
    build_canonical_payload,
    canonical_payload_to_json,
    encode_pattern_names,
    decode_pattern_names,
    encode_detected_patterns,
    decode_detected_patterns,
)
from ethereum_anchor import (
    store_report_hash_on_chain,
    build_report_sha256,
    build_report_keccak,
    store_precomputed_hash_on_chain,
    inspect_transaction_state,
    verify_report_hash_on_chain,
    DuplicateReportAnchoringError,
)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(BACKEND_DIR)
load_dotenv(os.path.join(BACKEND_DIR, ".env"))
load_dotenv(os.path.join(REPO_DIR, ".env"))
load_dotenv()

# ── Gemini API setup (new google.genai SDK) ──────────────────
try:
    from google import genai as _genai_sdk
    from google.genai import types as _genai_types
except Exception:
    _genai_sdk = None
    _genai_types = None

# Digital Forensic Auditor persona — used as Gemini system instruction
FORENSIC_AUDITOR_SYSTEM_INSTRUCTION = (
    "You are a Digital Forensic Auditor specializing in the DPDP Act 2023 "
    "and CCPA Dark Pattern Guidelines 2023.\n"
    "Identify Tier 3 Dark Patterns that require psychological reasoning:\n"
    "- Confirmshaming: asymmetric language that shames the user for a 'No' choice "
    "(e.g. 'No, I'd rather pay full price').\n"
    "- Visual Interference: Accept button uses high-contrast colours; Reject is "
    "intentionally low-contrast or hidden.\n"
    "- False Hierarchy: Opt-out settings are buried behind 3+ more clicks than the opt-in path.\n"
    "- Trick Wording: double negatives used to confuse consent "
    "(e.g. 'Uncheck to not receive…').\n"
    "ALWAYS respond with valid JSON only — no markdown fences, no prose outside the JSON."
)

GEMINI_AVAILABLE = False
GEMINI_MODEL_NAME: str = os.getenv("GEMINI_PRIMARY_MODEL", "gemini-flash-lite-latest")
_gemini_client = None    # google.genai Client instance

# Ordered preference — first that succeeds at runtime wins
MODELS_TO_TRY = [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
]


def _load_model_candidates_from_env(defaults: List[str]) -> List[str]:
    """Allow runtime model overrides via GEMINI_MODELS_TO_TRY without code edits."""
    raw = os.getenv("GEMINI_MODELS_TO_TRY", "")
    if not raw.strip():
        return defaults

    parsed = [entry.strip() for entry in raw.split(",") if entry.strip()]
    return parsed or defaults


_GEMINI_MODEL_CANDIDATES = _load_model_candidates_from_env(MODELS_TO_TRY)
_GEMINI_MODEL_COOLDOWN_UNTIL: Dict[str, float] = {}
_GEMINI_GLOBAL_COOLDOWN_UNTIL: float = 0.0

DARK_PATTERN_THRESHOLD = 7.0
logger = logging.getLogger("consumershield.anchor")


def _configured_contract_address() -> Optional[str]:
    for env_name in ("CONTRACT_ADDRESS", "EVIDENCE_REGISTRY_CONTRACT_ADDRESS"):
        value = os.getenv(env_name)
        if value and value.strip():
            return value.strip()
    return None


def _extract_retry_seconds_from_error(error_text: str) -> Optional[int]:
    if not error_text:
        return None

    # Handles formats like "Please retry in 24.79s" or "retryDelay': '24s'".
    match = re.search(r"retry\s*(?:in|delay)\s*[:=]?\s*'?([0-9]+(?:\.[0-9]+)?)s", error_text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return max(1, int(math.ceil(float(match.group(1)))))
    except (TypeError, ValueError):
        return None

try:
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key and _genai_sdk is not None:
        _gemini_client = _genai_sdk.Client(api_key=gemini_key)
        GEMINI_AVAILABLE = True
        print(f"[ConsumerShield] Gemini enabled ({GEMINI_MODEL_NAME})")
    elif gemini_key and _genai_sdk is None:
        print("[ConsumerShield] GEMINI_API_KEY set but google.genai SDK not installed — using rule-based insights")
    else:
        print("[ConsumerShield] No GEMINI_API_KEY found — using rule-based insights")
except Exception as e:
    print(f"[ConsumerShield] Gemini error: {e}")

# ── Local BERT model for dark pattern classification ──────────
LOCAL_NLP_AVAILABLE = False
try:
    from transformers import pipeline as hf_pipeline

    print("[ConsumerShield] Loading local BERT model...")
    # Using a lightweight model fine-tuned specifically for dark patterns
    nlp_classifier = hf_pipeline("text-classification", model="aditizingre07/distilroberta-dark-pattern")
    LOCAL_NLP_AVAILABLE = True
    print("[ConsumerShield] Local BERT loaded successfully!")
except Exception as e:
    print(f"[ConsumerShield] Failed to load BERT: {e}")

# ── Tracker Radar + heuristic intelligence ───────────────────
TRACKING_KEYWORDS = (
    "ads",
    "pixel",
    "analytics",
    "metrics",
    "track",
    "telemetry",
    "tagmanager",
    "doubleclick",
    "adservice",
    "remarketing",
    "insight",
    "beacon",
    "criteo",
    "taboola",
    "outbrain",
    "clevertap",
    "webengage",
    "moengage",
)
CDN_KEYWORDS = ("cdn", "static", "assets", "cloudfront", "akamai", "fastly", "jsdelivr", "gstatic")

RADAR_DOMAIN_MAP: Dict[str, Dict[str, Any]] = {}
RADAR_SOURCE_PATH: Optional[str] = None
RADAR_LOAD_ERROR: Optional[str] = None


def normalize_domain(domain: str) -> str:
    if not domain:
        return ""
    cleaned = domain.strip().lower()
    if "://" in cleaned:
        cleaned = cleaned.split("://", 1)[1]
    cleaned = cleaned.split("/", 1)[0]
    cleaned = cleaned.split(":", 1)[0]
    return cleaned.strip(".")


def walk_subdomains(domain: str) -> List[str]:
    """Walk from full host to parent domain, e.g. a.b.c.com -> [a.b.c.com, b.c.com, c.com]."""
    normalized = normalize_domain(domain)
    if not normalized:
        return []
    parts = normalized.split(".")
    if len(parts) == 1:
        return [normalized]
    return [".".join(parts[idx:]) for idx in range(0, len(parts) - 1)]


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_entity_name(record: Dict[str, Any]) -> str:
    owner = record.get("owner")
    if isinstance(owner, dict):
        for key in ("displayName", "name", "organization"):
            value = owner.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    elif isinstance(owner, str) and owner.strip():
        return owner.strip()

    for key in ("entity", "company", "organization", "org", "ownerName"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return "Unknown Entity"


def _extract_categories(record: Dict[str, Any]) -> List[str]:
    for key in ("categories", "tags", "types"):
        value = record.get(key)
        if isinstance(value, list):
            return [str(item) for item in value if item is not None]
        if isinstance(value, str) and value:
            return [value]
    record_type = record.get("type")
    if isinstance(record_type, str) and record_type:
        return [record_type]
    return []


def _iter_radar_records(raw_data: Any):
    if isinstance(raw_data, list):
        for item in raw_data:
            if isinstance(item, dict):
                yield item
        return

    if not isinstance(raw_data, dict):
        return

    domains_field = raw_data.get("domains")
    if isinstance(domains_field, dict):
        for domain, info in domains_field.items():
            if isinstance(info, dict):
                merged = dict(info)
                merged.setdefault("domain", domain)
                yield merged
        return
    if isinstance(domains_field, list):
        for item in domains_field:
            if isinstance(item, dict):
                yield item
        return

    # Fallback: assume top-level mapping of domain -> record
    for domain, info in raw_data.items():
        if isinstance(info, dict):
            merged = dict(info)
            merged.setdefault("domain", domain)
            yield merged


def _candidate_radar_paths() -> List[str]:
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    repo_dir = os.path.dirname(backend_dir)
    configured = os.getenv("RADAR_LITE_PATH", "").strip()
    candidates = [
        configured,
        os.path.join(backend_dir, "radar_lite.json"),
        os.path.join(repo_dir, "radar_lite.json"),
        os.path.join(os.getcwd(), "radar_lite.json"),
    ]

    seen = set()
    deduped = []
    for path in candidates:
        if path and path not in seen:
            seen.add(path)
            deduped.append(path)
    return deduped


def load_radar_lite() -> None:
    global RADAR_DOMAIN_MAP, RADAR_SOURCE_PATH, RADAR_LOAD_ERROR

    RADAR_DOMAIN_MAP = {}
    RADAR_SOURCE_PATH = None
    RADAR_LOAD_ERROR = None

    for path in _candidate_radar_paths():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw_data = json.load(handle)

            domain_map: Dict[str, Dict[str, Any]] = {}
            for record in _iter_radar_records(raw_data):
                record_domain = normalize_domain(str(record.get("domain", "")))
                if not record_domain:
                    continue
                domain_map[record_domain] = {
                    "domain": record_domain,
                    "entity": _extract_entity_name(record),
                    "prevalence": _to_float(record.get("prevalence")),
                    "categories": _extract_categories(record),
                }

            RADAR_DOMAIN_MAP = domain_map
            RADAR_SOURCE_PATH = path
            print(f"[ConsumerShield] Loaded radar_lite.json with {len(domain_map)} domains from {path}")
            return
        except Exception as exc:
            RADAR_LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            print(f"[ConsumerShield] Failed to load radar_lite.json from {path}: {RADAR_LOAD_ERROR}")
            return

    RADAR_LOAD_ERROR = "radar_lite.json not found"
    print("[ConsumerShield] radar_lite.json not found; using heuristic-only domain intelligence")


def resolve_radar_entity(domain: str) -> Optional[Dict[str, Any]]:
    """Tier 1: exact/subdomain-walk lookup in Tracker Radar map."""
    for candidate in walk_subdomains(domain):
        found = RADAR_DOMAIN_MAP.get(candidate)
        if found:
            return {
                **found,
                "matched_domain": candidate,
                "input_domain": normalize_domain(domain),
            }
    return None


def _has_tracking_keywords(domain: str) -> List[str]:
    lowered = normalize_domain(domain)
    return [keyword for keyword in TRACKING_KEYWORDS if keyword in lowered]


def _is_ip_domain(domain: str) -> bool:
    try:
        ipaddress.ip_address(normalize_domain(domain))
        return True
    except ValueError:
        return False


def _shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts: Dict[str, int] = {}
    for ch in value:
        counts[ch] = counts.get(ch, 0) + 1
    entropy = 0.0
    total = len(value)
    for count in counts.values():
        probability = count / total
        entropy -= probability * math.log2(probability)
    return entropy


def _has_suspicious_entropy(domain: str) -> bool:
    normalized = normalize_domain(domain)
    labels = [label for label in normalized.split(".") if label]
    if not labels:
        return False

    longest = max(labels, key=len)
    if len(longest) < 14:
        return False

    entropy = _shannon_entropy(longest)
    has_letters = bool(re.search(r"[a-z]", longest))
    has_digits = bool(re.search(r"\d", longest))
    return entropy >= 3.5 and (has_letters and has_digits)


def _is_standard_cdn(domain: str) -> bool:
    lowered = normalize_domain(domain)
    return any(keyword in lowered for keyword in CDN_KEYWORDS)


def predict_tracker_score(domain: str, radar_match: Optional[Dict[str, Any]], reasons: List[str]) -> float:
    """Tier 3: risk scoring from 1-10 based on known prevalence and heuristics."""
    if radar_match:
        prevalence = radar_match.get("prevalence")
        if isinstance(prevalence, (int, float)):
            if prevalence >= 0.05:
                return 10.0
            if prevalence >= 0.02:
                return 9.0
            if prevalence >= 0.005:
                return 8.0
        categories = [str(cat).lower() for cat in radar_match.get("categories", [])]
        if any(cat in {"advertising", "analytics", "tracker", "fingerprinting"} for cat in categories):
            return 8.0
        return 7.0

    if any(reason.startswith("keyword:") for reason in reasons):
        return 6.5
    if "ip-domain" in reasons or "suspicious-entropy" in reasons:
        return 6.0
    if _is_standard_cdn(domain):
        return 2.5
    return 4.0


load_radar_lite()

@asynccontextmanager
async def app_lifespan(_: FastAPI):
    init_db()
    yield


# ── App ───────────────────────────────────────────────────────
app = FastAPI(
    title="ConsumerShield API",
    description="Complete consumer protection analysis — privacy + dark patterns",
    version="1.0.0",
    lifespan=app_lifespan,
)

# Load Tracker Radar
radar_file = os.path.join(os.path.dirname(__file__), 'radar_lite.json')
radar_lookup = {}
if os.path.exists(radar_file):
    with open(radar_file, 'r') as f:
        radar_lookup = json.load(f)
    print(f"[ConsumerShield] Loaded {len(radar_lookup)} tracker definitions from Radar Lite")
else:
    print("[ConsumerShield] Warning: radar_lite.json not found. Run radar_lite.py first.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────────

class TrackerItem(BaseModel):
    domain: str
    type: str
    name: str

class PolicyData(BaseModel):
    thirdPartySharing: Optional[bool] = False
    noOptOut: Optional[bool] = False
    extensiveCollection: Optional[bool] = False
    hasOptOut: Optional[bool] = False

class PrivacyData(BaseModel):
    trackers: List[TrackerItem] = []
    policy: Optional[PolicyData] = PolicyData()
    fingerprinting: Optional[bool] = False

class PatternItem(BaseModel):
    type: str
    name: str
    severity: str       # low | medium | high
    confidence: float = 1.0
    law: Optional[str] = None
    penalty: Optional[str] = None
    description: Optional[str] = None
    text: Optional[str] = None

class ManipulationData(BaseModel):
    patterns: List[PatternItem] = []

class CompleteRequest(BaseModel):
    url: str
    privacy_data: PrivacyData
    manipulation_data: ManipulationData
    screenshot_data_url: Optional[str] = None
    dom_text: Optional[str] = None
    aria_text: Optional[str] = None


class AnchorRequest(BaseModel):
    url: str
    summary: str

class PrivacyOnlyRequest(BaseModel):
    url: str
    privacy_data: PrivacyData

class ManipulationOnlyRequest(BaseModel):
    url: str
    manipulation_data: ManipulationData

class RegulatoryViolation(BaseModel):
    violation_type: str
    issue: str
    law: str
    section: str
    penalty: str
    authority: str

class CompleteResponse(BaseModel):
    url: str
    privacy_risk: float
    manipulation_risk: float
    overall_risk: float
    privacy_level: str
    manipulation_level: str
    overall_level: str
    total_violations: int
    privacy_insights: List[str]
    manipulation_insights: List[str]
    combined_insight: str
    regulatory_violations: List[Dict[str, str]]
    ai_powered: bool
    ai_details: Optional[Dict[str, Any]] = None  # Includes gemini/bert details and forensic findings


class AnalyzeDomainsRequest(BaseModel):
    domains: List[str]
    first_party_domain: Optional[str] = None


class AnalyzeDomainsResponse(BaseModel):
    resolved_trackers: List[Dict[str, Any]]
    suspicious_domains: List[Dict[str, Any]]
    total_privacy_score: float


class SaveReportRequest(BaseModel):
    url: str
    domain: Optional[str] = None
    privacy_risk: float
    manipulation_risk: float
    overall_risk: float
    pattern_names: List[str] = []
    tracker_count: int = 0
    combined_insight: Optional[str] = None
    anchor_on_save: bool = True


class StoredReportResponse(BaseModel):
    report_id: str
    url: str
    domain: str
    risk_score: float
    detected_patterns: List[str]
    details: Optional[str] = None
    timestamp: str
    blockchain_proof: bool
    blockchain_tx_hash: Optional[str] = None
    report_hash: str
    canonical_payload_json: str
    tx_hash: Optional[str] = None
    anchor_status: str
    anchor_error: Optional[str] = None
    verification_status: str
    verification_error: Optional[str] = None
    privacy_risk: float
    manipulation_risk: float
    overall_risk: float
    pattern_count: int
    tracker_count: int
    pattern_names: List[str]
    combined_insight: Optional[str] = None
    created_at: str


class TriggerAnchorResponse(BaseModel):
    report_id: str
    anchor_status: str
    tx_hash: Optional[str] = None
    detail: str


class RetryAnchorsResponse(BaseModel):
    queued: int
    scanned: int
    report_ids: List[str]


class VerifyReportResponse(BaseModel):
    report_id: str
    status: str
    verified: bool
    db_hash_matches: bool
    expected_hash: str
    recomputed_hash: str
    on_chain_hash: Optional[str] = None
    tx_hash: Optional[str] = None
    error: Optional[str] = None


class WallOfShameItem(BaseModel):
    url: str
    risk_score: float
    detected_patterns: List[str]
    timestamp: str
    blockchain_proof: bool
    blockchain_tx_hash: Optional[str] = None
    contract_address: Optional[str] = None

# ── Risk Calculators ──────────────────────────────────────────

def calc_privacy_risk(data: PrivacyData) -> float:
    score = 0.0
    tc = len(data.trackers)
    if   tc >= 10: score += 4.0
    elif tc >= 6:  score += 3.0
    elif tc >= 3:  score += 2.0
    elif tc >= 1:  score += 1.0

    if data.policy:
        if data.policy.thirdPartySharing:  score += 1.5
        if data.policy.noOptOut:           score += 1.5
        if data.policy.extensiveCollection:score += 1.0
    if data.fingerprinting:                score += 2.0

    return min(10.0, round(score, 1))

def calc_manipulation_risk(data: ManipulationData) -> float:
    weights = {"low": 0.8, "medium": 2.0, "high": 4.0}
    score = sum(weights.get(p.severity, 0.8) * p.confidence for p in data.patterns)
    return min(10.0, round(score, 1))

def get_risk_level(score: float) -> str:
    if score >= 8.5: return "CRITICAL"
    if score >= 6.5: return "HIGH"
    if score >= 4.0: return "MEDIUM"
    if score >= 2.0: return "LOW"
    return "SAFE"

# ── Insight Generators ────────────────────────────────────────

def make_privacy_insights(data: PrivacyData) -> List[str]:
    insights = []
    tc = len(data.trackers)
    if tc > 0:
        types = list({t.type for t in data.trackers})
        insights.append(f"{tc} tracker(s) detected ({', '.join(types)}). Your browsing behavior is being monitored.")
    if data.policy and data.policy.thirdPartySharing:
        insights.append("Your data is shared with third parties. Potential DPDP Act 2023 Section 8 violation.")
    if data.policy and data.policy.noOptOut:
        insights.append("No opt-out mechanism found. Violates DPDP Act 2023 Section 12 (right to withdraw consent).")
    if data.fingerprinting:
        insights.append("Canvas/device fingerprinting detected. Unauthorized unique ID generation.")
    if not insights:
        insights.append("No significant privacy violations detected on this page.")
    return insights

def make_manipulation_insights(data: ManipulationData) -> List[str]:
    insights = []
    for p in data.patterns:
        insights.append(f"{p.name} [{p.severity.upper()}]: {p.description or 'Manipulation tactic detected.'}")
    if not insights:
        insights.append("No dark patterns detected on this page.")
    return insights

def make_rule_insight(url: str, privacy: PrivacyData, manipulation: ManipulationData,
                      p_risk: float, m_risk: float) -> str:
    tc = len(privacy.trackers)
    pc = len(manipulation.patterns)

    if p_risk >= 7 and m_risk >= 7:
        return (
            f"This site aggressively exploits you on BOTH fronts — {tc} tracker(s) stealing "
            f"your data and {pc} manipulation tactic(s) pressuring your decisions. "
            f"It likely violates the DPDP Act 2023 (up to ₹250 crore penalty) and "
            f"CCPA Dark Patterns Guidelines 2023 (up to ₹50 lakh per tactic)."
        )
    if p_risk >= 6.5:
        return (
            f"This site invades your privacy with {tc} tracker(s) and appears to share your "
            f"data with third parties without clear consent — a potential violation of the "
            f"Digital Personal Data Protection Act 2023."
        )
    if m_risk >= 6.5:
        return (
            f"{pc} dark pattern(s) detected — psychological manipulation designed to pressure "
            f"your purchasing decisions. Prohibited under CCPA Dark Patterns Guidelines 2023."
        )
    if tc > 0 or pc > 0:
        return f"Moderate concerns: {tc} tracker(s) and {pc} dark pattern(s) found. Review the details below."
    return "No major privacy violations or dark patterns detected on this page. ✅"


def _to_tier3_severity(raw: Optional[str]) -> str:
    normalized = str(raw or "").strip().lower()
    if normalized in {"critical", "very_high", "high"}:
        return "HIGH"
    if normalized in {"medium", "med", "moderate"}:
        return "MEDIUM"
    if normalized in {"low", "minor"}:
        return "LOW"
    return "MEDIUM"


def make_tier3_rule_fallback(manipulation: ManipulationData) -> List[Dict[str, str]]:
    """Deterministic Tier 3 detection when Gemini is unavailable or rate-limited."""
    findings: Dict[str, Dict[str, str]] = {}
    severity_order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}

    def clean_evidence(raw: str, cue_regex: str, fallback: str) -> str:
        text = re.sub(r"\s+", " ", str(raw or "")).strip()
        if not text:
            return fallback
        if len(text) > 220:
            text = text[:220]
        if len(text) > 140 and not re.search(cue_regex, text.lower()):
            return fallback
        return text

    def add_finding(
        pattern_name: str,
        severity: str,
        evidence_text: str,
        visual_proof: str,
        legal_violation: str,
    ) -> None:
        sev = _to_tier3_severity(severity)
        candidate = {
            "pattern_name": pattern_name,
            "severity": sev,
            "evidence_text": (evidence_text or "").strip()[:220],
            "visual_proof": (visual_proof or "").strip()[:240],
            "legal_violation": legal_violation,
        }
        existing = findings.get(pattern_name)
        if not existing:
            findings[pattern_name] = candidate
            return
        if severity_order.get(sev, 0) > severity_order.get(existing.get("severity", "LOW"), 0):
            findings[pattern_name] = candidate

    for p in manipulation.patterns:
        combined_text = " ".join([
            str(p.type or ""),
            str(p.name or ""),
            str(p.description or ""),
            str(p.text or ""),
        ]).strip()
        low = combined_text.lower()
        evidence = (p.text or p.description or p.name or "No direct evidence captured.").strip()

        if (
            "confirmsham" in low
            or re.search(r"\bno\b[^.]{0,80}\b(prefer|rather|enjoy|like)\b[^.]{0,60}\b(pay|miss|lose|overpay)", low)
            or re.search(r"no\s*thanks[^.]{0,70}\b(pay|overpay|miss)\b", low)
        ):
            add_finding(
                pattern_name="Confirmshaming",
                severity="high" if _to_tier3_severity(p.severity) == "HIGH" else "medium",
                evidence_text=clean_evidence(
                    evidence,
                    r"confirmsham|no\s*thanks|prefer\s*to\s*pay|rather\s*pay|pay\s*full\s*price|decline",
                    "Reject action appears framed with guilt-inducing wording.",
                ),
                visual_proof="The rejection path uses guilt-loaded wording compared to a neutral acceptance path.",
                legal_violation="DPDP Act 2023 Section 6 (Non-ambiguous Consent); CCPA Dark Patterns Guidelines 2023 (Confirmshaming)",
            )

        if (
            "trick question" in low
            or "double negative" in low
            or "trick wording" in low
            or re.search(r"\buncheck\b[^.]{0,60}\bnot\b", low)
            or re.search(r"\bdo\s*not\s*(uncheck|untick)\b", low)
            or re.search(r"\bopt\s*out\s*of\s*not\b", low)
        ):
            add_finding(
                pattern_name="Trick Wording",
                severity="high" if _to_tier3_severity(p.severity) == "HIGH" else "medium",
                evidence_text=clean_evidence(
                    evidence,
                    r"uncheck|untick|double\s*negative|do\s*not|opt\s*out|not\s*receive",
                    "Consent copy appears to use double-negative or inversion phrasing.",
                ),
                visual_proof="Consent copy contains a double negative that can invert the user’s intended choice.",
                legal_violation="DPDP Act 2023 Section 6 (Non-ambiguous Consent); CCPA Dark Patterns Guidelines 2023 (Trick Questions)",
            )

        if (
            "visual interference" in low
            or "accept-vs-reject visual weight ratio" in low
            or "reject appears weak/hidden" in low
            or re.search(r"\b(high\s*contrast|highlight(ed)?\s*accept|bright\s*accept)\b", low)
            or re.search(r"\b(low\s*contrast|grey(ed)?\s*out|faded|hidden\s*reject|small\s*reject)\b", low)
        ):
            add_finding(
                pattern_name="Visual Interference",
                severity="high",
                evidence_text=clean_evidence(
                    evidence,
                    r"visual\s*interference|accept-vs-reject|low\s*contrast|hidden\s*reject|weak/hidden",
                    "Accept action appears visually emphasized over reject action.",
                ),
                visual_proof="The 'Accept' action appears visually dominant while 'Reject' appears muted, low-contrast, or hidden.",
                legal_violation="DPDP Act 2023 Section 6 (Free, specific, informed consent); CCPA Dark Patterns Guidelines 2023 (Misdirection)",
            )

        if (
            "obstruction" in low
            or "roach motel" in low
            or "false hierarchy" in low
            or re.search(r"\b(3|three|4|four)\s*(more\s*)?click", low)
            or re.search(r"\b(buried|deep\s*menu|hard\s*to\s*find\s*opt[- ]?out)\b", low)
        ):
            add_finding(
                pattern_name="False Hierarchy",
                severity="high" if _to_tier3_severity(p.severity) == "HIGH" else "medium",
                evidence_text=clean_evidence(
                    evidence,
                    r"false\s*hierarchy|3\s*click|three\s*click|buried|deep\s*menu|hard\s*to\s*find",
                    "Opt-out path appears to require extra navigation compared to opt-in.",
                ),
                visual_proof="The opt-out path appears buried behind extra navigation steps compared to the opt-in path.",
                legal_violation="DPDP Act 2023 Section 12 (Right to withdraw consent); CCPA Dark Patterns Guidelines 2023 (Obstruction)",
            )

    return list(findings.values())


def _decode_image_data_url(data_url: Optional[str]) -> Optional[Dict[str, Any]]:
    """Decode `data:image/...;base64,...` payload into bytes for Gemini media input."""
    if not data_url or not isinstance(data_url, str):
        return None

    raw = data_url.strip()
    if not raw:
        return None

    mime_type = "image/png"
    base64_str = raw

    # Strip the JS data URL prefix if it exists.
    if raw.lower().startswith("data:image/"):
        if "," in raw:
            header, base64_str = raw.split(",", 1)
        else:
            header = ""
            base64_str = raw

        if header.startswith("data:") and ";" in header:
            inferred_mime = header[5:].split(";", 1)[0].strip().lower()
            if inferred_mime:
                mime_type = inferred_mime

    try:
        decoded = base64.b64decode(base64_str)
        if not decoded:
            return None
        return {
            "mime_type": mime_type,
            "bytes": decoded,
        }
    except Exception as exc:
        print(f"[ConsumerShield] Failed to decode screenshot payload: {exc}")
        return None


HIGH_SIGNAL_TERMS = (
    "accept",
    "reject",
    "decline",
    "allow",
    "cookie",
    "consent",
    "no thanks",
    "manage",
    "settings",
    "opt out",
    "unsubscribe",
    "cancel",
    "uncheck",
    "untick",
    "double negative",
    "confirm",
    "agree",
    "necessary",
    "essential",
    "marketing",
    "newsletter",
)


def _compact_ws(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _extract_signal_snippets(raw_text: Optional[str], *, max_lines: int, max_chars: int) -> str:
    source = str(raw_text or "")
    if not source.strip():
        return "(unavailable)"

    candidates: List[str] = []

    for line in source.splitlines():
        clean = _compact_ws(line)
        if len(clean) >= 10:
            candidates.append(clean)

    if len(candidates) < max_lines:
        sentence_source = _compact_ws(source)
        for sentence in re.split(r"(?<=[.!?])\s+", sentence_source):
            clean = _compact_ws(sentence)
            if len(clean) >= 24:
                candidates.append(clean)
            if len(candidates) >= max_lines * 3:
                break

    prioritized: List[str] = []
    seen = set()
    for text in candidates:
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        if any(term in lowered for term in HIGH_SIGNAL_TERMS):
            prioritized.append(text[:240])

    if not prioritized:
        prioritized = [entry[:240] for entry in candidates[:max_lines]]

    clipped: List[str] = []
    total_chars = 0
    for entry in prioritized:
        if len(clipped) >= max_lines:
            break
        if total_chars + len(entry) > max_chars:
            break
        clipped.append(entry)
        total_chars += len(entry)

    return "\n".join(clipped) if clipped else "(unavailable)"


def _format_detector_findings(manipulation: ManipulationData) -> str:
    lines: List[str] = []
    for pattern in manipulation.patterns[:10]:
        detail = _compact_ws(pattern.text or pattern.description or "(no sample text)")[:220]
        lines.append(f"- [{str(pattern.severity or '').upper()}] {pattern.name}: {detail}")
    return "\n".join(lines) if lines else "- (none detected)"


def _normalize_tier3_patterns_from_json(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    tier3: List[Dict[str, Any]] = []

    raw_patterns = parsed.get("tier3_patterns")
    if isinstance(raw_patterns, list):
        for item in raw_patterns:
            if not isinstance(item, dict):
                continue

            normalized: Dict[str, Any] = {
                "pattern_name": _compact_ws(item.get("pattern_name") or item.get("pattern") or "Unknown"),
                "severity": _to_tier3_severity(item.get("severity")),
                "evidence_text": _compact_ws(item.get("evidence_text") or item.get("evidence") or ""),
                "visual_proof": _compact_ws(item.get("visual_proof") or item.get("visual_evidence") or ""),
                "legal_violation": _compact_ws(item.get("legal_violation") or "DPDP Act 2023 Section 6"),
            }

            confidence_raw = item.get("confidence")
            try:
                if confidence_raw is not None:
                    confidence = max(0.0, min(1.0, float(confidence_raw)))
                    normalized["confidence"] = round(confidence, 2)
            except (TypeError, ValueError):
                pass

            tier3.append(normalized)

    if not tier3 and "pattern_detected" in parsed:
        raw_detected = parsed.get("pattern_detected", False)
        detected = raw_detected if isinstance(raw_detected, bool) else str(raw_detected).strip().lower() in {"true", "1", "yes"}
        if detected:
            tier3.append({
                "pattern_name": _compact_ws(parsed.get("pattern_name") or "Unknown"),
                "severity": _to_tier3_severity(parsed.get("severity")),
                "evidence_text": _compact_ws(parsed.get("evidence") or ""),
                "visual_proof": _compact_ws(parsed.get("evidence") or ""),
                "legal_violation": _compact_ws(parsed.get("legal_violation") or "DPDP Act 2023 Section 6"),
            })

    return tier3
 
async def make_ai_insight(
    url: str,
    privacy: PrivacyData,
    manipulation: ManipulationData,
    screenshot_data_url: Optional[str] = None,
    dom_text: Optional[str] = None,
    aria_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run Gemini and BERT models simultaneously using asyncio.gather.
    Returns a dict with:
      - gemini_insight: str or None
      - bert_classification: dict with 'label' and 'confidence' or None
      - timestamp: ISO timestamp
      - combined_summary: human-readable summary
    """
    
    async def get_gemini_insight():
        """Forensic Auditor prompt → JSON with tier3_patterns + risk_summary."""
        global _GEMINI_GLOBAL_COOLDOWN_UNTIL

        if not GEMINI_AVAILABLE:
            return {
                "text": None,
                "tier3_patterns": [],
                "error": "Gemini API key is not configured. Using forensic fallback.",
            }

        now = time.time()
        if _GEMINI_GLOBAL_COOLDOWN_UNTIL > now:
            wait_seconds = int(math.ceil(_GEMINI_GLOBAL_COOLDOWN_UNTIL - now))
            return {
                "text": None,
                "tier3_patterns": [],
                "error": f"Cloud AI quota cooling down ({wait_seconds}s). Deterministic forensic fallback engaged.",
                "forensic_json": None,
            }

        pattern_context = _format_detector_findings(manipulation)
        dom_excerpt = _extract_signal_snippets(dom_text, max_lines=14, max_chars=3200)
        aria_excerpt = _extract_signal_snippets(aria_text, max_lines=16, max_chars=2000)

        prompt = (
            "You are auditing a website for Tier-3 dark patterns using screenshot + high-signal UX text.\n"
            f"URL: {url}\n"
            "Existing detector findings:\n"
            f"{pattern_context}\n\n"
            "High-signal DOM snippets:\n"
            f"{dom_excerpt}\n\n"
            "High-signal ARIA/button snippets:\n"
            f"{aria_excerpt}\n\n"
            "Return STRICT JSON with this exact shape:\n"
            "{\n"
            '  "risk_summary": "one concise sentence",\n'
            '  "tier3_patterns": [\n'
            "    {\n"
            '      "pattern_name": "Confirmshaming|Visual Interference|False Hierarchy|Trick Wording",\n'
            '      "severity": "HIGH|MEDIUM|LOW",\n'
            '      "evidence_text": "quoted or paraphrased evidence",\n'
            '      "visual_proof": "visual cue from screenshot if available, else empty string",\n'
            '      "legal_violation": "DPDP Act 2023 Section ...; CCPA 2023 ...",\n'
            '      "confidence": 0.0\n'
            "    }\n"
            "  ]\n"
            "}"
            "\nRules: max 4 patterns, avoid duplicates, no markdown fences, no prose outside JSON."
        )

        image_payload = _decode_image_data_url(screenshot_data_url)
        parts: List[Any] = [_genai_types.Part.from_text(text=prompt)]
        if image_payload:
            parts.append(
                _genai_types.Part.from_bytes(
                    data=image_payload["bytes"],
                    mime_type=image_payload["mime_type"],
                )
            )

        user_content = _genai_types.Content(role="user", parts=parts)
        gen_cfg = _genai_types.GenerateContentConfig(
            system_instruction=FORENSIC_AUDITOR_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            temperature=0.2,
        )

        candidate_models: List[str] = []
        for candidate in [GEMINI_MODEL_NAME, *_GEMINI_MODEL_CANDIDATES]:
            if candidate and candidate not in candidate_models:
                candidate_models.append(candidate)

        last_error: Optional[str] = None
        max_quota_retry_seconds = 0
        timeout_seconds = 10.0
        for model in candidate_models:
            now = time.time()
            model_cooldown_until = _GEMINI_MODEL_COOLDOWN_UNTIL.get(model, 0.0)
            if model_cooldown_until > now:
                wait_seconds = int(math.ceil(model_cooldown_until - now))
                print(f"[ConsumerShield] Skipping {model}; quota cooldown {wait_seconds}s remaining")
                continue

            try:
                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        _gemini_client.models.generate_content,
                        model=model,
                        contents=[user_content],
                        config=gen_cfg,
                    ),
                    timeout=timeout_seconds,
                )

                raw = getattr(response, "text", None)
                if not isinstance(raw, str) or not raw.strip():
                    try:
                        raw = response.candidates[0].content.parts[0].text
                    except Exception:
                        pass

                if not isinstance(raw, str) or not raw.strip():
                    last_error = "Gemini returned an empty response."
                    continue

                clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`").strip()
                try:
                    parsed = json.loads(clean)
                except json.JSONDecodeError as je:
                    print(f"[ConsumerShield] Gemini JSON parse error ({model}): {je} — raw: {raw[:200]}")
                    last_error = "Gemini returned non-JSON output."
                    continue

                if not isinstance(parsed, dict):
                    last_error = "Gemini returned an unsupported JSON shape."
                    continue

                tier3 = _normalize_tier3_patterns_from_json(parsed)
                summary = _compact_ws(
                    parsed.get("risk_summary")
                    or parsed.get("summary")
                    or parsed.get("evidence")
                    or ""
                )
                if not summary and tier3:
                    summary = f"{tier3[0].get('pattern_name', 'Dark pattern')} detected."

                _GEMINI_MODEL_COOLDOWN_UNTIL.pop(model, None)
                _GEMINI_GLOBAL_COOLDOWN_UNTIL = 0.0

                print(f"[ConsumerShield] Gemini OK ({model}) — {len(tier3)} Tier 3 pattern(s) found")
                return {
                    "text": summary or None,
                    "tier3_patterns": tier3,
                    "error": None,
                    "forensic_json": parsed,
                }

            except asyncio.TimeoutError:
                print(f"[ConsumerShield] Gemini timed out after {timeout_seconds}s on model {model}")
                last_error = "Gemini timed out. Deterministic forensic fallback engaged."
                continue
            except Exception as e:
                real_error = str(e)
                print(f"🚨 REAL GEMINI ERROR ({model}): {real_error}")

                retry_seconds = _extract_retry_seconds_from_error(real_error)

                if (
                    "429" in real_error
                    or "RESOURCE_EXHAUSTED" in real_error
                    or "limit: 0" in real_error
                ):
                    if retry_seconds:
                        _GEMINI_MODEL_COOLDOWN_UNTIL[model] = time.time() + retry_seconds
                        max_quota_retry_seconds = max(max_quota_retry_seconds, retry_seconds)
                    last_error = "Cloud AI unavailable (quota/model). Deterministic forensic fallback engaged."
                elif "404" in real_error or "NOT_FOUND" in real_error:
                    # If a model is not available to this key, cool it down for longer.
                    _GEMINI_MODEL_COOLDOWN_UNTIL[model] = time.time() + 3600
                    last_error = "Cloud AI unavailable (quota/model). Deterministic forensic fallback engaged."
                else:
                    last_error = "AI Error: Connection failed."
                continue

        if max_quota_retry_seconds > 0:
            _GEMINI_GLOBAL_COOLDOWN_UNTIL = max(_GEMINI_GLOBAL_COOLDOWN_UNTIL, time.time() + max_quota_retry_seconds)

        return {
            "text": None,
            "tier3_patterns": [],
            "error": last_error or "Gemini unavailable. Using forensic fallback output.",
            "forensic_json": None,
        }

    async def get_bert_classification():
        """Task to classify first dark pattern using local BERT"""
        if not LOCAL_NLP_AVAILABLE or not manipulation.patterns:
            return None
        try:
            sample_segments: List[str] = []
            for pattern in manipulation.patterns[:3]:
                if pattern.text:
                    sample_segments.append(pattern.text)
                elif pattern.description:
                    sample_segments.append(pattern.description)
                else:
                    sample_segments.append(pattern.name)

            sample_text = " ".join(sample_segments).strip()
            if not sample_text:
                sample_text = manipulation.patterns[0].name

            sample_text = sample_text[:400]
            bert_result = nlp_classifier(sample_text)
            return {
                "label": bert_result[0].get("label", "unknown"),
                "confidence": round(bert_result[0].get("score", 0.0) * 100, 1),
                "text_analyzed": sample_text
            }
        except Exception as e:
            print(f"[ConsumerShield] BERT error: {e}")
            return None

    # Run both models simultaneously
    gemini_result, bert_classification = await asyncio.gather(
        get_gemini_insight(),
        get_bert_classification(),
        return_exceptions=False
    )

    # Unpack Gemini dict result
    gemini_insight: Optional[str] = gemini_result.get("text")
    tier3_patterns: list = gemini_result.get("tier3_patterns", [])
    gemini_status: Optional[str] = gemini_result.get("error")
    forensic_json: Optional[Dict[str, Any]] = gemini_result.get("forensic_json")

    if not tier3_patterns:
        tier3_patterns = make_tier3_rule_fallback(manipulation)

    # Build user-facing summary.
    # Prefer Gemini risk_summary, fall back to rule-based when Gemini is unavailable.
    p_risk = calc_privacy_risk(privacy)
    m_risk = calc_manipulation_risk(manipulation)
    fallback_summary = make_rule_insight(url, privacy, manipulation, p_risk, m_risk)

    bert_note = None
    if bert_classification:
        raw_label = str(bert_classification.get("label", "unknown"))
        confidence = bert_classification.get("confidence", 0.0)
        if raw_label.lower() in {"not_dark_pattern", "not-dark-pattern"} and len(manipulation.patterns) > 0:
            bert_note = f"Local model confidence is inconclusive ({confidence}%)."
        else:
            bert_note = f"Local model signal: '{raw_label}' ({confidence}%)."

    if gemini_insight:
        combined_summary = gemini_insight
        if bert_note:
            combined_summary = f"{combined_summary} | {bert_note}"
    else:
        combined_summary = fallback_summary
        if gemini_status:
            combined_summary = f"{combined_summary} | {gemini_status}"
        if bert_note:
            combined_summary = f"{combined_summary} | {bert_note}"

    return {
        "gemini_insight": gemini_insight,
        "gemini_status": gemini_status,
        "bert_classification": bert_classification,
        "tier3_patterns": tier3_patterns,
        "forensic_json": forensic_json,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "combined_summary": combined_summary
    }


def _parse_canonical_payload_json(canonical_payload_json: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(canonical_payload_json or "{}")
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {"raw_payload": str(canonical_payload_json or "")}


def _normalize_detected_patterns(patterns: List[str]) -> List[str]:
    return sorted({str(item).strip() for item in patterns if str(item).strip()})


def _normalize_hash_value(hash_value: str) -> str:
    return str(hash_value or "").strip().lower().removeprefix("0x")


def _hash_matches_expected(expected_hash: str, payload: Dict[str, Any]) -> tuple[bool, str]:
    normalized_expected = _normalize_hash_value(expected_hash)
    if not normalized_expected:
        return False, ""

    recomputed_keccak = build_report_keccak(payload)
    recomputed_sha256 = build_report_sha256(payload)
    normalized_keccak = _normalize_hash_value(recomputed_keccak)
    normalized_sha256 = _normalize_hash_value(recomputed_sha256)

    if normalized_expected == normalized_keccak:
        return True, recomputed_keccak
    if normalized_expected == normalized_sha256:
        return True, recomputed_sha256

    return False, recomputed_keccak


async def _evaluate_report_verification(row: ReportRecord) -> Dict[str, Any]:
    expected_hash = str(row.report_hash or "").strip()
    canonical_payload = _parse_canonical_payload_json(row.canonical_payload)
    db_hash_matches, recomputed_hash = _hash_matches_expected(expected_hash, canonical_payload)

    if not row.tx_hash:
        if not db_hash_matches:
            status = "tampered"
            message = "Report content hash mismatch in database"
        elif row.anchor_status == "not_requested":
            status = "not_requested"
            message = "Ethereum anchoring was not requested for this report"
        elif row.anchor_status == "not_required":
            status = "not_required"
            message = "Risk score did not cross blockchain threshold"
        else:
            status = "pending"
            message = "No Ethereum transaction found yet"

        return {
            "report_id": row.report_id,
            "status": status,
            "verified": False,
            "db_hash_matches": db_hash_matches,
            "expected_hash": expected_hash,
            "recomputed_hash": recomputed_hash,
            "on_chain_hash": None,
            "tx_hash": None,
            "error": message,
        }

    chain_check = await asyncio.to_thread(verify_report_hash_on_chain, row.tx_hash, expected_hash)
    on_chain_hash = chain_check.get("on_chain_hash")
    chain_verified = bool(chain_check.get("verified"))
    verified = db_hash_matches and chain_verified

    if verified:
        status = "verified"
    elif chain_check.get("error"):
        status = "verification_error"
    else:
        status = "tampered"

    return {
        "report_id": row.report_id,
        "status": status,
        "verified": verified,
        "db_hash_matches": db_hash_matches,
        "expected_hash": expected_hash,
        "recomputed_hash": recomputed_hash,
        "on_chain_hash": on_chain_hash,
        "tx_hash": row.tx_hash,
        "error": chain_check.get("error"),
    }


def _persist_verification_result(db: Session, row: ReportRecord, verification: Dict[str, Any]) -> None:
    status = str(verification.get("status") or "not_verified")
    row.verification_status = status
    row.verification_error = verification.get("error")
    row.verified_at = datetime.utcnow() if status == "verified" else None
    db.commit()
    db.refresh(row)


def _run_verify_sync(row: ReportRecord) -> Dict[str, Any]:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_evaluate_report_verification(row))

    # If we're already inside an event loop, run verification in a worker thread
    # with its own loop to avoid nested-loop RuntimeError and coroutine warnings.
    result_box: Dict[str, Any] = {}
    error_box: Dict[str, Exception] = {}

    def _worker() -> None:
        try:
            result_box["value"] = asyncio.run(_evaluate_report_verification(row))
        except Exception as exc:
            error_box["error"] = exc

    worker = threading.Thread(target=_worker, daemon=True)
    worker.start()
    worker.join()

    if "error" in error_box:
        raise error_box["error"]

    return result_box["value"]


def _build_stable_report_payload(url: str, detected_patterns: List[str], details: str, risk_score: float) -> Dict[str, Any]:
    # Timestamp intentionally excluded to keep hash deterministic across retries.
    return {
        "url": str(url or "").strip(),
        "detected_patterns": _normalize_detected_patterns(detected_patterns),
        "details": str(details or "").strip(),
        "risk_score": round(float(risk_score or 0.0), 3),
    }


def _find_duplicate_report(
    db: Session,
    *,
    domain: str,
    report_hash: str,
    pattern_names_json: str,
    privacy_risk: float,
    manipulation_risk: float,
    overall_risk: float,
    tracker_count: int,
) -> Optional[ReportRecord]:
    normalized_domain = normalize_domain(domain)
    normalized_hash = str(report_hash or "").strip()
    tracker_count_val = int(tracker_count or 0)
    epsilon = 0.01

    if normalized_hash:
        exact = (
            db.query(ReportRecord)
            .filter(ReportRecord.report_hash == normalized_hash)
            .order_by(ReportRecord.id.desc())
            .first()
        )
        if exact:
            return exact

    return (
        db.query(ReportRecord)
        .filter(
            ReportRecord.domain == normalized_domain,
            ReportRecord.pattern_names_json == str(pattern_names_json or "[]"),
            ReportRecord.tracker_count == tracker_count_val,
            ReportRecord.privacy_risk.between(float(privacy_risk or 0.0) - epsilon, float(privacy_risk or 0.0) + epsilon),
            ReportRecord.manipulation_risk.between(float(manipulation_risk or 0.0) - epsilon, float(manipulation_risk or 0.0) + epsilon),
            ReportRecord.overall_risk.between(float(overall_risk or 0.0) - epsilon, float(overall_risk or 0.0) + epsilon),
        )
        .order_by(ReportRecord.id.desc())
        .first()
    )


def _effective_anchor_risk(report: ReportRecord) -> float:
    """Anchor on the stronger signal between overall and manipulation risk."""
    return max(float(report.risk_score or 0.0), float(report.manipulation_risk or 0.0))


def _meets_anchor_threshold(report: ReportRecord) -> bool:
    return _effective_anchor_risk(report) > DARK_PATTERN_THRESHOLD


def _reconcile_anchor_state_from_chain(db: Session, report: ReportRecord) -> ReportRecord:
    """Resolve stale DB anchor states when a tx hash already exists."""
    if not report:
        return report

    tx_hash = str(report.blockchain_tx_hash or report.tx_hash or "").strip()
    if not tx_hash:
        return report

    # Fast path: already consistent.
    if report.anchor_status == "anchored" and bool(report.blockchain_proof):
        return report

    try:
        chain_state = inspect_transaction_state(tx_hash)
    except Exception as exc:
        logger.warning(
            "Anchor reconcile skipped. report_id=%s tx_hash=%s reason=%s",
            report.report_id,
            tx_hash,
            exc,
        )
        return report

    state = str(chain_state.get("state") or "").strip().lower()
    receipt_status = chain_state.get("receipt_status")
    logger.info(
        "Anchor reconcile inspected. report_id=%s tx_hash=%s state=%s receipt_status=%s",
        report.report_id,
        tx_hash,
        state,
        receipt_status,
    )

    changed = False

    if state == "mined_success":
        if (
            not bool(report.blockchain_proof)
            or report.anchor_status != "anchored"
            or (report.blockchain_tx_hash or "") != tx_hash
            or (report.tx_hash or "") != tx_hash
            or report.anchor_error
        ):
            report.blockchain_proof = True
            report.blockchain_tx_hash = tx_hash
            report.tx_hash = tx_hash
            report.anchor_status = "anchored"
            report.anchor_error = None
            changed = True
    elif state in {"mined_failed", "dropped"}:
        failure_reason = (
            "transaction_reverted_on_chain"
            if state == "mined_failed"
            else "transaction_dropped_before_mining"
        )
        if (
            bool(report.blockchain_proof)
            or report.anchor_status != "failed"
            or report.anchor_error != failure_reason
            or (report.blockchain_tx_hash or "") != tx_hash
            or (report.tx_hash or "") != tx_hash
        ):
            report.blockchain_proof = False
            report.blockchain_tx_hash = tx_hash
            report.tx_hash = tx_hash
            report.anchor_status = "failed"
            report.anchor_error = failure_reason
            changed = True
    else:
        # Transaction exists but has no receipt yet.
        if report.anchor_status != "pending" or report.anchor_error:
            report.anchor_status = "pending"
            report.anchor_error = None
            changed = True

    if changed:
        db.commit()
        db.refresh(report)
        logger.info(
            "Anchor reconcile DB update. report_id=%s tx_hash=%s anchor_status=%s blockchain_proof=%s",
            report.report_id,
            tx_hash,
            report.anchor_status,
            report.blockchain_proof,
        )

    return report


def _anchor_report_if_needed(db: Session, report: ReportRecord) -> ReportRecord:
    if not report:
        return report

    existing_tx_hash = str(report.blockchain_tx_hash or report.tx_hash or "").strip()
    if existing_tx_hash:
        report = _reconcile_anchor_state_from_chain(db, report)
        # Avoid duplicate submissions while an existing tx is pending.
        if report.anchor_status in {"anchored", "failed", "pending"}:
            return report

    if not _meets_anchor_threshold(report):
        report.anchor_status = "not_required"
        report.anchor_error = None
        report.verification_status = "not_required"
        report.verification_error = None
        report.verified_at = None
        db.commit()
        db.refresh(report)
        return report

    if bool(report.blockchain_proof):
        if report.verification_status != "verified":
            try:
                verification = _run_verify_sync(report)
                _persist_verification_result(db, report, verification)
            except Exception as exc:
                report.verification_status = "verification_error"
                report.verification_error = str(exc)
                report.verified_at = None
                db.commit()
                db.refresh(report)
        return report

    report_hash = str(report.report_hash or "").strip()
    if not report_hash:
        payload = _parse_canonical_payload_json(report.canonical_payload)
        report_hash = build_report_keccak(payload)
        report.report_hash = report_hash

    duplicate = (
        db.query(ReportRecord)
        .filter(
            ReportRecord.id != report.id,
            ReportRecord.report_hash == report_hash,
            ReportRecord.blockchain_proof.is_(True),
            ReportRecord.blockchain_tx_hash.isnot(None),
        )
        .order_by(ReportRecord.id.desc())
        .first()
    )

    if duplicate and duplicate.blockchain_tx_hash:
        report.blockchain_proof = True
        report.blockchain_tx_hash = duplicate.blockchain_tx_hash
        report.tx_hash = duplicate.blockchain_tx_hash
        report.anchor_status = "anchored"
        report.anchor_error = "duplicate_hash_reused"
        report.verification_status = "pending"
        report.verification_error = None
        report.verified_at = None
        logger.info(
            "Anchor reused from duplicate. report_id=%s duplicate_report_id=%s tx_hash=%s",
            report.report_id,
            duplicate.report_id,
            duplicate.blockchain_tx_hash,
        )
        db.commit()
        db.refresh(report)

        try:
            verification = _run_verify_sync(report)
            _persist_verification_result(db, report, verification)
        except Exception as exc:
            report.verification_status = "verification_error"
            report.verification_error = str(exc)
            report.verified_at = None
            db.commit()
            db.refresh(report)
        return report

    try:
        logger.info("Anchoring start. report_id=%s report_hash=%s", report.report_id, report_hash)
        tx_hash = store_precomputed_hash_on_chain(report_hash)
        report.blockchain_proof = True
        report.blockchain_tx_hash = tx_hash
        report.tx_hash = tx_hash
        report.anchor_status = "anchored"
        report.anchor_error = None
        report.verification_status = "pending"
        report.verification_error = None
        report.verified_at = None
        logger.info("Anchoring receipt success. report_id=%s tx_hash=%s", report.report_id, tx_hash)
    except DuplicateReportAnchoringError:
        # Hash already on-chain from a prior transaction — treat as anchored.
        report.blockchain_proof = True
        report.anchor_status = "anchored"
        report.anchor_error = "duplicate_already_on_chain"
        report.verification_status = "pending"
        report.verification_error = None
        report.verified_at = None
        logger.info(
            "Anchoring duplicate on-chain. report_id=%s report_hash=%s",
            report.report_id,
            report_hash,
        )
    except Exception as exc:
        report.blockchain_proof = False
        report.blockchain_tx_hash = None
        report.tx_hash = None
        report.anchor_status = "failed"
        report.anchor_error = str(exc)
        report.verification_status = "verification_error"
        report.verification_error = str(exc)
        report.verified_at = None
        logger.error(
            "Anchoring failed. report_id=%s report_hash=%s error=%s",
            report.report_id,
            report_hash,
            exc,
        )

    db.commit()
    db.refresh(report)

    if report.anchor_status == "anchored" and report.tx_hash:
        try:
            verification = _run_verify_sync(report)
            _persist_verification_result(db, report, verification)
        except Exception as exc:
            report.verification_status = "verification_error"
            report.verification_error = str(exc)
            report.verified_at = None
            db.commit()
            db.refresh(report)

    logger.info(
        "Anchoring DB update. report_id=%s tx_hash=%s anchor_status=%s blockchain_proof=%s",
        report.report_id,
        report.blockchain_tx_hash or report.tx_hash,
        report.anchor_status,
        report.blockchain_proof,
    )

    return report


def _save_generated_report(
    *,
    db: Session,
    url: str,
    risk_score: float,
    detected_patterns: List[str],
    details: str,
    privacy_risk: float,
    manipulation_risk: float,
    overall_risk: float,
    tracker_count: int,
) -> ReportRecord:
    detected = _normalize_detected_patterns(detected_patterns)
    domain = normalize_domain(url)
    privacy_risk_value = round(float(privacy_risk or 0.0), 2)
    manipulation_risk_value = round(float(manipulation_risk or 0.0), 2)
    overall_risk_value = round(float(overall_risk or 0.0), 2)
    risk_score_value = round(float(risk_score or 0.0), 2)
    tracker_count_value = int(tracker_count or 0)
    pattern_names_json = encode_pattern_names(detected)

    stable_payload = _build_stable_report_payload(url, detected, details, risk_score)
    stable_payload_json = canonical_payload_to_json(stable_payload)
    report_hash = build_report_keccak(stable_payload)

    duplicate = _find_duplicate_report(
        db,
        domain=domain,
        report_hash=report_hash,
        pattern_names_json=pattern_names_json,
        privacy_risk=privacy_risk_value,
        manipulation_risk=manipulation_risk_value,
        overall_risk=overall_risk_value,
        tracker_count=tracker_count_value,
    )
    if duplicate:
        return _anchor_report_if_needed(db, duplicate)

    now = datetime.utcnow()
    anchor_status = "pending" if max(float(risk_score or 0.0), float(manipulation_risk or 0.0)) > DARK_PATTERN_THRESHOLD else "not_required"

    record = ReportRecord(
        report_id=str(uuid.uuid4()),
        url=str(url or "").strip(),
        domain=domain,
        risk_score=risk_score_value,
        detected_patterns=encode_detected_patterns(detected),
        details=str(details or "").strip(),
        timestamp=now,
        blockchain_proof=False,
        blockchain_tx_hash=None,
        report_hash=report_hash,
        canonical_payload=stable_payload_json,
        tx_hash=None,
        anchor_status=anchor_status,
        anchor_error=None,
        verification_status=("pending" if anchor_status == "pending" else "not_required"),
        verification_error=None,
        verified_at=None,
        privacy_risk=privacy_risk_value,
        manipulation_risk=manipulation_risk_value,
        overall_risk=overall_risk_value,
        pattern_count=len(detected),
        tracker_count=tracker_count_value,
        pattern_names_json=pattern_names_json,
        combined_insight=str(details or "").strip(),
        created_at=now,
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return _anchor_report_if_needed(db, record)


def _build_report_metadata(record: ReportRecord) -> Dict[str, Any]:
    return {
        "report_id": record.report_id,
        "risk_score": float(record.risk_score or 0.0),
        "blockchain_proof": bool(record.blockchain_proof),
        "ethereum_tx_hash": record.blockchain_tx_hash,
    }


def _format_utc_timestamp(value: Optional[datetime]) -> str:
    return value.isoformat() + "Z" if value else ""


def _stored_report_to_response(record: ReportRecord) -> StoredReportResponse:
    timestamp = _format_utc_timestamp(record.timestamp or record.created_at)
    created_at = _format_utc_timestamp(record.created_at)
    return StoredReportResponse(
        report_id=record.report_id,
        url=record.url,
        domain=record.domain,
        risk_score=float(record.risk_score or 0.0),
        detected_patterns=decode_detected_patterns(record.detected_patterns or record.pattern_names_json),
        details=record.details or record.combined_insight,
        timestamp=timestamp,
        blockchain_proof=bool(record.blockchain_proof),
        blockchain_tx_hash=record.blockchain_tx_hash or record.tx_hash,
        report_hash=record.report_hash,
        canonical_payload_json=record.canonical_payload,
        tx_hash=record.tx_hash,
        anchor_status=record.anchor_status,
        anchor_error=record.anchor_error,
        verification_status=record.verification_status,
        verification_error=record.verification_error,
        privacy_risk=record.privacy_risk,
        manipulation_risk=record.manipulation_risk,
        overall_risk=record.overall_risk,
        pattern_count=record.pattern_count,
        tracker_count=record.tracker_count,
        pattern_names=decode_pattern_names(record.pattern_names_json),
        combined_insight=record.combined_insight,
        created_at=created_at,
    )


def _anchor_report_worker(report_id: str) -> None:
    """Runs outside the request cycle to avoid blocking API responses."""
    db = SessionLocal()
    report: Optional[ReportRecord] = None
    try:
        logger.info("Anchor worker start. report_id=%s", report_id)
        report = db.query(ReportRecord).filter(ReportRecord.report_id == report_id).first()
        if not report:
            logger.warning("Anchor worker report missing. report_id=%s", report_id)
            return

        _anchor_report_if_needed(db, report)
        logger.info(
            "Anchor worker done. report_id=%s anchor_status=%s tx_hash=%s",
            report.report_id,
            report.anchor_status,
            report.blockchain_tx_hash or report.tx_hash,
        )
    except Exception as exc:
        if report:
            report.anchor_status = "failed"
            report.anchor_error = str(exc)
            report.verification_status = "verification_error"
            report.verification_error = str(exc)
            report.verified_at = None
            db.commit()
        logger.error("Anchor worker exception. report_id=%s error=%s", report_id, exc)
    finally:
        db.close()

# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health")
def health():
    remaining_cooldown = max(0, int(math.ceil(_GEMINI_GLOBAL_COOLDOWN_UNTIL - time.time())))
    return {
        "status": "ok",
        "version": "1.0.0",
        "gemini_enabled": GEMINI_AVAILABLE,
        "gemini_model": GEMINI_MODEL_NAME,
        "gemini_models_to_try": _GEMINI_MODEL_CANDIDATES,
        "gemini_quota_cooldown_sec": remaining_cooldown,
        "ai_powered": GEMINI_AVAILABLE
    }


@app.post("/analyze-complete", response_model=CompleteResponse)
async def analyze_complete(req: CompleteRequest, db: Session = Depends(get_db)):
    p_risk = calc_privacy_risk(req.privacy_data)
    m_risk = calc_manipulation_risk(req.manipulation_data)
    # Keep backend consistent with extension-side risk evaluation:
    # overall risk is the stronger of privacy/manipulation signals.
    o_risk = max(p_risk, m_risk)

    p_level = get_risk_level(p_risk)
    m_level = get_risk_level(m_risk)
    o_level = get_risk_level(o_risk)

    p_insights = make_privacy_insights(req.privacy_data)
    m_insights = make_manipulation_insights(req.manipulation_data)
    combined   = await make_ai_insight(
        req.url,
        req.privacy_data,
        req.manipulation_data,
        screenshot_data_url=req.screenshot_data_url,
        dom_text=req.dom_text,
        aria_text=req.aria_text,
    )

    violations = (
        get_privacy_violations(req.privacy_data.dict()) +
        get_manipulation_violations([p.dict() for p in req.manipulation_data.patterns])
    )

    total = len(req.privacy_data.trackers) + len(req.manipulation_data.patterns)

    detected_patterns = [
        p.name for p in req.manipulation_data.patterns
        if str(getattr(p, "name", "")).strip()
    ]
    stored_report = _save_generated_report(
        db=db,
        url=req.url,
        risk_score=o_risk,
        detected_patterns=detected_patterns,
        details=combined.get("combined_summary", "Analysis complete."),
        privacy_risk=p_risk,
        manipulation_risk=m_risk,
        overall_risk=o_risk,
        tracker_count=len(req.privacy_data.trackers),
    )

    combined["report_metadata"] = _build_report_metadata(stored_report)

    return CompleteResponse(
        url=req.url,
        privacy_risk=p_risk,
        manipulation_risk=m_risk,
        overall_risk=o_risk,
        privacy_level=p_level,
        manipulation_level=m_level,
        overall_level=o_level,
        total_violations=total,
        privacy_insights=p_insights,
        manipulation_insights=m_insights,
        combined_insight=combined.get("combined_summary", "Analysis complete."),
        regulatory_violations=violations,
        ai_powered=GEMINI_AVAILABLE,
        ai_details=combined,
    )


@app.post("/reports/save", response_model=StoredReportResponse)
async def save_report(
    req: SaveReportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    resolved_domain = normalize_domain(req.domain or req.url)
    if not resolved_domain:
        raise HTTPException(status_code=400, detail="Unable to resolve domain from URL")

    normalized_patterns = sorted({str(name).strip() for name in req.pattern_names if str(name).strip()})

    canonical_payload = build_canonical_payload(
        url=req.url,
        domain=resolved_domain,
        privacy_risk=req.privacy_risk,
        manipulation_risk=req.manipulation_risk,
        overall_risk=req.overall_risk,
        tracker_count=req.tracker_count,
        pattern_names=normalized_patterns,
        combined_insight=req.combined_insight or "",
    )
    canonical_json = canonical_payload_to_json(canonical_payload)
    report_hash = build_report_keccak(canonical_payload)
    pattern_names_json = encode_pattern_names(normalized_patterns)
    privacy_risk_value = round(float(req.privacy_risk), 2)
    manipulation_risk_value = round(float(req.manipulation_risk), 2)
    overall_risk_value = round(float(req.overall_risk), 2)
    tracker_count_value = int(req.tracker_count or 0)

    duplicate = _find_duplicate_report(
        db,
        domain=resolved_domain,
        report_hash=report_hash,
        pattern_names_json=pattern_names_json,
        privacy_risk=privacy_risk_value,
        manipulation_risk=manipulation_risk_value,
        overall_risk=overall_risk_value,
        tracker_count=tracker_count_value,
    )
    if duplicate:
        duplicate = _reconcile_anchor_state_from_chain(db, duplicate)
        if req.anchor_on_save and _meets_anchor_threshold(duplicate) and duplicate.anchor_status not in {"anchored", "pending"}:
            duplicate.anchor_status = "pending"
            duplicate.anchor_error = None
            duplicate.verification_status = "pending"
            duplicate.verification_error = None
            duplicate.verified_at = None
            db.commit()
            db.refresh(duplicate)
            background_tasks.add_task(_anchor_report_worker, duplicate.report_id)
        return _stored_report_to_response(duplicate)

    record = ReportRecord(
        report_id=str(uuid.uuid4()),
        url=req.url,
        domain=resolved_domain,
        risk_score=overall_risk_value,
        detected_patterns=encode_detected_patterns(normalized_patterns),
        details=str(req.combined_insight or "").strip(),
        timestamp=datetime.utcnow(),
        blockchain_proof=False,
        blockchain_tx_hash=None,
        report_hash=report_hash,
        canonical_payload=canonical_json,
        tx_hash=None,
        anchor_status=(
            "pending"
            if req.anchor_on_save and max(float(req.overall_risk), float(req.manipulation_risk)) > DARK_PATTERN_THRESHOLD
            else ("not_required" if req.anchor_on_save else "not_requested")
        ),
        anchor_error=None,
        verification_status=(
            "pending"
            if req.anchor_on_save and max(float(req.overall_risk), float(req.manipulation_risk)) > DARK_PATTERN_THRESHOLD
            else ("not_required" if req.anchor_on_save else "not_requested")
        ),
        verification_error=None,
        verified_at=None,
        privacy_risk=privacy_risk_value,
        manipulation_risk=manipulation_risk_value,
        overall_risk=overall_risk_value,
        pattern_count=len(normalized_patterns),
        tracker_count=tracker_count_value,
        pattern_names_json=pattern_names_json,
        combined_insight=req.combined_insight,
        created_at=datetime.utcnow(),
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    if req.anchor_on_save and _meets_anchor_threshold(record):
        background_tasks.add_task(_anchor_report_worker, record.report_id)

    return _stored_report_to_response(record)


@app.get("/reports", response_model=List[StoredReportResponse])
def list_reports(
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    safe_offset = max(offset, 0)

    query = (
        db.query(ReportRecord)
        .order_by(ReportRecord.timestamp.desc(), ReportRecord.created_at.desc())
    )

    if safe_offset:
        query = query.offset(safe_offset)
    if limit is not None:
        safe_limit = min(max(limit, 1), 1000)
        query = query.limit(safe_limit)

    rows = query.all()
    reconciled: List[ReportRecord] = []
    for row in rows:
        has_tx_hash = bool(str(row.blockchain_tx_hash or row.tx_hash or "").strip())
        if has_tx_hash and row.anchor_status != "anchored":
            row = _reconcile_anchor_state_from_chain(db, row)
        reconciled.append(row)
    return [_stored_report_to_response(row) for row in reconciled]


@app.post("/clear-reports")
def clear_reports():
    deleted_reports = clear_reports_table()
    return {
        "status": "reports table cleared",
        "deleted_reports": deleted_reports,
    }


@app.get("/reports/{report_id}", response_model=StoredReportResponse)
def get_report(report_id: str, db: Session = Depends(get_db)):
    row = db.query(ReportRecord).filter(ReportRecord.report_id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return _stored_report_to_response(row)


@app.post("/reports/{report_id}/anchor", response_model=TriggerAnchorResponse)
def trigger_report_anchor(
    report_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    row = db.query(ReportRecord).filter(ReportRecord.report_id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")

    row = _reconcile_anchor_state_from_chain(db, row)

    if row.anchor_status == "anchored" and (row.tx_hash or row.blockchain_tx_hash):
        return TriggerAnchorResponse(
            report_id=row.report_id,
            anchor_status=row.anchor_status,
            tx_hash=row.tx_hash or row.blockchain_tx_hash,
            detail="Report already anchored",
        )

    row.anchor_status = "pending"
    row.anchor_error = None
    db.commit()

    background_tasks.add_task(_anchor_report_worker, row.report_id)
    return TriggerAnchorResponse(
        report_id=row.report_id,
        anchor_status=row.anchor_status,
        tx_hash=row.tx_hash,
        detail="Anchoring job queued",
    )


@app.post("/reports/retry-failed-anchors", response_model=RetryAnchorsResponse)
def retry_failed_anchors(
    limit: int = 100,
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    safe_limit = min(max(limit, 1), 500)
    candidates = (
        db.query(ReportRecord)
        .filter(ReportRecord.anchor_status.in_(["failed", "pending"]))
        .order_by(ReportRecord.created_at.desc())
        .limit(safe_limit)
        .all()
    )

    queued_ids: List[str] = []
    for row in candidates:
        if not _meets_anchor_threshold(row):
            row.anchor_status = "not_required"
            row.anchor_error = None
            row.verification_status = "not_required"
            row.verification_error = None
            row.verified_at = None
            continue

        row.anchor_status = "pending"
        row.anchor_error = None
        row.verification_status = "pending"
        row.verification_error = None
        row.verified_at = None
        queued_ids.append(row.report_id)

    db.commit()

    if background_tasks is not None:
        for report_id in queued_ids:
            background_tasks.add_task(_anchor_report_worker, report_id)

    return RetryAnchorsResponse(
        queued=len(queued_ids),
        scanned=len(candidates),
        report_ids=queued_ids,
    )


@app.get("/reports/{report_id}/verify", response_model=VerifyReportResponse)
async def verify_report_integrity(report_id: str, db: Session = Depends(get_db)):
    row = db.query(ReportRecord).filter(ReportRecord.report_id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")

    verification = await _evaluate_report_verification(row)
    _persist_verification_result(db, row, verification)
    return VerifyReportResponse(**verification)


@app.get("/wall-of-shame", response_model=List[WallOfShameItem])
def wall_of_shame(limit: Optional[int] = None, db: Session = Depends(get_db)):
    contract_address = _configured_contract_address()

    query = (
        db.query(ReportRecord)
        .filter(
            ReportRecord.risk_score >= DARK_PATTERN_THRESHOLD,
            ReportRecord.anchor_status == "anchored",
        )
        .order_by(ReportRecord.risk_score.desc(), ReportRecord.timestamp.desc())
    )

    if limit is not None:
        safe_limit = min(max(limit, 1), 1000)
        query = query.limit(safe_limit)

    rows = query.all()

    results: List[WallOfShameItem] = []
    for row in rows:
        has_tx_hash = bool(str(row.blockchain_tx_hash or row.tx_hash or "").strip())
        if has_tx_hash and row.anchor_status != "anchored":
            row = _reconcile_anchor_state_from_chain(db, row)

        ts = row.timestamp or row.created_at
        results.append(
            WallOfShameItem(
                url=row.url,
                risk_score=float(row.risk_score or 0.0),
                detected_patterns=decode_detected_patterns(row.detected_patterns or row.pattern_names_json),
                timestamp=ts.isoformat() + "Z" if ts else "",
                blockchain_proof=bool(row.blockchain_proof),
                blockchain_tx_hash=row.blockchain_tx_hash or row.tx_hash,
                contract_address=contract_address,
            )
        )
    return results


@app.post("/analyze-domains", response_model=AnalyzeDomainsResponse)
async def analyze_domains(req: AnalyzeDomainsRequest):
    # Temporary debug log for runtime validation of request shape.
    payload_log = json.dumps(
        {
            "domains": req.domains,
            "first_party_domain": req.first_party_domain,
        },
        default=str,
    )
    print(f"[ConsumerShield] analyze-domains request payload: {payload_log}")
    logger.info(
        "analyze-domains request payload: %s",
        payload_log,
    )

    first_party = normalize_domain(req.first_party_domain or "")

    unique_domains: List[str] = []
    seen = set()
    for raw_domain in req.domains:
        normalized = normalize_domain(raw_domain)
        if not normalized or normalized in seen:
            continue
        if first_party and (normalized == first_party or normalized.endswith(f".{first_party}")):
            continue
        seen.add(normalized)
        unique_domains.append(normalized)

    resolved_trackers: List[Dict[str, Any]] = []
    suspicious_domains: List[Dict[str, Any]] = []
    weighted_sum = 0.0
    total_weight = 0.0

    for domain in unique_domains:
        reasons: List[str] = []
        keyword_hits = _has_tracking_keywords(domain)
        reasons.extend([f"keyword:{keyword}" for keyword in keyword_hits])
        if _is_ip_domain(domain):
            reasons.append("ip-domain")
        if _has_suspicious_entropy(domain):
            reasons.append("suspicious-entropy")

        radar_match = resolve_radar_entity(domain)
        score = predict_tracker_score(domain, radar_match, reasons)

        weight = 1.0
        if radar_match and isinstance(radar_match.get("prevalence"), (int, float)):
            weight += min(1.0, float(radar_match["prevalence"]) * 20.0)
        if reasons:
            weight += 0.1

        weighted_sum += score * weight
        total_weight += weight

        if radar_match:
            resolved_trackers.append({
                "domain": domain,
                "matched_domain": radar_match.get("matched_domain"),
                "entity": radar_match.get("entity"),
                "prevalence": radar_match.get("prevalence"),
                "categories": radar_match.get("categories", []),
                "privacy_score": score,
            })
        elif reasons:
            suspicious_domains.append({
                "domain": domain,
                "reasons": reasons,
                "privacy_score": score,
            })

    total_privacy_score = round((weighted_sum / total_weight), 2) if total_weight > 0 else 1.0

    return AnalyzeDomainsResponse(
        resolved_trackers=resolved_trackers,
        suspicious_domains=suspicious_domains,
        total_privacy_score=total_privacy_score,
    )


@app.post("/analyze-privacy")
async def analyze_privacy(req: PrivacyOnlyRequest, db: Session = Depends(get_db)):
    risk  = calc_privacy_risk(req.privacy_data)
    level = get_risk_level(risk)
    violations = get_privacy_violations(req.privacy_data.dict())
    insights = make_privacy_insights(req.privacy_data)

    detected_patterns = [
        str(item.get("violation_type") or item.get("issue") or "").strip()
        for item in violations
        if str(item.get("violation_type") or item.get("issue") or "").strip()
    ]
    details = " | ".join(insights)

    stored_report = _save_generated_report(
        db=db,
        url=req.url,
        risk_score=risk,
        detected_patterns=detected_patterns,
        details=details,
        privacy_risk=risk,
        manipulation_risk=0.0,
        overall_risk=risk,
        tracker_count=len(req.privacy_data.trackers),
    )

    return {
        "url": req.url,
        "privacy_risk": risk,
        "privacy_level": level,
        "insights": insights,
        "violations": violations,
        **_build_report_metadata(stored_report),
    }


@app.post("/analyze-dark-patterns")
async def analyze_dark_patterns(req: ManipulationOnlyRequest, db: Session = Depends(get_db)):
    risk  = calc_manipulation_risk(req.manipulation_data)
    level = get_risk_level(risk)
    insights = make_manipulation_insights(req.manipulation_data)
    violations = get_manipulation_violations([p.dict() for p in req.manipulation_data.patterns])

    detected_patterns = [
        p.name for p in req.manipulation_data.patterns
        if str(getattr(p, "name", "")).strip()
    ]
    details = " | ".join(insights)

    stored_report = _save_generated_report(
        db=db,
        url=req.url,
        risk_score=risk,
        detected_patterns=detected_patterns,
        details=details,
        privacy_risk=0.0,
        manipulation_risk=risk,
        overall_risk=risk,
        tracker_count=0,
    )

    return {
        "url": req.url,
        "manipulation_risk": risk,
        "manipulation_level": level,
        "insights": insights,
        "violations": violations,
        **_build_report_metadata(stored_report),
    }


@app.post("/anchor-report")
async def anchor_report(req: AnchorRequest):
    try:
        payload = {
            "url": req.url,
            "summary": req.summary,
            "timestamp": datetime.utcnow().isoformat(),
        }
        tx_hash = store_report_hash_on_chain(payload)
        return {"status": "success", "ethereum_tx_hash": tx_hash}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
