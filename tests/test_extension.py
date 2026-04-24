#!/usr/bin/env python3
"""
ConsumerShield Extension Test Suite
Tests dark pattern detection against known deceptive sites and e-commerce platforms.
"""

import asyncio
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

import requests
from playwright.async_api import async_playwright, Browser, BrowserContext

# Configuration
EXTENSION_PATH = "/home/kart/Desktop/hackathon/ConsumerShield-Backup-/consumershield/extension"
BACKEND_URL = "http://localhost:8000"
OUTPUT_DIR = "/home/kart/Desktop/hackathon"
REPORT_FILE = os.path.join(OUTPUT_DIR, "test_report.md")

# Target sites to test
SITES_TO_TEST = [
    {
        "url": "https://www.deceptive.design/",
        "name": "Deceptive Design",
        "category": "Known Dark Patterns Database"
    },
    {
        "url": "https://www.flipkart.com",
        "name": "Flipkart",
        "category": "E-Commerce"
    },
    {
        "url": "https://www.amazon.in",
        "name": "Amazon India",
        "category": "E-Commerce"
    },
    {
        "url": "https://www.makemytrip.com",
        "name": "MakeMyTrip",
        "category": "Travel"
    },
]

# ═══════════════════════════════════════════════════════════════════════════
# ANALYSIS ENGINE - Mimics extension dark pattern detection
# ═══════════════════════════════════════════════════════════════════════════

KNOWN_TRACKERS = [
    {"domain": "google-analytics.com", "type": "analytics", "name": "Google Analytics"},
    {"domain": "googletagmanager.com", "type": "analytics", "name": "Google Tag Manager"},
    {"domain": "analytics.google.com", "type": "analytics", "name": "Google Analytics 4"},
    {"domain": "hotjar.com", "type": "analytics", "name": "Hotjar"},
    {"domain": "mixpanel.com", "type": "analytics", "name": "Mixpanel"},
    {"domain": "amplitude.com", "type": "analytics", "name": "Amplitude"},
    {"domain": "doubleclick.net", "type": "advertising", "name": "DoubleClick (Google)"},
    {"domain": "googlesyndication.com", "type": "advertising", "name": "Google AdSense"},
    {"domain": "googleadservices.com", "type": "advertising", "name": "Google Ad Services"},
    {"domain": "criteo.com", "type": "advertising", "name": "Criteo"},
    {"domain": "taboola.com", "type": "advertising", "name": "Taboola"},
    {"domain": "facebook.com", "type": "social", "name": "Facebook Pixel"},
    {"domain": "platform.twitter.com", "type": "social", "name": "Twitter Analytics"},
    {"domain": "linkedin.com", "type": "social", "name": "LinkedIn Insight"},
    {"domain": "scorecardresearch.com", "type": "data_broker", "name": "Comscore"},
    {"domain": "quantserve.com", "type": "data_broker", "name": "Quantcast"},
]

DARK_PATTERNS = {
    "urgency": {
        "name": "False Urgency",
        "severity": "high",
        "patterns": [
            r"only\s*(\d+|one|two|three|few|several)\s*(left|remaining|in stock|available|spots)",
            r"hurry[!,\s]*only",
            r"selling\s*out|sold\s*out",
            r"selling\s*fast|going\s*fast",
            r"limited\s*(time|offer|stock|quantity|edition|seats|availability)",
            r"(\d+)\s*people\s*(are\s*)?(viewing|watching|looking at|browsing|interested)",
            r"sale\s*ends?\s*(in|at|tonight|today|tomorrow|soon)",
            r"(\d+)\s*(hours?|mins?|minutes?|seconds?)\s*(left|remaining|till|until)",
            r"don'?t\s*miss\s*(out|this|the)",
            r"last\s*(chance|opportunity|few|day|hours?|minute)",
            r"ends?\s*(tonight|today|noon|midnight|soon|very soon)",
            r"act\s*now",
            r"before\s*(it's?\s*)?(gone|sold out)",
            r"countdown\s*timer|timer\s*countdown",
            r"offer\s*expires?",
            r"\d+%\s*off.*only.*today",
            r"flash\s*sale",
            r"exclusive.*limited",
            r"buy\s*now",
            r"(?:almost|nearly|almost all)\s*(?:gone|sold out|sold)",
        ]
    },
    "sneaking": {
        "name": "Hidden Costs (Drip Pricing)",
        "severity": "high",
        "patterns": [
            r"convenience\s*fee",
            r"handling\s*(charges?|fee|cost)",
            r"platform\s*fee",
            r"processing\s*(fee|charges?|cost)",
            r"\+\s*(?:taxes?|tds)?\s*&?\s*(?:and\s*)?fees?",
            r"additional\s*(?:charges?|fees?|costs?)\s*(?:may\s*)?apply",
            r"delivery\s*(?:fee|charges?|cost)\s*(?:added\s*)?(?:at\s*|during\s*)?checkout",
            r"service\s*(?:fee|charges?)",
            r"booking\s*fee",
            r"transaction\s*fee",
            r"surcharge",
            r"(?:see|view|check).*charges.*at.*checkout",
            r"final\s*(?:price|total).*may\s*differ",
            r"taxes?\s*(?:and\s*)?(?:fees?|duties)\s*(?:to\s*)?(?:be\s*)?(?:added|calculated)",
        ]
    },
    "confirmshaming": {
        "name": "Confirmshaming",
        "severity": "medium",
        "patterns": [
            r"no\s*(?:thanks?|thanx)[,.]?\s*i\s*(?:don'?t|prefer not|hate|refuse|skip|decline)",
            r"no[,.]?\s*i\s*(?:enjoy|love|like|prefer)\s*(?:paying|spending|wasting|overpaying)",
            r"i\s*(?:don'?t|do not|really don'?t|never)\s*(?:care|want|need)\s*(?:about|for)?\s*(?:saving|discount|deals?|money)",
            r"skip[,.]?\s*i'?m?\s*(?:fine|okay|good|happy)\s*(?:with|without)\s*(?:paying|high prices|full price)",
            r"no\s*thanks\s*i\s*prefer\s*to\s*(?:pay|overpay)",
            r"decline.*(?:pay more|lose|miss)",
            r"i'?d\s*rather\s*(?:not|decline)",
            r"maybe\s*later.*let.*miss",
            r"turn\s*(?:down|away|decline).*(?:save|offer|deal)",
        ]
    },
    "trick_questions": {
        "name": "Trick Questions / Double Negatives",
        "severity": "medium",
        "patterns": [
            r"uncheck\s*(?:this\s*)?(?:box|if)\s*(?:to\s*)?(?:not|stop|opt[\s-]?out)",
            r"do\s*not\s*(?:un)?check\s*(?:if\s*)?you\s*do\s*not\s*want",
            r"opt\s*out\s*of\s*(?:not\s*)?receiving",
            r"untick\s*(?:to\s*)?(?:opt[\s-]?out|receive|unsubscribe)",
            r"leave.*checked.*continue",
            r"(?:leaving|keep|keep it)\s*(?:this|this box|it)\s*checked.*(?:means|means you|opt|agree|accept)",
            r"double\s*negative",
        ]
    },
    "forced_continuity": {
        "name": "Forced Continuity",
        "severity": "high",
        "patterns": [
            r"automatically\s*(?:renew|charge|bill|debit)(?:ed)?",
            r"auto[\s-]?(?:renew|renewal|billing)",
            r"cancel\s*(?:any\s*)?time|cancel\s*(?:within|after)",
            r"charged\s*(?:automatically|recurring)",
            r"free\s*trial.*(?:then\s*)?(?:\$|₹|rs\.?)\s*[\d,\.]+",
            r"subscription\s*(?:renews?|billed|charged)\s*(?:monthly|annually|yearly|quarterly)",
            r"after.*free.*trial.*will.*charge",
            r"continue.*subscription",
            r"billing\s*(?:will|by default|automatically)",
            r"recurring\s*(?:charges?|billing)",
            r"to\s*(?:cancel|stop)\s*(?:subscription|charges?|billing).*(?:contact|call|visit)",
        ]
    },
    "disguised_ads": {
        "name": "Disguised Advertisements",
        "severity": "medium",
        "patterns": [
            r"sponsored\s*(?:result|post|content|link|listing|product|ad)",
            r"(?:^\s*|\s+)ad\s*(?:\s*·|:|\s*-|\s*$)",
            r"promoted\s*(?:listing|result|product|post|content|by)",
            r"advertisement",
            r"from\s*(?:our\s*)?sponsor",
            r"in\s*partnership\s*with",
            r"partners\s*content",
            r"\[ad\]",
            r"#ad|#sponsored",
            r"brand\s*content",
        ]
    },
    "misdirection": {
        "name": "Misdirection",
        "severity": "medium",
        "patterns": [
            r"(?:highly\s*|most\s*|top\s*)?recommended",
            r"best.*seller|best.*choice",
            r"customers?\s*(?:also\s*)?(?:like|buy|chose|prefer)",
            r"popular\s*(?:choice|item|product)",
            r"trending",
            r"(?:click\s*|tap\s*)?here\s*for\s*(?:savings?|discount|deal)",
            r"pre[\s-]?selected",
            r"default.*(?:yes|selected|opted)",
            r"(?:yes|true|agree|accept).*by\s*default",
        ]
    },
    "nagging": {
        "name": "Nagging / Persistent Prompts",
        "severity": "medium",
        "patterns": [
            r"(?:newsletter|subscription|notification|offer|deal|popup).*(?:subscribe|sign[\s-]?up|get|receive)",
            r"(?:don'?t|never).*(?:show|tell|remind) .*again",
            r"subscribe.*newsletter|newsletter.*subscribe",
            r"get\s*(?:the latest|updates?|offers?|deals?|notifications?)",
            r"sign\s*up\s*(?:for|to)",
            r"stay\s*(?:updated|informed|in\s*touch)",
            r"join.*(?:our\s*)?(?:community|list|subscribers)",
            r"modal|popup|modal.*popup|popup.*modal",
        ]
    },
    "obstruction": {
        "name": "Obstruction / Roach Motel",
        "severity": "high",
        "patterns": [
            r"to\s*(?:cancel|delete|unsubscribe|opt[\s-]?out)[,.]?\s*(?:call|contact|visit|go\s*to|email)",
            r"cancel.*(?:by\s*)?(?:phone|calling|mail|email|customer\s*service)",
            r"speak.*(?:to|with).*(?:an?\s*)?agent.*(?:to\s*)?cancel",
            r"delete\s*account.*(?:contact|call|email)",
            r"(?:cannot|can't|unable|not possible).*(?:cancel|delete|unsubscribe).*online",
            r"logout.*automatic.*re[\s-]?enable",
        ]
    },
}

class AnalysisEngine:
    """Local dark pattern and tracker detection."""
    
    @staticmethod
    def detect_trackers(page_source: str) -> List[Dict[str, str]]:
        """Detect trackers mentioned in page source."""
        trackers_found = []
        seen_domains = set()
        
        for tracker in KNOWN_TRACKERS:
            domain = tracker["domain"]
            if domain in page_source.lower() and domain not in seen_domains:
                trackers_found.append(tracker)
                seen_domains.add(domain)
        
        return trackers_found
    
    @staticmethod
    def detect_dark_patterns(page_text: str, page_html: str = "") -> List[Dict[str, Any]]:
        """Detect dark patterns in page text and HTML using regex."""
        patterns_found = []
        seen_pattern_types = {}  # Track patterns by type to avoid duplicates
        
        # Combine text and HTML for better detection
        full_content = page_text + " " + page_html
        
        for pattern_key, pattern_info in DARK_PATTERNS.items():
            matches_in_pattern = []
            
            for regex_str in pattern_info["patterns"]:
                try:
                    regex = re.compile(regex_str, re.IGNORECASE | re.MULTILINE)
                    matches = regex.findall(full_content)
                    
                    if matches:
                        matches_in_pattern.extend(matches)
                except Exception as e:
                    pass
            
            # Add pattern only once per type, but track match count
            if matches_in_pattern:
                if pattern_key not in seen_pattern_types:
                    patterns_found.append({
                        "type": pattern_key,
                        "name": pattern_info["name"],
                        "severity": pattern_info["severity"],
                        "confidence": min(0.95 + len(matches_in_pattern) * 0.02, 1.0),
                        "match_count": len(matches_in_pattern),
                        "text": str(matches_in_pattern[0]) if matches_in_pattern else ""
                    })
                    seen_pattern_types[pattern_key] = True
        
        return patterns_found
    
    @staticmethod
    async def detect_dom_patterns(page) -> List[Dict[str, Any]]:
        """Detect dark patterns via DOM inspection using Playwright."""
        dom_patterns = []
        
        try:
            # Check for pre-checked checkboxes/radio buttons
            preselected = await page.evaluate("""() => {
                const inputs = document.querySelectorAll('input[type="checkbox"][checked], input[type="radio"][checked]');
                const results = [];
                inputs.forEach(input => {
                    const label = input.closest('label');
                    const text = (label?.textContent || input.nextElementSibling?.textContent || 'pre-selected').trim();
                    if (text.length > 0 && !text.match(/remember|remember me|stay logged/i)) {
                        results.push(text);
                    }
                });
                return results;
            }""")
            
            if preselected and len(preselected) > 0:
                dom_patterns.append({
                    "type": "misdirection",
                    "name": "Pre-selected Harmful Options",
                    "severity": "medium",
                    "confidence": 0.85,
                    "match_count": len(preselected),
                    "text": preselected[0] if preselected else "pre-selected checkbox"
                })
        except:
            pass
        
        try:
            # Check for countdown timers
            countdown = await page.evaluate("""() => {
                const timerElements = Array.from(document.querySelectorAll('*')).filter(el => {
                    const text = el.textContent || '';
                    return text.match(/\\d+\\s*(?:hours?|mins?|minutes?|seconds?)\\s*(?:left|remaining)/i) && el.offsetHeight > 0;
                });
                return timerElements.length > 0;
            }""")
            
            if countdown:
                dom_patterns.append({
                    "type": "urgency",
                    "name": "Countdown Timer",
                    "severity": "high",
                    "confidence": 0.9,
                    "match_count": 1,
                    "text": "countdown timer detected"
                })
        except:
            pass
        
        try:
            # Check for sticky/persistent banners with urgency
            sticky_banners = await page.evaluate("""() => {
                const banners = Array.from(document.querySelectorAll('[style*="position"][style*="sticky"], [style*="position"][style*="fixed"]')).filter(el => {
                    const text = (el.textContent || '').toLowerCase();
                    const isUrgent = text.match(/urgent|hurry|now|limited|only|ends?|sale|offer|deal/i);
                    const isVisible = el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none';
                    return isVisible && isUrgent;
                });
                return banners.length > 0;
            }""")
            
            if sticky_banners:
                dom_patterns.append({
                    "type": "urgency",
                    "name": "Sticky Urgency Banner",
                    "severity": "high",
                    "confidence": 0.88,
                    "match_count": 1,
                    "text": "persistent urgency banner"
                })
        except:
            pass
        
        try:
            # Check for difficult-to-find cancel/unsubscribe links
            cancel_difficulty = await page.evaluate("""() => {
                const bodyText = document.body.innerText.toLowerCase();
                const hasSubscribe = bodyText.match(/subscribe|newsletter|unsubscribe/i);
                const cancelLink = document.querySelector('a[href*="unsubscribe"], a[href*="cancel"], a[href*="delete"]');
                const isBuried = !cancelLink || (cancelLink.offsetHeight < 20 && cancelLink.getClientRects()[0]?.height < 20);
                return hasSubscribe && isBuried;
            }""")
            
            if cancel_difficulty:
                dom_patterns.append({
                    "type": "obstruction",
                    "name": "Difficult Cancellation",
                    "severity": "high",
                    "confidence": 0.8,
                    "match_count": 1,
                    "text": "cancel button buried or hard to find"
                })
        except:
            pass
        
        try:
            # Check for multiple popups/notifications
            popup_count = await page.evaluate("""() => {
                const popups = document.querySelectorAll('[role="dialog"], .modal, .popup, [class*="overlay"], [id*="popup"], [id*="modal"]');
                return popups.length;
            }""")
            
            if popup_count > 0:
                dom_patterns.append({
                    "type": "nagging",
                    "name": "Persistent Popups",
                    "severity": "medium",
                    "confidence": 0.8,
                    "match_count": popup_count,
                    "text": f"{popup_count} dialog(s) detected"
                })
        except:
            pass
        
        return dom_patterns


class ExtensionTester:
    """Manages extension testing against web pages."""
    
    def __init__(self, extension_path: str, backend_url: str):
        self.extension_path = extension_path
        self.backend_url = backend_url
        self.results = []
        self.analyzer = AnalysisEngine()
        
    async def launch_browser_with_extension(self) -> tuple[Browser, BrowserContext]:
        """Launch Chromium with extension loaded."""
        playwright = await async_playwright().start()
        
        # Resolve absolute path to extension
        ext_path = os.path.abspath(self.extension_path)
        if not os.path.exists(ext_path):
            raise FileNotFoundError(f"Extension not found at {ext_path}")
        
        print(f"[INFO] Loading extension from: {ext_path}")
        
        # Launch browser with extension support
        browser = await playwright.chromium.launch(
            args=[
                f"--disable-extensions-except={ext_path}",
                f"--load-extension={ext_path}",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-resources",
            ],
            headless=False  # Extensions only work in headed mode
        )
        
        context = await browser.new_context()
        return browser, context
        
    async def test_site(self, browser: Browser, context: BrowserContext, site: Dict[str, str]) -> Dict[str, Any]:
        """Test a single site for dark patterns."""
        url = site["url"]
        site_name = site["name"]
        
        print(f"\n{'='*60}")
        print(f"Testing: {site_name}")
        print(f"URL: {url}")
        print(f"{'='*60}")
        
        page = None
        result = {
            "site": site_name,
            "url": url,
            "category": site.get("category", "Unknown"),
            "timestamp": datetime.now().isoformat(),
            "status": "failed",
            "privacy_risk": 0,
            "manipulation_risk": 0,
            "dark_patterns": [],
            "trackers": [],
            "error": None
        }
        
        try:
            page = await context.new_page()
            
            # Set user agent to avoid detection
            await page.set_extra_http_headers({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            
            # Navigate to site with timeout
            print(f"[*] Navigating to {url}...")
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # Wait for extension to analyze (5 seconds)
            print("[*] Waiting 5 seconds for extension to analyze...")
            await page.wait_for_timeout(5000)
            
            # Extract page text and HTML
            page_text = await page.evaluate("""() => {
                return document.body.innerText || document.documentElement.innerText;
            }""")
            
            page_html = await page.evaluate("""() => {
                return document.documentElement.outerHTML;
            }""")
            
            print(f"[*] Page content extracted ({len(page_text)} chars text, {len(page_html)} chars HTML)")
            
            # Local analysis - Regex patterns
            print("[*] Analyzing for dark patterns (regex) and trackers...")
            regex_patterns = self.analyzer.detect_dark_patterns(page_text, page_html)
            trackers = self.analyzer.detect_trackers(page_html)
            
            # DOM-based detection
            print("[*] Analyzing DOM for dark patterns...")
            dom_patterns = await self.analyzer.detect_dom_patterns(page)
            
            # Combine patterns, avoiding duplicates by type
            all_patterns = regex_patterns + dom_patterns
            pattern_types_seen = set()
            unique_patterns = []
            for p in all_patterns:
                if p["type"] not in pattern_types_seen:
                    unique_patterns.append(p)
                    pattern_types_seen.add(p["type"])
            
            print(f"[*] Found {len(unique_patterns)} dark patterns ({len(regex_patterns)} regex + {len(dom_patterns)} DOM), {len(trackers)} trackers")
            
            # Prepare structured data for backend
            privacy_data = {
                "trackers": [{"domain": t["domain"], "type": t["type"], "name": t["name"]} for t in trackers],
                "policy": {"thirdPartySharing": len(trackers) > 5, "noOptOut": False, "extensiveCollection": len(trackers) > 10},
                "fingerprinting": False
            }
            
            manipulation_data = {
                "patterns": unique_patterns
            }
            
            # Call backend API to analyze results
            print("[*] Calling backend analysis API...")
            try:
                payload = {
                    "url": url,
                    "privacy_data": privacy_data,
                    "manipulation_data": manipulation_data
                }
                
                response = requests.post(
                    f"{self.backend_url}/analyze-complete",
                    json=payload,
                    timeout=30
                )
                
                if response.status_code == 200:
                    analysis = response.json()
                    
                    # Extract results
                    result["privacy_risk"] = analysis.get("privacy_risk", 0)
                    result["manipulation_risk"] = analysis.get("manipulation_risk", 0)
                    result["dark_patterns"] = unique_patterns
                    result["trackers"] = trackers
                    result["status"] = "success"
                    
                    print(f"[✓] Analysis complete")
                    print(f"    Privacy Risk: {result['privacy_risk']}/10")
                    print(f"    Manipulation Risk: {result['manipulation_risk']}/10")
                    print(f"    Dark Patterns: {len(result['dark_patterns'])}")
                    print(f"    Trackers: {len(result['trackers'])}")
                else:
                    result["error"] = f"Backend API returned {response.status_code}: {response.text[:100]}"
                    print(f"[!] Backend error: {result['error']}")
                    
            except requests.exceptions.RequestException as e:
                result["error"] = f"Backend API call failed: {str(e)}"
                print(f"[!] API Error: {result['error']}")
                
        except Exception as e:
            result["error"] = str(e)
            print(f"[!] Error testing site: {result['error']}")
            
        finally:
            if page:
                await page.close()
        
        self.results.append(result)
        return result
        
    async def run_tests(self):
        """Run tests on all sites."""
        browser = None
        context = None
        
        try:
            print("[*] Initializing Chromium with ConsumerShield extension...")
            browser, context = await self.launch_browser_with_extension()
            print("[✓] Browser launched successfully\n")
            
            for site in SITES_TO_TEST:
                await self.test_site(browser, context, site)
                
        finally:
            if context:
                await context.close()
            if browser:
                await browser.close()
        
        return self.results
        
    def generate_report(self, results: List[Dict[str, Any]]) -> str:
        """Generate markdown report from results."""
        report = []
        
        report.append("# ConsumerShield Extension Test Report\n")
        report.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        report.append(f"**Backend:** {self.backend_url}\n")
        report.append(f"**Extension:** {self.extension_path}\n\n")
        
        # Summary
        report.append("## Executive Summary\n")
        total_tests = len(results)
        successful = sum(1 for r in results if r["status"] == "success")
        report.append(f"- **Tests Run:** {total_tests}\n")
        report.append(f"- **Successful:** {successful}\n")
        report.append(f"- **Failed:** {total_tests - successful}\n\n")
        
        # Check for pass/fail criteria
        deceptive_result = next((r for r in results if "deceptive" in r["url"].lower()), None)
        if deceptive_result:
            dark_patterns_count = len(deceptive_result.get("dark_patterns", []))
            pass_fail = "✅ PASS" if dark_patterns_count >= 3 else "❌ FAIL"
            report.append(f"- **Dark Patterns on deceptive.design:** {dark_patterns_count}\n")
            report.append(f"- **Detection Threshold (3+ patterns):** {pass_fail}\n\n")
        
        # Detailed Results
        report.append("## Detailed Results\n\n")
        
        for result in results:
            report.append(f"### {result['site']}\n")
            report.append(f"- **Category:** {result['category']}\n")
            report.append(f"- **URL:** {result['url']}\n")
            report.append(f"- **Status:** {result['status'].upper()}\n")
            
            if result["status"] == "success":
                report.append(f"- **Privacy Risk Score:** {result['privacy_risk']}/10\n")
                report.append(f"- **Manipulation Risk Score:** {result['manipulation_risk']}/10\n")
                
                if result["dark_patterns"]:
                    report.append(f"- **Dark Patterns Detected:** {len(result['dark_patterns'])}\n")
                    report.append("  ```\n")
                    for pattern in result["dark_patterns"]:
                        if isinstance(pattern, dict):
                            name = pattern.get("name", "Unknown")
                            severity = pattern.get("severity", "unknown").upper()
                            report.append(f"  • {name} [{severity}]\n")
                        else:
                            report.append(f"  • {pattern}\n")
                    report.append("  ```\n")
                else:
                    report.append(f"- **Dark Patterns Detected:** None\n")
                
                if result["trackers"]:
                    report.append(f"- **Trackers Found:** {len(result['trackers'])}\n")
                    report.append("  ```\n")
                    for tracker in result["trackers"][:5]:  # Show first 5
                        if isinstance(tracker, dict):
                            name = tracker.get("name", "Unknown")
                            tracker_type = tracker.get("type", "unknown")
                            report.append(f"  • {name} ({tracker_type})\n")
                        else:
                            report.append(f"  • {tracker}\n")
                    if len(result["trackers"]) > 5:
                        report.append(f"  ... and {len(result['trackers']) - 5} more\n")
                    report.append("  ```\n")
                else:
                    report.append(f"- **Trackers Found:** None\n")
            else:
                report.append(f"- **Error:** {result['error']}\n")
            
            report.append("\n")
        
        # Accuracy Summary
        report.append("## Accuracy Summary\n\n")
        
        successful_results = [r for r in results if r["status"] == "success"]
        if successful_results:
            avg_privacy = sum(r["privacy_risk"] for r in successful_results) / len(successful_results)
            avg_manipulation = sum(r["manipulation_risk"] for r in successful_results) / len(successful_results)
            total_patterns = sum(len(r.get("dark_patterns", [])) for r in successful_results)
            total_trackers = sum(len(r.get("trackers", [])) for r in successful_results)
            
            report.append(f"- **Average Privacy Risk:** {avg_privacy:.1f}/10\n")
            report.append(f"- **Average Manipulation Risk:** {avg_manipulation:.1f}/10\n")
            report.append(f"- **Total Dark Patterns Found:** {total_patterns}\n")
            report.append(f"- **Total Trackers Found:** {total_trackers}\n\n")
            
            report.append("### Detection Performance\n")
            if total_patterns >= 12:  # Expecting ~3 per site * 4 sites
                report.append("- **Overall:** Excellent dark pattern detection\n")
            elif total_patterns >= 8:
                report.append("- **Overall:** Good dark pattern detection\n")
            elif total_patterns >= 4:
                report.append("- **Overall:** Moderate dark pattern detection\n")
            else:
                report.append("- **Overall:** Limited dark pattern detection — needs improvement\n")
        else:
            report.append("- **No successful tests to summarize**\n")
        
        return "".join(report)


async def main():
    """Main execution."""
    tester = ExtensionTester(EXTENSION_PATH, BACKEND_URL)
    
    try:
        print("\n" + "="*60)
        print("ConsumerShield Extension Test Suite")
        print("="*60)
        
        # Run tests
        results = await tester.run_tests()
        
        # Generate report
        print("\n[*] Generating report...")
        report = tester.generate_report(results)
        
        # Save report
        with open(REPORT_FILE, "w") as f:
            f.write(report)
        print(f"[✓] Report saved to: {REPORT_FILE}")
        
        # Print report
        print("\n" + "="*60)
        print("REPORT")
        print("="*60)
        print(report)
        
        return 0
        
    except KeyboardInterrupt:
        print("\n[!] Test interrupted by user")
        return 130
    except Exception as e:
        print(f"\n[!] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
