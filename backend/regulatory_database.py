"""
ConsumerShield — Regulatory Database
Maps detected violations to Indian consumer protection laws.
"""

from typing import List, Dict, Any

PATTERN_TYPE_ALIASES = {
    "trick_wording": "trick_questions",
    "trick_question": "trick_questions",
    "false_hierarchy": "obstruction",
    "false-hierarchy": "obstruction",
}

# ════════════════════════════════════════════════════════════════
# REGULATORY FRAMEWORK
# ════════════════════════════════════════════════════════════════

REGULATORY_FRAMEWORK = {

    # ── Privacy Laws ──────────────────────────────────────────────
    "privacy": {

        "tracking_without_consent": {
            "law":         "Digital Personal Data Protection Act 2023",
            "short":       "DPDP Act 2023",
            "section":     "Section 6 — Lawful Processing & Consent",
            "requirement": "Explicit, informed consent required before collecting or processing personal data.",
            "penalty":     {"min": "₹50 crore", "max": "₹250 crore"},
            "authority":   "Data Protection Board of India",
            "citation":    "DPDP Act 2023, Section 6 read with Section 33",
        },

        "third_party_sharing": {
            "law":         "Digital Personal Data Protection Act 2023",
            "short":       "DPDP Act 2023",
            "section":     "Section 8 — Obligations of Data Fiduciary",
            "requirement": "Data fiduciary must disclose third-party sharing in clear, plain language.",
            "penalty":     {"min": "₹50 crore", "max": "₹250 crore"},
            "authority":   "Data Protection Board of India",
            "citation":    "DPDP Act 2023, Section 8(1)",
        },

        "no_opt_out": {
            "law":         "Digital Personal Data Protection Act 2023",
            "short":       "DPDP Act 2023",
            "section":     "Section 12 — Rights of Data Principal",
            "requirement": "Users must be able to withdraw consent at any time as easily as it was given.",
            "penalty":     {"min": "₹10 crore", "max": "₹250 crore"},
            "authority":   "Data Protection Board of India",
            "citation":    "DPDP Act 2023, Section 12(2)",
        },

        "fingerprinting": {
            "law":         "Information Technology Act 2000",
            "short":       "IT Act 2000",
            "section":     "Section 43A — Compensation for Failure to Protect Data",
            "requirement": "Organizations must implement reasonable security practices.",
            "penalty":     {"min": "₹5 crore", "max": "Unlimited civil liability"},
            "authority":   "Ministry of Electronics and Information Technology",
            "citation":    "IT Act 2000, Section 43A",
        },
    },

    # ── Dark Pattern Laws ─────────────────────────────────────────
    "manipulation": {

        "urgency": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 1: False Urgency",
            "description": "Creating a false sense of urgency, scarcity, or popularity to compel purchase.",
            "penalty":     {"min": "₹10 lakh", "max": "₹50 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 2(47) — Unfair Trade Practice",
        },

        "sneaking": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 11: Drip Pricing",
            "description": "Revealing additional price components only at checkout, not upfront.",
            "penalty":     {"min": "₹25 lakh", "max": "₹50 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 2(47)",
        },

        "confirmshaming": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 3: Confirmshaming",
            "description": "Using guilt-inducing language to shame users into complying with requests.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
        },

        "trick_questions": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 4: Trick Questions",
            "description": "Using confusing or double-negative language on consent forms to cause user errors.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
        },

        "forced_continuity": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 7: Forced Continuity",
            "description": "Charging for subscriptions after free trial without adequate notice or easy cancellation.",
            "penalty":     {"min": "₹25 lakh", "max": "₹50 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 47 — Unfair Contract",
        },

        "disguised_ads": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 6: Disguised Advertisement",
            "description": "Presenting paid promotions as organic search results or editorial content.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "ASCI Code of Self-Regulation in Advertising",
        },

        "misdirection": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 10: Misdirection",
            "description": "Using visual hierarchy or framing to steer users toward a seller-favored choice.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 2(47)",
        },

        "nagging": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 9: Nagging",
            "description": "Repeated prompts and interruptions that pressure users into actions they did not intend.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 2(47)",
        },

        "preselected": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 5: Pre-selection",
            "description": "Defaulting options that benefit the seller, especially for marketing or add-ons.",
            "penalty":     {"min": "₹10 lakh", "max": "₹25 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
        },

        "obstruction": {
            "law":         "Guidelines for Prevention and Regulation of Dark Patterns 2023",
            "short":       "CCPA Dark Patterns Guidelines 2023",
            "section":     "Schedule — Item 8: Obstruction / Roach Motel",
            "description": "Making it significantly harder to cancel a service than to subscribe.",
            "penalty":     {"min": "₹25 lakh", "max": "₹50 lakh"},
            "authority":   "Central Consumer Protection Authority (CCPA)",
            "also_violates": "Consumer Protection Act 2019, Section 47",
        },
    },

    # ── General Consumer Protection ───────────────────────────────
    "general": {
        "unfair_trade_practice": {
            "law":         "Consumer Protection Act 2019",
            "section":     "Section 2(47) — Unfair Trade Practice",
            "description": "Any trade practice for promoting goods/services by unfair or deceptive methods.",
            "penalty":     "₹10 lakh to ₹50 lakh",
            "authority":   "Consumer Disputes Redressal Commission",
        },
    },
}

# ════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ════════════════════════════════════════════════════════════════

def get_privacy_violations(privacy_data: dict) -> List[Dict[str, str]]:
    violations = []
    fw = REGULATORY_FRAMEWORK["privacy"]

    if len(privacy_data.get("trackers", [])) > 0:
        v = fw["tracking_without_consent"]
        violations.append({
            "violation_type": "privacy",
            "issue":    "Tracking across sessions without clear user consent",
            "law":      v["law"],
            "section":  v["section"],
            "penalty":  f"{v['penalty']['min']} – {v['penalty']['max']}",
            "authority":v["authority"],
        })

    policy = privacy_data.get("policy") or {}
    if policy.get("thirdPartySharing"):
        v = fw["third_party_sharing"]
        violations.append({
            "violation_type": "privacy",
            "issue":    "Third-party data sharing without disclosure",
            "law":      v["law"],
            "section":  v["section"],
            "penalty":  f"{v['penalty']['min']} – {v['penalty']['max']}",
            "authority":v["authority"],
        })

    if policy.get("noOptOut"):
        v = fw["no_opt_out"]
        violations.append({
            "violation_type": "privacy",
            "issue":    "No clear mechanism to withdraw consent",
            "law":      v["law"],
            "section":  v["section"],
            "penalty":  f"{v['penalty']['min']} – {v['penalty']['max']}",
            "authority":v["authority"],
        })

    if privacy_data.get("fingerprinting"):
        v = fw["fingerprinting"]
        violations.append({
            "violation_type": "privacy",
            "issue":    "Canvas fingerprinting / unauthorized browser profiling",
            "law":      v["law"],
            "section":  v["section"],
            "penalty":  v["penalty"]["min"],
            "authority":v["authority"],
        })

    return violations


def get_manipulation_violations(patterns: List[dict]) -> List[Dict[str, str]]:
    violations = []
    fw = REGULATORY_FRAMEWORK["manipulation"]
    seen = set()

    for pattern in patterns:
        raw_ptype = str(pattern.get("type") or "").strip().lower().replace(" ", "_")
        ptype = PATTERN_TYPE_ALIASES.get(raw_ptype, raw_ptype)
        if ptype in fw and ptype not in seen:
            seen.add(ptype)
            v = fw[ptype]
            violations.append({
                "violation_type": "manipulation",
                "issue":    v.get("description", f"{ptype} dark pattern"),
                "law":      v["law"],
                "section":  v["section"],
                "penalty":  f"{v['penalty']['min']} – {v['penalty']['max']}",
                "authority":v["authority"],
            })

    # Add general unfair trade practice if any manipulation found
    if patterns:
        g = REGULATORY_FRAMEWORK["general"]["unfair_trade_practice"]
        violations.append({
            "violation_type": "general",
            "issue":    "Unfair or deceptive trade practices via dark patterns",
            "law":      g["law"],
            "section":  g["section"],
            "penalty":  g["penalty"],
            "authority":g["authority"],
        })

    return violations
