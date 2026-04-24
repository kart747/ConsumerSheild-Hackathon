/**
 * ConsumerShield — Background Service Worker (MV3)
 * Handles: message routing, dual risk calculation, storage, badge updates, backend relay
 */

// ═══════════════════════════════════════════════════════════════════════════
// Dual Risk Calculator (inline — cannot import from service worker easily)
// ═══════════════════════════════════════════════════════════════════════════

function calculatePrivacyRisk(privacyData) {
  let score = 0;
  const trackerCount = (privacyData.trackers || []).length;
  if (trackerCount >= 10) score += 4;
  else if (trackerCount >= 6) score += 3;
  else if (trackerCount >= 3) score += 2;
  else if (trackerCount >= 1) score += 1;

  if (privacyData.policy?.thirdPartySharing) score += 1.5;
  if (privacyData.policy?.noOptOut) score += 1.5;
  if (privacyData.policy?.extensiveCollection) score += 1;
  if (privacyData.fingerprinting) score += 2;

  return Math.min(10, parseFloat(score.toFixed(1)));
}

function calculateManipulationRisk(manipulationData) {
  const weights = { low: 0.8, medium: 2.0, high: 4.0 };
  let score = 0;
  (manipulationData.patterns || []).forEach(p => {
    score += (weights[p.severity] || 0.8) * (p.confidence || 1.0);
  });
  return Math.min(10, parseFloat(score.toFixed(1)));
}

function getRiskLevel(score) {
  if (score >= 8.5) return 'CRITICAL';
  if (score >= 6.5) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score >= 2.0) return 'LOW';
  return 'SAFE';
}

function generateInsight(analysis) {
  const p = analysis.overall.privacyRisk;
  const m = analysis.overall.manipulationRisk;
  const trackers = analysis.privacy.trackers.length;
  const patterns = analysis.manipulation.patterns.length;

  if (p >= 7 && m >= 7) {
    return `🚨 Exploits you on BOTH fronts — ${trackers} trackers + ${patterns} dark patterns. Violates DPDP Act 2023 & CCPA 2023.`;
  }
  if (p >= 6.5) {
    return `⚠️ ${trackers} trackers detected. Data sharing without clear consent. Potential DPDP Act 2023 violation.`;
  }
  if (m >= 6.5) {
    return `⚠️ ${patterns} dark pattern(s) detected. Psychological manipulation found. CCPA Guidelines 2023 violation.`;
  }
  if (trackers === 0 && patterns === 0) {
    return '✅ No major privacy violations or dark patterns detected.';
  }
  return `ℹ️ ${trackers} tracker(s) and ${patterns} concern(s) found. Check the Privacy and Manipulation tabs.`;
}

function getBadgeColor(level) {
  const colors = {
    CRITICAL: '#ef4444',
    HIGH: '#f97316',
    MEDIUM: '#eab308',
    LOW: '#22c55e',
    SAFE: '#6ee7b7',
  };
  return colors[level] || '#6ee7b7';
}

// ═══════════════════════════════════════════════════════════════════════════
// Normalize domain
// ═══════════════════════════════════════════════════════════════════════════

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function mergeStoredAnalysis(domain, patch) {
  chrome.storage.local.get([domain], (result) => {
    const stored = result[domain] || {};
    chrome.storage.local.set({
      [domain]: {
        ...stored,
        ...patch,
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Backend relay (optional — gracefully skips if not available)
// ═══════════════════════════════════════════════════════════════════════════

const BACKEND_URLS = [
  'http://127.0.0.1:8012',
  'http://localhost:8012',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
];
const BACKEND_URL_KEY = 'consumershield_backend_url';
const EXTENSION_ENABLED_KEY = 'consumershield_enabled';
const tabTraffic = new Map();
const auditTimers = new Map();
let extensionEnabled = true;
let healthyBackendBase = null;
let configuredBackendUrl = '';

chrome.storage.local.get([EXTENSION_ENABLED_KEY, BACKEND_URL_KEY], (result) => {
  if (typeof result[EXTENSION_ENABLED_KEY] === 'boolean') {
    extensionEnabled = result[EXTENSION_ENABLED_KEY];
  } else {
    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: true });
  }
  configuredBackendUrl = String(result[BACKEND_URL_KEY] || '').trim();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([EXTENSION_ENABLED_KEY], (result) => {
    if (typeof result[EXTENSION_ENABLED_KEY] !== 'boolean') {
      chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: true });
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[EXTENSION_ENABLED_KEY]) {
    extensionEnabled = Boolean(changes[EXTENSION_ENABLED_KEY].newValue);
  }
  if (changes[BACKEND_URL_KEY]) {
    configuredBackendUrl = String(changes[BACKEND_URL_KEY].newValue || '').trim();
    healthyBackendBase = null;
  }
});

function getBackendUrls() {
  if (configuredBackendUrl) {
    return [configuredBackendUrl, ...BACKEND_URLS.filter((url) => url !== configuredBackendUrl)];
  }
  return [...BACKEND_URLS];
}

async function sendToBackend(analysis) {
  const savePayload = buildReportSavePayload(analysis);

  try {
    const backendResult = await fetchBackendJson('/analyze-complete', {
      method: 'POST',
      body: {
        url: analysis.url,
        privacy_data: analysis.privacy,
        manipulation_data: analysis.manipulation,
      },
      // Anchoring and AI analysis can take >5s.
      timeoutMs: 30000,
    });

    // Merge AI insight and regulatory violations from backend
    const domain = normalizeDomain(analysis.url);
    mergeStoredAnalysis(domain, {
      aiInsight: backendResult.combined_insight,
      regulatoryViolations: backendResult.regulatory_violations,
      backendAnalyzed: true,
    });
  } catch (error) {
    // If deep analysis fails, still persist the report for wall-of-shame and audit history.
    if (!savePayload) return;

    try {
      await fetchBackendJson('/reports/save', {
        method: 'POST',
        body: savePayload,
        timeoutMs: 12000,
      });
    } catch (saveError) {
      console.warn('[ConsumerShield] Unable to persist report to backend', {
        analyzeError: String(error),
        saveError: String(saveError),
      });
    }
  }
}

function normalizeRiskScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(10, Number(parsed.toFixed(1))));
}

function buildReportSavePayload(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;

  const url = String(analysis.url || '').trim();
  if (!url) return null;

  const privacyRisk = normalizeRiskScore(
    analysis?.privacy?.riskScore ?? analysis?.overall?.privacyRisk
  );
  const manipulationRisk = normalizeRiskScore(
    analysis?.manipulation?.riskScore ?? analysis?.overall?.manipulationRisk
  );
  const overallRisk = normalizeRiskScore(
    analysis?.overall?.riskScore ?? Math.max(privacyRisk, manipulationRisk)
  );

  const patterns = Array.isArray(analysis?.manipulation?.patterns)
    ? analysis.manipulation.patterns
    : [];
  const patternNames = [...new Set(
    patterns
      .map((pattern) => String(pattern?.name || pattern?.type || '').trim())
      .filter(Boolean)
  )];

  const trackerCount = Array.isArray(analysis?.privacy?.trackers)
    ? analysis.privacy.trackers.length
    : 0;

  return {
    url,
    domain: String(analysis.domain || normalizeDomain(url) || '').trim() || null,
    privacy_risk: privacyRisk,
    manipulation_risk: manipulationRisk,
    overall_risk: overallRisk,
    pattern_names: patternNames,
    tracker_count: trackerCount,
    combined_insight: String(analysis.aiInsight || analysis?.overall?.insight || '').trim() || null,
    anchor_on_save: true,
  };
}

async function fetchBackendJson(path, { method = 'GET', body = null, timeoutMs = 5000 } = {}) {
  const configuredCandidates = getBackendUrls();
  const candidates = healthyBackendBase
    ? [healthyBackendBase, ...configuredCandidates.filter((url) => url !== healthyBackendBase)]
    : configuredCandidates;

  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const requestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      };

      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && timeoutMs > 0) {
        requestInit.signal = AbortSignal.timeout(timeoutMs);
      }

      const response = await fetch(`${baseUrl}${path}`, requestInit);

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      healthyBackendBase = baseUrl;
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to reach backend API');
}

async function fetchDomainIntelligence(detectedDomains, currentTabDomain) {
  try {
    return await fetchBackendJson('/analyze-domains', {
      method: 'POST',
      body: {
        domains: detectedDomains,
        first_party_domain: currentTabDomain,
      },
      timeoutMs: 7000,
    });
  } catch {
    return null;
  }
}

function mapDomainIntelligenceToTrackers(domainIntelligence, fallbackDomains = []) {
  if (Array.isArray(domainIntelligence?.trackers)) {
    return domainIntelligence.trackers;
  }

  const resolved = Array.isArray(domainIntelligence?.resolved_trackers)
    ? domainIntelligence.resolved_trackers
    : [];

  const mapped = resolved
    .map((item) => {
      const domain = normalizeDomain(item?.domain || '');
      if (!domain) return null;

      const categories = Array.isArray(item?.categories) ? item.categories : [];
      const type = String(categories[0] || 'tracker').trim().toLowerCase() || 'tracker';
      const name = String(item?.entity || item?.matched_domain || domain).trim() || domain;

      return { domain, type, name };
    })
    .filter(Boolean);

  if (mapped.length) {
    return mapped;
  }

  return (Array.isArray(fallbackDomains) ? fallbackDomains : [])
    .map((d) => normalizeDomain(d))
    .filter(Boolean)
    .map((d) => ({ domain: d, type: 'unknown', name: d.split('.')[0] || d }));
}

function getOrCreateTrafficState(tabId, firstPartyDomain = '') {
  let state = tabTraffic.get(tabId);
  if (!state) {
    state = {
      firstPartyDomain,
      allDetectedDomains: new Set(),
      totalRequestCount: 0,
    };
    tabTraffic.set(tabId, state);
  } else if (firstPartyDomain) {
    state.firstPartyDomain = firstPartyDomain;
  }
  return state;
}

function persistTrafficSnapshot(firstPartyDomain, state) {
  if (!firstPartyDomain || !state) return;
  mergeStoredAnalysis(firstPartyDomain, {
    domain: firstPartyDomain,
    network_activity: {
      live_monitor: true,
      total_request_count: state.totalRequestCount,
      unique_domain_count: state.allDetectedDomains.size,
      raw_domains: Array.from(state.allDetectedDomains).sort(),
      updated_at: Date.now(),
    },
  });
}

async function auditTrafficState(tabId) {
  const state = tabTraffic.get(tabId);
  if (!state?.firstPartyDomain) return;

  const domains = Array.from(state.allDetectedDomains);
  const domainIntelligence = await fetchDomainIntelligence(domains, state.firstPartyDomain);
  if (!domainIntelligence) return;

  mergeStoredAnalysis(state.firstPartyDomain, {
    domain_analysis: domainIntelligence,
  });
}

function scheduleTrafficAudit(tabId) {
  if (auditTimers.has(tabId)) {
    clearTimeout(auditTimers.get(tabId));
  }

  const timer = setTimeout(() => {
    auditTimers.delete(tabId);
    auditTrafficState(tabId).catch(() => {});
  }, 1200);

  auditTimers.set(tabId, timer);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!extensionEnabled) return;
    if (details.tabId < 0) return;

    const requestDomain = normalizeDomain(details.url);
    if (!requestDomain) return;

    if (details.type === 'main_frame') {
      const state = getOrCreateTrafficState(details.tabId, requestDomain);
      state.firstPartyDomain = requestDomain;
      state.allDetectedDomains.clear();
      state.totalRequestCount = 0;
      persistTrafficSnapshot(requestDomain, state);
      return;
    }

    const initiatorDomain = normalizeDomain(details.initiator || details.documentUrl || '');
    const state = getOrCreateTrafficState(details.tabId, initiatorDomain);
    const currentTabDomain = state.firstPartyDomain || initiatorDomain;

    if (!currentTabDomain || requestDomain === currentTabDomain) return;

    state.totalRequestCount += 1;
    const beforeSize = state.allDetectedDomains.size;
    state.allDetectedDomains.add(requestDomain);

    persistTrafficSnapshot(currentTabDomain, state);

    if (state.allDetectedDomains.size !== beforeSize) {
      scheduleTrafficAudit(details.tabId);
    }
  },
  { urls: ['<all_urls>'] }
);

// ═══════════════════════════════════════════════════════════════════════════
// Message handler
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[ConsumerShield] Background received action:', request.action);

  if (request.action === 'getNetworkTrackers') {
    const tabId = sender.tab?.id;
    const traffic = typeof tabId === 'number' ? tabTraffic.get(tabId) : null;
    sendResponse({
      trackers: traffic?.allDetectedDomains ? Array.from(traffic.allDetectedDomains) : [],
    });
    return true;
  }

  if (request.action === 'setExtensionEnabled') {
    extensionEnabled = Boolean(request.enabled);
    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: extensionEnabled }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (typeof tab.id !== 'number') return;
          if (!extensionEnabled) {
            chrome.action.setBadgeText({ text: '', tabId: tab.id }).catch(() => {});
          }
          chrome.tabs.sendMessage(tab.id, {
            action: 'extensionEnabledChanged',
            enabled: extensionEnabled,
          }).catch(() => {});
        });
      });
      sendResponse({ success: true, enabled: extensionEnabled });
    });
    return true;
  }
  if (request.action === 'analyzeComplete') {
    if (!extensionEnabled) {
      if (sender.tab?.id) {
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id }).catch(() => {});
      }
      sendResponse({ success: true, skipped: true, reason: 'disabled' });
      return true;
    }

    const data = request.data;
    const domain = normalizeDomain(data.url);
    const fallbackDetectedDomains = [...new Set(
      (data.privacy?.trackers || [])
        .map(t => normalizeDomain(t.domain))
        .filter(Boolean)
    )];
    const tabId = sender.tab?.id;
    const trafficState = typeof tabId === 'number' ? tabTraffic.get(tabId) : null;
    const detectedDomains = trafficState?.allDetectedDomains?.size
      ? Array.from(trafficState.allDetectedDomains)
      : fallbackDetectedDomains;
    const currentTabDomain = trafficState?.firstPartyDomain || domain;

    // Resolve domains into tracker entities using the backend schema.
    const domainsToAnalyze = (Array.isArray(data.privacy?.detectedDomains) && data.privacy.detectedDomains.length)
      ? data.privacy.detectedDomains
      : detectedDomains;
    
    // Default trackers if backend is unavailable
    let resolvedTrackers = [];
    
    fetchBackendJson('/analyze-domains', {
      method: 'POST',
      body: {
        domains: domainsToAnalyze,
        first_party_domain: currentTabDomain,
      },
      timeoutMs: 7000,
    })
    .then(backendData => {
      resolvedTrackers = mapDomainIntelligenceToTrackers(backendData, domainsToAnalyze);
      finishAnalysis(resolvedTrackers);
    })
    .catch(err => {
      console.warn('[ConsumerShield] Backend tracker resolution failed or timed out', err);
      // Fallback to extraction of basic domains if resolution fails
      const fallbackTrackers = domainsToAnalyze.map(d => ({ domain: d, type: 'unknown', name: d.split('.')[0] }));
      finishAnalysis(fallbackTrackers);
    });

    function finishAnalysis(trackers) {
      // Replace raw domains with resolved trackers
      data.privacy.trackers = trackers;
      
      const privacyRisk = calculatePrivacyRisk(data.privacy);
      const manipulationRisk = calculateManipulationRisk(data.manipulation);
      
      // FORMULA: Use MAX of both risks
      const overallRisk = Math.max(privacyRisk, manipulationRisk);
      const overallLevel = getRiskLevel(overallRisk);

    const analysis = {
      domain,
      url: data.url,
      timestamp: data.timestamp,
      privacy: {
        ...data.privacy,
        riskScore: privacyRisk,
        riskLevel: getRiskLevel(privacyRisk),
      },
      manipulation: {
        ...data.manipulation,
        riskScore: manipulationRisk,
        riskLevel: getRiskLevel(manipulationRisk),
      },
      overall: {
        riskScore: overallRisk,
        riskLevel: overallLevel,
        privacyRisk,
        manipulationRisk,
        totalViolations: data.privacy.trackers.length + data.manipulation.patterns.length,
        insight: '',
      },
    };

    analysis.overall.insight = generateInsight(analysis);

    if (trafficState) {
      persistTrafficSnapshot(currentTabDomain, trafficState);
    }

    // Persist to storage without losing live traffic/domain audit data
    mergeStoredAnalysis(domain, analysis);

    // Deep-dive audit should use the full observed domain list
    if (typeof tabId === 'number' && trafficState) {
      scheduleTrafficAudit(tabId);
    } else {
      fetchDomainIntelligence(detectedDomains, currentTabDomain)
        .then((domainIntelligence) => {
          if (!domainIntelligence) return;
          mergeStoredAnalysis(domain, { domain_analysis: domainIntelligence });
        })
        .catch(() => {});
    }

    // Update badge on the tab
    if (tabId) {
      const badgeText = overallRisk > 0 ? overallRisk.toFixed(1) : '';
      chrome.action.setBadgeText({ text: badgeText, tabId });
      chrome.action.setBadgeBackgroundColor({ color: getBadgeColor(overallLevel), tabId });
    }

      // Optionally enrich with backend AI
      sendToBackend(analysis).catch(() => {});

      sendResponse({ success: true, domain });
    }
    
    return true; // Keep message channel open for async fetch
  }

  if (request.action === 'getAnalysis') {
    const domain = request.domain;
    chrome.storage.local.get([domain], (result) => {
      sendResponse({ analysis: result[domain] || null });
    });
    return true; // async
  }

  return true;
});

// Clear badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});

    if (auditTimers.has(tabId)) {
      clearTimeout(auditTimers.get(tabId));
      auditTimers.delete(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabTraffic.delete(tabId);
  if (auditTimers.has(tabId)) {
    clearTimeout(auditTimers.get(tabId));
    auditTimers.delete(tabId);
  }
});
