"""
ConsumerShield — API Test Script
Tests the /analyze-complete endpoint with simulated Flipkart/Amazon-like data.
Usage: python test_api.py
"""

import requests
import json

BASE_URL = "http://localhost:8000"

def test_health():
    print("━━ Health Check ━━━━━━━━━━━━━━━━━━━━━━━━━━")
    r = requests.get(f"{BASE_URL}/health")
    print(f"Status: {r.status_code}")
    print(json.dumps(r.json(), indent=2))
    print()

def test_complete_analysis():
    print("━━ Complete Analysis (Simulated Flipkart) ━━━━━━━━━━━━━━━━━━━━━━━━")
    payload = {
        "url": "https://www.flipkart.com/product/item",
        "privacy_data": {
            "trackers": [
                {"domain": "google-analytics.com", "type": "analytics",  "name": "Google Analytics"},
                {"domain": "facebook.com",           "type": "social",     "name": "Facebook Pixel"},
                {"domain": "doubleclick.net",         "type": "advertising","name": "DoubleClick"},
                {"domain": "hotjar.com",              "type": "analytics",  "name": "Hotjar"},
                {"domain": "criteo.com",              "type": "advertising","name": "Criteo"},
                {"domain": "taboola.com",             "type": "advertising","name": "Taboola"},
            ],
            "policy": {
                "thirdPartySharing": True,
                "noOptOut": True,
                "extensiveCollection": True,
                "hasOptOut": False
            },
            "fingerprinting": True
        },
        "manipulation_data": {
            "patterns": [
                {"type": "urgency",       "name": "False Urgency",       "severity": "high",   "confidence": 0.92, "text": "Only 2 left in stock!", "description": "Artificial scarcity created"},
                {"type": "sneaking",      "name": "Hidden Costs",        "severity": "high",   "confidence": 0.89, "text": "₹150 convenience fee added", "description": "Drip pricing at checkout"},
                {"type": "confirmshaming","name": "Confirmshaming",      "severity": "medium", "confidence": 0.80, "text": "No thanks, I enjoy paying more", "description": "Guilt-based decline button"},
                {"type": "preselected",   "name": "Pre-selected Options","severity": "medium", "confidence": 0.85, "text": "☑ Subscribe to promotional emails", "description": "Marketing checkbox pre-checked"},
            ]
        }
    }
    r = requests.post(f"{BASE_URL}/analyze-complete", json=payload)
    print(f"Status: {r.status_code}")
    result = r.json()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print()

def test_privacy_only():
    print("━━ Privacy-Only (Clean Site) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    payload = {
        "url": "https://www.india.gov.in",
        "privacy_data": {
            "trackers": [],
            "policy": {"thirdPartySharing": False, "noOptOut": False, "extensiveCollection": False, "hasOptOut": True},
            "fingerprinting": False
        }
    }
    r = requests.post(f"{BASE_URL}/analyze-privacy", json=payload)
    print(f"Status: {r.status_code}")
    print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    print()

def test_dark_patterns_only():
    print("━━ Dark Patterns Only (Amazon-like) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    payload = {
        "url": "https://www.amazon.in/product",
        "manipulation_data": {
            "patterns": [
                {"type": "urgency",          "name": "False Urgency",          "severity": "high",   "confidence": 0.95, "text": "Sale ends in 02:15:00", "description": "Fake countdown timer"},
                {"type": "forced_continuity","name": "Forced Continuity",      "severity": "high",   "confidence": 0.88, "text": "Automatically renews at ₹999/month", "description": "Auto-renewal without clear notice"},
                {"type": "obstruction",      "name": "Obstruction / Roach Motel","severity": "high", "confidence": 0.75, "text": "To cancel, call 1800-xxx-xxxx", "description": "Cancellation requires phone call"},
            ]
        }
    }
    r = requests.post(f"{BASE_URL}/analyze-dark-patterns", json=payload)
    print(f"Status: {r.status_code}")
    print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    print()

if __name__ == "__main__":
    print("🛡️  ConsumerShield API Tests")
    print("═" * 50)
    try:
        test_health()
        test_complete_analysis()
        test_privacy_only()
        test_dark_patterns_only()
        print("✅ All tests complete!")
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to server.")
        print("   Start the backend first: uvicorn main:app --reload")
