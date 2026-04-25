/**
 * ConsumerShield popup script.
 * Renders privacy, manipulation, and overview panels from stored analysis.
 */

const SEVERITY_ICONS = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

const TRACKER_ICONS = {
  analytics: '📊',
  advertising: '📣',
  social: '👥',
  data_broker: '🗃️',
  tracker: '🛰️',
};

const BERT_LABEL_MAP = {
  label_0: 'No dark pattern',
  label_1: 'Dark pattern detected',
  dark_pattern: 'Dark pattern detected',
  not_dark_pattern: 'No dark pattern',
  'not-dark-pattern': 'No dark pattern',
};

const REPORT_PAGE_URL = chrome.runtime.getURL('report.html');
import lawMapping from './utils/lawMapping.js';
import { generateComplaintPDF } from './utils/generatePDF.js';
const EXTENSION_ENABLED_KEY = 'consumershield_enabled';
const BACKEND_URL_KEY = 'consumershield_backend_url';
const BACKEND_DEFAULT_URLS = [
  'http://127.0.0.1:8012',
  'http://localhost:8012',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
];
const MANIPULATION_CONFIDENCE_FLOOR = 0.6;
const DEBUG_MODE_KEY = 'consumershield_debug_mode';
const DEBUG_FILTERED_PATTERNS_PREFIX = 'consumershield_debug_filtered_patterns:';
let popupRefreshAttempted = false;
let extensionEnabled = true;
let activeRenderRequestId = 0;
let debugModeEnabled = false;

document.addEventListener('DOMContentLoaded', async () => {
  chrome.tabs.onActivated.addListener(() => {
    popupRefreshAttempted = false;
  });
  await initializeProtectionToggle();
  await initializeDebugToggle();
  setupTabs();
  setupActions();
  await loadAndRender();
});

function getDebugPatternStorageKey(domain) {
  return `${DEBUG_FILTERED_PATTERNS_PREFIX}${domain}`;
}

function withConfidenceFloor(patterns) {
  return (Array.isArray(patterns) ? patterns : []).filter((pattern) => {
    const confidence = Number(pattern?.confidence ?? 0);
    return confidence >= MANIPULATION_CONFIDENCE_FLOOR;
  });
}

async function initializeDebugToggle() {
  const toggle = document.getElementById('toggle-debug-mode');
  if (!(toggle instanceof HTMLInputElement)) return;

  const data = await new Promise((resolve) => {
    chrome.storage.local.get([DEBUG_MODE_KEY], resolve);
  });

  debugModeEnabled = Boolean(data?.[DEBUG_MODE_KEY]);
  toggle.checked = debugModeEnabled;

  toggle.addEventListener('change', async (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    debugModeEnabled = Boolean(target.checked);
    chrome.storage.local.set({ [DEBUG_MODE_KEY]: debugModeEnabled });
    await loadAndRender();
  });
}

function renderFilteredPatternDebug(domain) {
  const debugContainer = document.getElementById('debug-filtered-list');
  if (!debugContainer) return;

  if (!debugModeEnabled || !domain) {
    debugContainer.style.display = 'none';
    debugContainer.innerHTML = '';
    return;
  }

  const debugKey = getDebugPatternStorageKey(domain);
  chrome.storage.local.get([debugKey], (result) => {
    const payload = result?.[debugKey] || {};
    const filtered = Array.isArray(payload?.filtered_patterns) ? payload.filtered_patterns : [];

    if (filtered.length === 0) {
      debugContainer.style.display = 'block';
      debugContainer.innerHTML = '<div class="debug-filtered-title">Filtered by precision rules</div><div class="empty-state">No filtered patterns for this page.</div>';
      return;
    }

    debugContainer.style.display = 'block';
    debugContainer.innerHTML = `
      <div class="debug-filtered-title">Filtered by precision rules (${filtered.length})</div>
      ${filtered.slice(0, 20).map((item) => `
        <div class="debug-filtered-card">
          <div class="debug-filtered-name">${escHtml(item?.name || item?.type || 'Pattern')}</div>
          <div class="debug-filtered-reason">Reason: ${escHtml(item?.filtered_reason || 'filtered')}</div>
          ${item?.text ? `<div class="debug-filtered-snippet">${escHtml(String(item.text).slice(0, 120))}</div>` : ''}
        </div>
      `).join('')}
    `;
  });
}

function normalizeComplaintIssueName(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();

  if (/hidden|charge|price|cost/.test(lower)) return 'Hidden Charges';
  if (/subscription|continuity|renewal/.test(lower)) return 'Subscription Trap';
  if (/dark|pattern|manipulative/.test(lower)) return 'Dark Patterns';
  if (/privacy|data|tracking/.test(lower)) return 'Data Privacy Violation';
  return raw.replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function collectComplaintIssues(analysis) {
  const patterns = Array.isArray(analysis?.manipulation?.patterns) ? analysis.manipulation.patterns : [];
  const items = patterns
    .map((pattern) => pattern.name || pattern.type || '')
    .filter(Boolean)
    .map(normalizeComplaintIssueName);

  if (items.length) {
    return [...new Set(items)];
  }

  const fallback = [];
  if (analysis?.privacy?.policy?.thirdPartySharing) fallback.push('Hidden Charges');
  if (analysis?.privacy?.trackers?.length) fallback.push('Data Privacy Violation');

  return fallback.length ? [...new Set(fallback)] : ['No detected issues yet'];
}

function buildComplaintLaws(issues) {
  const laws = new Set();
  issues.forEach((issue) => {
    const mapped = lawMapping[issue];
    if (Array.isArray(mapped)) {
      mapped.forEach((law) => laws.add(law));
    }
  });
  return [...laws];
}

function buildComplaintEvidence(analysis) {
  const patterns = Array.isArray(analysis?.manipulation?.patterns) ? analysis.manipulation.patterns : [];
  const evidence = patterns
    .map((pattern) => pattern.name || pattern.description || pattern.type)
    .filter(Boolean)
    .join(' | ');
  return evidence || 'Detected via extension. Evidence is based on page analysis and browser scan results.';
}

function calculateRiskScore(analysis) {
  if (!analysis) return 0;
  const privacyScore = Number(analysis.privacy?.riskScore || 0);
  const manipulationScore = Number(analysis.manipulation?.riskScore || 0);
  const score = Math.max(privacyScore, manipulationScore, 0);
  return Math.round(Math.max(0, Math.min(10, score)) * 10);
}

function complaintSeverity(score) {
  if (score <= 40) return 'Low';
  if (score <= 70) return 'Medium';
  return 'High';
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((node) => node.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((node) => node.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-content-${tab.dataset.tab}`)?.classList.add('active');
    });
  });
}

function setupActions() {
  document.getElementById('toggle-protection')?.addEventListener('change', async (event) => {
    const toggle = event.currentTarget;
    if (!(toggle instanceof HTMLInputElement)) return;

    extensionEnabled = Boolean(toggle.checked);
    popupRefreshAttempted = false;
    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: extensionEnabled });
    notifyExtensionEnabledChange(extensionEnabled);
    renderProtectionState();

    if (extensionEnabled) {
      await loadAndRender();
    }
  });

  document.getElementById('btn-rescan')?.addEventListener('click', async () => {
    if (!extensionEnabled) {
      alert('Protection is OFF. Turn it ON to rescan.');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const domain = normalizeDomain(tab.url);
    await chrome.storage.local.remove([domain]);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    setTimeout(loadAndRender, 1500);
  });

  const generateButton = document.getElementById('btn-generate');
  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      if (!extensionEnabled) {
        alert('Protection is OFF. Turn it ON to generate a complaint.');
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      const domain = normalizeDomain(tab.url);
      chrome.storage.local.get([domain], async (result) => {
        const analysis = result[domain];
        if (!analysis) {
          alert('No analysis available yet. Rescan the page first.');
          return;
        }

        const issues = collectComplaintIssues(analysis);
        const laws = buildComplaintLaws(issues);
        const company = tab.title || domain || 'Website';
        const pdfData = {
          name: 'Anonymous',
          company,
          analysis,
          issues: issues.filter((item) => item !== 'No detected issues yet'),
          laws,
          severity: complaintSeverity(calculateRiskScore(analysis)),
          evidence: buildComplaintEvidence(analysis),
        };

        console.debug('Complaint PDF generation data:', pdfData);

        try {
          await generateComplaintPDF(pdfData);
          showToast('Complaint PDF generated and downloaded successfully.');
        } catch (error) {
          console.error('Complaint PDF generation failed:', error);
          alert('Unable to generate the complaint PDF. See the extension console for details.');
        }
      });
    });
    console.debug('Generate Complaint button handler attached');
  } else {
    console.warn('Generate Complaint button not found in popup DOM');
  }

  document.getElementById('btn-report')?.addEventListener('click', async () => {
    if (!extensionEnabled) {
      alert('Protection is OFF. Turn it ON to generate a report.');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const domain = normalizeDomain(tab.url);
    chrome.storage.local.get([domain], (result) => {
      const analysis = result[domain];
      if (!analysis) {
        alert('No analysis available yet. Rescan the page first.');
        return;
      }

      chrome.storage.local.set({ consumershield_last_report: analysis }, () => {
        chrome.tabs.create({ url: REPORT_PAGE_URL });
      });
    });
  });
}

async function initializeProtectionToggle() {
  const toggle = document.getElementById('toggle-protection');
  if (!(toggle instanceof HTMLInputElement)) return;

  const data = await new Promise((resolve) => {
    chrome.storage.local.get([EXTENSION_ENABLED_KEY], resolve);
  });

  if (typeof data[EXTENSION_ENABLED_KEY] === 'boolean') {
    extensionEnabled = data[EXTENSION_ENABLED_KEY];
  } else {
    extensionEnabled = true;
    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: true });
  }

  toggle.checked = extensionEnabled;
  renderProtectionState();
}

function notifyExtensionEnabledChange(enabled) {
  chrome.runtime.sendMessage({ action: 'setExtensionEnabled', enabled }, () => {
    if (chrome.runtime.lastError) {
      // Background may be restarting. Ignore transient messaging failures.
    }
  });
}

function showToast(message) {
  const toast = document.getElementById('toast-message');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('toast-visible');

  window.clearTimeout(showToast.hideTimeout);
  showToast.hideTimeout = window.setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, 3200);
}

function renderProtectionState() {
  const icon = document.getElementById('protection-power-icon');
  const toggleWrap = document.querySelector('.protection-toggle');
  const scanning = document.getElementById('scanning-indicator');
  const rescanButton = document.getElementById('btn-rescan');
  const reportButton = document.getElementById('btn-report');

  if (icon) {
    icon.style.opacity = extensionEnabled ? '1' : '0.9';
  }
  if (toggleWrap) {
    toggleWrap.classList.toggle('off', !extensionEnabled);
    toggleWrap.setAttribute('title', extensionEnabled ? 'Protection ON' : 'Protection OFF');
  }
  if (scanning) {
    scanning.classList.toggle('hidden', !extensionEnabled);
  }
  if (rescanButton instanceof HTMLButtonElement) {
    rescanButton.disabled = !extensionEnabled;
  }
  if (reportButton instanceof HTMLButtonElement) {
    reportButton.disabled = !extensionEnabled;
  }
  if (!extensionEnabled) {
    setText('overall-insight', 'Protection is OFF. Turn it ON to scan this page again.');
  }
}

async function captureVisibleScreenshot(tab) {
  if (!tab || typeof tab.windowId !== 'number') return null;
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch {
    return null;
  }
}

async function collectDomSnapshot(tabId) {
  if (typeof tabId !== 'number') {
    return { dom_text: '', aria_text: '' };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const bodyText = (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 12000);

        const interactive = Array.from(document.querySelectorAll('[aria-label], button, a, [role="button"], input[type="button"], input[type="submit"]'))
          .slice(0, 140);

        const lines = interactive
          .map((el) => {
            const tag = (el.tagName || '').toLowerCase();
            const role = el.getAttribute('role') || tag;
            const aria = (el.getAttribute('aria-label') || '').trim();
            const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const joined = [role, aria, text].filter(Boolean).join(' | ');
            return joined;
          })
          .filter(Boolean)
          .slice(0, 120);

        return {
          dom_text: bodyText,
          aria_text: lines.join('\n').slice(0, 7000),
        };
      },
    });

    return results?.[0]?.result || { dom_text: '', aria_text: '' };
  } catch {
    return { dom_text: '', aria_text: '' };
  }
}

async function collectForensicMedia(tab) {
  const [screenshotDataUrl, domSnapshot] = await Promise.all([
    captureVisibleScreenshot(tab),
    collectDomSnapshot(tab?.id),
  ]);

  return {
    screenshot_data_url: screenshotDataUrl || null,
    dom_text: domSnapshot?.dom_text || '',
    aria_text: domSnapshot?.aria_text || '',
  };
}

async function getBackendCandidates() {
  const result = await new Promise((resolve) => {
    chrome.storage.local.get([BACKEND_URL_KEY], resolve);
  });
  const configured = String(result?.[BACKEND_URL_KEY] || '').trim();
  if (configured) {
    return [configured, ...BACKEND_DEFAULT_URLS.filter((url) => url !== configured)];
  }
  return [...BACKEND_DEFAULT_URLS];
}

async function fetchBackendJson(path, payload, timeoutMs = 12000) {
  const candidates = await getBackendCandidates();
  let lastError = null;

  for (const baseUrl of candidates) {
    try {
      const requestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        requestInit.signal = AbortSignal.timeout(timeoutMs);
      }

      const response = await fetch(`${baseUrl}${path}`, requestInit);
      if (!response.ok) {
        throw new Error(`Backend returned status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to reach backend API');
}

async function displayAIInsight(tab, trackers, patterns) {
  const url = tab?.url || '';
  let insightBox = document.getElementById('ai-insight-box');
  if (!insightBox) {
    insightBox = document.createElement('div');
    insightBox.id = 'ai-insight-box';
    insightBox.style.cssText = 'background: #1e1e2e; color: #e2e8f0; border-left: 4px solid #6366f1; padding: 12px; margin-top: 15px; font-size: 13px; border-radius: 6px; line-height: 1.5; word-wrap: break-word; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
    insightBox.innerHTML = '🤖 <strong>AI Insight:</strong> Analyzing...';
    (document.getElementById('tab-content-overview') || document.body).appendChild(insightBox);
  }

  try {
    const forensicMedia = await collectForensicMedia(tab);
    const data = await fetchBackendJson('/analyze-complete', {
        url,
        privacy_data: { trackers: trackers || [], fingerprinting: false },
        manipulation_data: { patterns: patterns || [] },
        screenshot_data_url: forensicMedia.screenshot_data_url,
        dom_text: forensicMedia.dom_text,
        aria_text: forensicMedia.aria_text,
      }, 15000);

    const aiDetails = data?.ai_details || {};
    const geminiText = aiDetails.gemini_insight;
    const geminiStatus = aiDetails.gemini_status;
    const bert = aiDetails.bert_classification;
    const tier3 = Array.isArray(aiDetails.tier3_patterns) ? aiDetails.tier3_patterns : [];
    const fallbackSummary = aiDetails.combined_summary || data.combined_insight || 'No insight generated.';

    const geminiBlock = geminiText
      ? `🤖 <strong>Gemini:</strong> ${escHtml(geminiText)}`
      : `🤖 <strong>Gemini:</strong> ${escHtml(geminiStatus || 'Unavailable for this request.')}`;

    let bertBlock = '🧠 <strong>BERT:</strong> No dark-pattern sample available for classification.';
    if (bert && (bert.label || bert.confidence !== undefined)) {
      const rawLabel = String(bert.label || 'unknown');
      const displayLabel = BERT_LABEL_MAP[rawLabel.trim().toLowerCase()] || rawLabel.replace(/_/g, ' ');
      const conf = Number(bert.confidence || 0);
      const isNegativeLabel = /not[\s_-]*dark[\s_-]*pattern/i.test(rawLabel);
      if (isNegativeLabel && tier3.length > 0) {
        bertBlock = `🧠 <strong>BERT:</strong> Inconclusive against UI evidence (${conf.toFixed(1)}%)`;
      } else {
        bertBlock = `🧠 <strong>BERT:</strong> ${escHtml(displayLabel)} (${conf.toFixed(1)}%)`;
      }
    }

    const summaryBlock = !geminiText
      ? `<div style="margin-top:8px;opacity:0.9;">⚖️ <strong>Risk Summary:</strong> ${escHtml(fallbackSummary)}</div>`
      : '';

    const severityColor = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#10b981' };
    const tier3Block = tier3.length > 0
      ? `<div style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;">
           <div style="font-size:12px;font-weight:700;letter-spacing:.05em;opacity:.7;margin-bottom:6px;">
             🔍 FORENSIC AUDIT — TIER 3 DARK PATTERNS
           </div>
           ${tier3.map(p => {
             const col = severityColor[String(p.severity || '').toUpperCase()] || '#6366f1';
             return `<div style="margin-top:6px;padding:8px 10px;background:rgba(255,255,255,0.04);border-left:3px solid ${col};border-radius:4px;">
               <div style="font-size:12px;font-weight:600;">${escHtml(p.pattern_name || 'Unknown')}
                 <span style="color:${col};margin-left:6px;font-size:11px;">${escHtml(p.severity || '')}</span>
               </div>
               ${p.evidence_text ? `<div style="font-size:11px;margin-top:3px;opacity:.85;">📝 ${escHtml(p.evidence_text)}</div>` : ''}
               ${p.visual_proof ? `<div style="font-size:11px;margin-top:2px;opacity:.75;">👁 ${escHtml(p.visual_proof)}</div>` : ''}
               ${p.legal_violation ? `<div style="font-size:11px;margin-top:2px;color:#a5b4fc;">⚖️ ${escHtml(p.legal_violation)}</div>` : ''}
             </div>`;
           }).join('')}
         </div>`
      : (geminiText ? `<div style="margin-top:8px;font-size:11px;opacity:.6;">✅ No Tier 3 dark patterns flagged by forensic audit.</div>` : '');

    insightBox.innerHTML = `
      <div><strong>AI Insight</strong></div>
      <div style="margin-top:6px;">${geminiBlock}</div>
      <div style="margin-top:6px;">${bertBlock}</div>
      ${summaryBlock}
      ${tier3Block}
    `;
  } catch (error) {
    insightBox.innerHTML = `🤖 <strong>AI Error:</strong> Backend unavailable. ${escHtml(String(error?.message || 'Please try again.'))}`;
  }
}

async function loadAndRender() {
  if (!extensionEnabled) {
    renderProtectionState();
    return;
  }

  const requestId = ++activeRenderRequestId;
  const scanning = document.getElementById('scanning-indicator');
  scanning?.classList.remove('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  if (requestId !== activeRenderRequestId) return;

  const domain = normalizeDomain(tab.url);
  chrome.storage.local.get([domain], async (result) => {
    if (requestId !== activeRenderRequestId) return;

    const analysis = result[domain];
    const analysisUrl = String(analysis?.url || '');
    const normalizedCurrentUrl = String(tab.url || '').split('#')[0];
    const normalizedAnalysisUrl = analysisUrl.split('#')[0];
    const isSameTabContext = !normalizedAnalysisUrl || normalizedAnalysisUrl === normalizedCurrentUrl;

    if (analysis && isSameTabContext) {
      scanning?.classList.add('hidden');
      renderOverview(analysis);
      renderPrivacyTab(analysis);
      renderManipulationTab(analysis);
      animateReportPanels();

      await renderPriceTracker(tab);

      displayAIInsight(
        tab,
        analysis.privacy?.trackers || [],
        withConfidenceFloor(analysis.manipulation?.patterns || [])
      );
      return;
    }

    const now = Date.now();
    const patterns = analysis?.manipulation?.patterns || [];
    const analysisTs = Number(analysis?.timestamp || 0);
    const hasValidTimestamp = Number.isFinite(analysisTs) && analysisTs > 0;
    const ageMs = hasValidTimestamp ? now - analysisTs : Number.POSITIVE_INFINITY;
    const shouldAttemptRefresh = !analysis || ageMs > 120000 || (patterns.length === 0 && ageMs > 8000);

    if (shouldAttemptRefresh && !popupRefreshAttempted && tab?.id) {
      popupRefreshAttempted = true;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
      } catch {
        // Ignore restricted pages or temporary injection failures.
      }
      setTimeout(loadAndRender, 1700);
      return;
    }

    if (!analysis || !isSameTabContext) {
      scanning?.classList.add('hidden');
      setText('overall-insight', 'No fresh scan for this tab yet. Click Rescan to analyze this page.');
      setTimeout(loadAndRender, 2000);
      return;
    }
  });
}

async function renderPriceTracker(tab) {
  const priceSummary = document.getElementById('price-summary');
  const priceAlert = document.getElementById('price-alert');
  const priceHistory = document.getElementById('price-history');
  if (!priceSummary || !priceAlert || !priceHistory) return;

  const domain = normalizeDomain(tab.url || '');
  const productId = getProductIdFromUrl(tab.url || '', domain);
  if (!productId) {
    priceSummary.textContent = 'No product price detected yet.';
    priceAlert.style.display = 'none';
    priceHistory.innerHTML = '';
    return;
  }

  const history = await requestPriceHistory(domain, productId);
  const alert = await requestPriceAlert(domain, productId);

  if (!history || history.length === 0) {
    priceSummary.textContent = 'Price history not available yet.';
    priceAlert.style.display = 'none';
    priceHistory.innerHTML = '';
    return;
  }

  const latest = history[history.length - 1];
  priceSummary.textContent = `Current: ₹${Math.round(latest.currentPrice || 0)} • Samples: ${history.length}`;

  if (alert?.flagged) {
    priceAlert.textContent = alert.message || 'Possible fake discount detected.';
    priceAlert.style.display = 'block';
  } else {
    priceAlert.style.display = 'none';
  }

  const recent = history.slice(-5).reverse();
  priceHistory.innerHTML = recent.map((item) => {
    const date = new Date(item.ts || Date.now()).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return `<div class="price-history-item"><span>${date}</span><span>₹${Math.round(item.currentPrice || 0)}</span></div>`;
  }).join('');
}

function getProductIdFromUrl(url, domain) {
  if (!url) return null;
  if (domain.includes('amazon')) {
    const match = url.match(/\/dp\/([A-Z0-9]+)/);
    return match ? match[1] : null;
  }
  if (domain.includes('flipkart')) {
    const match = url.match(/pid=([A-Z0-9]+)/);
    return match ? match[1] : null;
  }
  return null;
}

function requestPriceHistory(domain, productId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'getPriceHistory',
      domain,
      productId,
    }, (response) => {
      resolve(response?.history || []);
    });
  });
}

function requestPriceAlert(domain, productId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'getPriceAlert',
      domain,
      productId,
    }, (response) => {
      resolve(response?.alert || null);
    });
  });
}

function renderOverview(analysis) {
  const privacy = analysis.privacy || {};
  const domainAnalysis = analysis.domain_analysis || {};
  const networkActivity = analysis.network_activity || {};
  const manipulation = analysis.manipulation || {};
  const patterns = withConfidenceFloor(manipulation.patterns || []);
  const privacyScore = getDisplayPrivacyScore(analysis);
  const privacyLevel = getRiskLevelFromScore(privacyScore);
  const manipulationScore = Number(manipulation.riskScore || 0);
  const manipulationLevel = manipulation.riskLevel || getRiskLevelFromScore(manipulationScore);
  const overallScore = Math.max(privacyScore, manipulationScore);
  const overallLevel = getRiskLevelFromScore(overallScore);
  const networkDomainCount = getNetworkDomainCount(analysis);
  const patternCount = patterns.length;

  const resolvedTrackers = (domainAnalysis.resolved_trackers || []).length > 0
    ? (domainAnalysis.resolved_trackers || [])
    : (privacy.trackers || []).map((item) => ({
        domain: item.domain,
        entity: item.name,
        categories: [item.type],
        privacy_score: privacy.riskScore || 2,
      }));
  const suspiciousDomains = domainAnalysis.suspicious_domains || [];
  const rawDomains = networkActivity.raw_domains || [];
  const identifiedDomainSet = new Set([
    ...resolvedTrackers.map((item) => normalizeDomain(item.domain || item.matched_domain || '')),
    ...suspiciousDomains.map((item) => normalizeDomain(item.domain || '')),
  ].filter(Boolean));
  const otherBackgroundRequests = rawDomains.filter((domain) => !identifiedDomainSet.has(normalizeDomain(domain)));

  const heroTone = getHeroTone(overallScore);
  const hero = document.getElementById('dashboard-hero');
  if (hero) {
    hero.classList.remove('risk-green', 'risk-yellow', 'risk-red');
    hero.classList.add(`risk-${heroTone}`);
  }

  const heroLevel = document.getElementById('hero-risk-level');
  if (heroLevel) {
    heroLevel.classList.remove('risk-green', 'risk-yellow', 'risk-red');
    heroLevel.classList.add(`risk-${heroTone}`);
  }

  const heroGauge = document.getElementById('hero-gauge-progress');
  setCircularGauge(heroGauge, overallScore, heroTone);

  setText('hero-risk-score', overallScore.toFixed(1));
  setText('hero-risk-level', overallLevel);
  setText('hero-domain-count', networkDomainCount);
  setText('hero-pattern-count', patternCount);

  setBadge('badge-privacy', privacyScore, privacyLevel);
  setBadge('badge-manipulation', manipulationScore, manipulationLevel);

  setText('privacy-card-score', `${privacyScore.toFixed(1)}/10`);
  const privacyFill = document.getElementById('privacy-card-fill');
  if (privacyFill) {
    privacyFill.style.width = `${Math.max(0, Math.min(100, privacyScore * 10))}%`;
    privacyFill.classList.remove('risk-green', 'risk-yellow', 'risk-red');
    privacyFill.classList.add(`risk-${getHeroTone(privacyScore)}`);
  }

  const topEntities = [...resolvedTrackers]
    .sort((a, b) => Number(b.privacy_score || 0) - Number(a.privacy_score || 0))
    .slice(0, 5);
  const entityList = document.getElementById('identified-entities-list');
  if (entityList) {
    if (topEntities.length === 0) {
      entityList.innerHTML = '<div class="empty-state">No identified entities yet.</div>';
    } else {
      entityList.innerHTML = topEntities.map((entity) => {
        const type = inferTrackerType(entity);
        const icon = TRACKER_ICONS[type] || TRACKER_ICONS.tracker;
        const score = Number(entity.privacy_score || 0);
        return `
          <div class="entity-row report-card">
            <div class="company-badge">${escHtml(companyInitials(entity.entity || entity.displayName || 'Unknown'))}</div>
            <div class="entity-icon">${icon}</div>
            <div class="entity-main">
              <div class="entity-name">${escHtml(entity.entity || entity.displayName || 'Unknown Entity')}</div>
              <div class="entity-domain code-domain">${escHtml(entity.domain || '')}</div>
            </div>
            <div class="risk-badge ${getRiskBucket(score)}">${score.toFixed(1)}</div>
          </div>
        `;
      }).join('');
    }
  }

  setText('suspicious-count-chip', `${suspiciousDomains.length} flagged`);
  const suspiciousList = document.getElementById('suspicious-activity-list');
  if (suspiciousList) {
    if (suspiciousDomains.length === 0) {
      suspiciousList.innerHTML = '<div class="empty-state">No suspicious domains flagged yet.</div>';
    } else {
      suspiciousList.innerHTML = suspiciousDomains.map((item) => {
        const tag = getSuspiciousKeywordTag(item.reasons || []);
        return `
          <div class="suspicious-row report-card">
            <span class="code-domain">${escHtml(item.domain || '')}</span>
            <span class="suspicious-tag">${escHtml(tag)}</span>
          </div>
        `;
      }).join('');
    }
  }

  setText('manipulation-card-score', `${manipulationScore.toFixed(1)}/10`);
  const manipulationList = document.getElementById('manipulation-severity-list');
  if (manipulationList) {
    if (patterns.length === 0) {
      manipulationList.innerHTML = '<div class="safe-state">✅ No dark patterns detected</div>';
    } else {
      manipulationList.innerHTML = patterns.map((pattern) => {
        const severity = String(pattern.severity || 'low').toLowerCase();
        const normalizedSeverity = severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
        const citation = getPatternCitation(pattern.type);
        return `
          <div class="severity-card severity-${normalizedSeverity} report-card">
            <div class="severity-head">
              <span>${SEVERITY_ICONS[normalizedSeverity] || '⚠️'} ${escHtml(pattern.name || 'Dark Pattern')}</span>
              <span class="item-badge badge-${normalizedSeverity}">${escHtml(normalizedSeverity)}</span>
            </div>
            <div class="severity-detail">${escHtml(pattern.description || 'Manipulative behavior detected.')}</div>
            <div class="severity-citation">${escHtml(citation)}</div>
          </div>
        `;
      }).join('');
    }
  }

  const networkLogCount = document.getElementById('network-log-count');
  if (networkLogCount) {
    networkLogCount.textContent = `${otherBackgroundRequests.length} requests`;
  }
  const networkLogList = document.getElementById('network-log-list');
  if (networkLogList) {
    if (otherBackgroundRequests.length === 0) {
      networkLogList.innerHTML = '<div class="empty-state">No additional background requests.</div>';
    } else {
      networkLogList.innerHTML = otherBackgroundRequests.map((domain) => `
        <div class="network-log-row">
          <span class="code-domain">${escHtml(domain)}</span>
        </div>
      `).join('');
    }
  }

  const insight = document.getElementById('overall-insight');
  if (insight) {
    if (networkDomainCount > 0) {
      insight.textContent = `Live scan found ${networkDomainCount} unique domains and ${patternCount} dark pattern signal(s).`;
    } else {
      insight.textContent = analysis.overall?.insight || analysis.aiInsight || 'Analysis complete. Fetching AI insight...';
    }
  }

  const lawItems = new Set();
  if (networkDomainCount > 0) lawItems.add('Digital Personal Data Protection Act 2023 (DPDP)');
  if (privacy.policy?.thirdPartySharing || privacy.policy?.noOptOut) lawItems.add('DPDP Act 2023 — Section 6, 8, 12');
  if (patternCount > 0) lawItems.add('CCPA Dark Patterns Guidelines 2023');
  if (patterns.some((item) => ['urgency', 'sneaking'].includes(item.type))) lawItems.add('Consumer Protection Act 2019 — Section 2(47)');

  const lawsSection = document.getElementById('laws-section');
  const lawsList = document.getElementById('laws-list');
  if (lawsSection && lawsList) {
    if (lawItems.size === 0) {
      lawsSection.style.display = 'none';
      lawsList.innerHTML = '';
    } else {
      lawsSection.style.display = 'block';
      lawsList.innerHTML = [...lawItems].map((law) => `<div class="law-tag">⚖️ ${escHtml(law)}</div>`).join('');
    }
  }

  animateContainerItems(document.getElementById('identified-entities-list'));
  animateContainerItems(document.getElementById('suspicious-activity-list'));
  animateContainerItems(document.getElementById('manipulation-severity-list'));
}

function getHeroTone(score) {
  if (score >= 7) return 'red';
  if (score >= 4) return 'yellow';
  return 'green';
}

function setCircularGauge(circleNode, score, tone) {
  if (!circleNode) return;
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Math.max(0, Math.min(10, Number(score) || 0));
  const progress = normalizedScore / 10;
  const offset = circumference - (progress * circumference);

  circleNode.style.strokeDasharray = `${circumference} ${circumference}`;
  circleNode.style.strokeDashoffset = `${offset}`;
  circleNode.classList.remove('risk-green', 'risk-yellow', 'risk-red');
  circleNode.classList.add(`risk-${tone}`);
}

function getSuspiciousKeywordTag(reasons) {
  const reasonList = Array.isArray(reasons) ? reasons : [];
  const keywordMatch = reasonList.find((reason) => String(reason).toLowerCase().startsWith('keyword:'));
  if (keywordMatch) {
    const keyword = String(keywordMatch).split(':')[1] || '';
    return `KEYWORD: ${keyword.trim().toUpperCase() || 'TRACKER'}`;
  }
  return 'KEYWORD: HEURISTIC';
}

function getPatternCitation(type) {
  const citations = {
    urgency: '⚖️ Violation: DPDP Act 2023 Sec. 6.',
    sneaking: '⚖️ Violation: CCPA Dark Patterns Guidelines 2023.',
    confirmshaming: '⚖️ Violation: Consumer Protection Act 2019 Sec. 2(47).',
    trick_questions: '⚖️ Violation: CCPA Dark Patterns Guidelines 2023.',
    forced_continuity: '⚖️ Violation: Consumer Protection Act 2019 Sec. 2(47).',
    disguised_ads: '⚖️ Violation: CCPA Dark Patterns Guidelines 2023.',
    misdirection: '⚖️ Violation: CCPA Dark Patterns Guidelines 2023.',
    nagging: '⚖️ Violation: CCPA Dark Patterns Guidelines 2023.',
    preselected: '⚖️ Violation: DPDP Act 2023 Sec. 6.',
    obstruction: '⚖️ Violation: Consumer Protection Act 2019 Sec. 2(47).',
  };
  return citations[type] || '⚖️ Violation: Consumer Protection Act 2019 Sec. 2(47).';
}

function setScore(type, score, level) {
  const scoreNode = document.getElementById(`score-${type}`);
  const levelNode = document.getElementById(`level-${type}`);
  const numeric = Number(score || 0);
  if (scoreNode) scoreNode.textContent = numeric.toFixed(1);
  if (levelNode) {
    levelNode.textContent = level || 'SAFE';
    levelNode.className = `score-level level-${level || 'SAFE'}`;
  }
}

function setBadge(id, score, level) {
  const badge = document.getElementById(id);
  if (!badge) return;

  badge.textContent = Number(score || 0).toFixed(1);
  badge.className = 'tab-badge';
  if (level === 'CRITICAL' || level === 'HIGH') badge.classList.add('danger');
  else if (level === 'MEDIUM') badge.classList.add('high');
  else if (level === 'LOW') badge.classList.add('medium');
  else badge.classList.add('ok');
}

function getDisplayPrivacyScore(analysis) {
  const domainScore = Number(analysis.domain_analysis?.total_privacy_score);
  const localScore = Number(analysis.privacy?.riskScore || 0);

  if (Number.isFinite(domainScore) && Number.isFinite(localScore)) {
    return Math.max(domainScore, localScore);
  }
  if (Number.isFinite(domainScore)) return domainScore;
  return Number.isFinite(localScore) ? localScore : 0;
}

function getNetworkDomainCount(analysis) {
  return analysis.network_activity?.unique_domain_count
    ?? analysis.domain_analysis?.resolved_trackers?.length
    ?? analysis.privacy?.trackers?.length
    ?? 0;
}

function getRiskLevelFromScore(score) {
  if (score >= 8.5) return 'CRITICAL';
  if (score >= 6.5) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score >= 2.0) return 'LOW';
  return 'SAFE';
}

function getRiskTone(score) {
  if (score >= 7) return { label: 'High Exposure', key: 'risk-high' };
  if (score >= 4) return { label: 'Medium Exposure', key: 'risk-med' };
  return { label: 'Low Exposure', key: 'risk-low' };
}

function getRiskBucket(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function renderHorizontalGauge(title, score) {
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const tone = getRiskTone(safeScore);
  const width = Math.max(0, Math.min(100, (safeScore / 10) * 100));
  return `
    <div class="security-gauge report-card ${tone.key}">
      <div class="security-gauge-head">
        <span>${escHtml(title)}</span>
        <span>${safeScore.toFixed(1)}/10 • ${tone.label}</span>
      </div>
      <div class="security-gauge-track">
        <div class="security-gauge-fill ${tone.key}" style="width:${width}%"></div>
      </div>
    </div>
  `;
}

function companyInitials(name) {
  const text = String(name || '').trim();
  if (!text) return '??';
  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (word[0] || '').toUpperCase())
    .join('') || '??';
}

function animateContainerItems(container) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll('.report-card'));
  items.forEach((item, index) => {
    item.classList.remove('fade-in-item');
    item.style.animationDelay = `${index * 40}ms`;
    item.classList.add('fade-in-item');
  });
}

function animateReportPanels() {
  document.querySelectorAll('.tab-content').forEach((panel, index) => {
    panel.classList.remove('report-fade-in');
    void panel.offsetWidth;
    panel.style.animationDelay = `${index * 50}ms`;
    panel.classList.add('report-fade-in');
  });
}

function inferTrackerType(entry) {
  const categories = Array.isArray(entry?.categories)
    ? entry.categories.map((item) => String(item).toLowerCase())
    : [];

  if (categories.some((item) => item.includes('advert'))) return 'advertising';
  if (categories.some((item) => item.includes('social'))) return 'social';
  if (categories.some((item) => item.includes('analytic') || item.includes('measurement') || item.includes('telemetry'))) return 'analytics';
  if (categories.some((item) => item.includes('broker') || item.includes('fingerprint'))) return 'data_broker';
  return 'tracker';
}

function prettyReason(reason) {
  if (!reason) return '';
  return String(reason)
    .replace(/^keyword:/, 'keyword: ')
    .replace(/-/g, ' ');
}

function formatTrafficLabel(count) {
  return count === 1 ? '1 Tracking Request Observed' : `${count} Tracking Requests Observed`;
}

function renderPrivacyTab(analysis) {
  const privacy = analysis.privacy || {};
  const networkActivity = analysis.network_activity || {};
  const domainAnalysis = analysis.domain_analysis || {};
  const resolvedTrackers = (domainAnalysis.resolved_trackers || []).length > 0
    ? (domainAnalysis.resolved_trackers || [])
    : (privacy.trackers || []).map((item) => ({
        domain: item.domain,
        entity: item.name,
        categories: [item.type],
        privacy_score: privacy.riskScore || 2,
      }));
  const suspiciousDomains = domainAnalysis.suspicious_domains || [];
  const rawDomains = networkActivity.raw_domains || [];
  const identifiedDomainSet = new Set([
    ...resolvedTrackers.map((item) => normalizeDomain(item.domain || item.matched_domain || '')),
    ...suspiciousDomains.map((item) => normalizeDomain(item.domain || '')),
  ].filter(Boolean));
  const otherBackgroundRequests = rawDomains.filter((domain) => !identifiedDomainSet.has(normalizeDomain(domain)));
  const privacyScore = getDisplayPrivacyScore(analysis);
  const requestCount = networkActivity.total_request_count || rawDomains.length;
  const uniqueDomainCount = networkActivity.unique_domain_count || rawDomains.length;

  const trackerList = document.getElementById('tracker-list');
  if (trackerList) {
    const knownHtml = resolvedTrackers.map((item) => {
      const type = inferTrackerType(item);
      const displayName = item.entity || item.displayName || 'Unknown Entity';
      const riskScore = Number(item.privacy_score || 0);
      return `
        <div class="tracker-item tracker-item--entity report-card">
          <div class="company-badge">${escHtml(companyInitials(displayName))}</div>
          <div class="item-body">
            <div class="item-name">${escHtml(displayName)}</div>
            <div class="item-sub">${escHtml(item.domain || '')}</div>
          </div>
          <div class="item-badge badge-${type}">${escHtml(type)}</div>
          <div class="risk-badge ${getRiskBucket(riskScore)}">${riskScore.toFixed(1)}</div>
        </div>
      `;
    }).join('');

    const suspiciousHtml = suspiciousDomains.map((item) => {
      const riskScore = Number(item.privacy_score || 0);
      const reasons = (item.reasons || []).map(prettyReason).join(', ');
      return `
        <div class="tracker-item tracker-item--alert report-card">
          <div class="item-icon">⚠️</div>
          <div class="item-body">
            <div class="item-name">Unidentified Tracking Behavior</div>
            <div class="item-sub">${escHtml(item.domain || '')}</div>
            <div class="item-sub">${escHtml(reasons || 'Heuristic anomaly')}</div>
          </div>
          <div class="risk-badge ${getRiskBucket(riskScore)}">${riskScore.toFixed(1)}</div>
        </div>
      `;
    }).join('');

    const otherRequestHtml = otherBackgroundRequests.map((domain) => `
      <div class="background-request-item">
        <span class="background-request-domain">${escHtml(domain)}</span>
      </div>
    `).join('');

    const hasKnown = resolvedTrackers.length > 0;
    const hasSuspicious = suspiciousDomains.length > 0;
    const hasOther = otherBackgroundRequests.length > 0;

    trackerList.innerHTML = `
      <div class="traffic-monitor report-card">
        <div class="traffic-monitor-head">
          <span class="live-traffic-label"><span class="live-dot"></span>Live Traffic Monitor</span>
          <span>${uniqueDomainCount} unique domains</span>
        </div>
        <div class="traffic-counter">${requestCount}</div>
        <div class="traffic-subtext">${escHtml(formatTrafficLabel(requestCount))}</div>
      </div>

      ${renderHorizontalGauge('Privacy Risk Gauge', privacyScore)}

      <div class="privacy-subheading">Identified Entities</div>
      ${hasKnown ? knownHtml : '<div class="empty-state">No identified entities yet.</div>'}

      <details class="background-requests report-card" ${hasSuspicious ? 'open' : ''}>
        <summary>Other Background Requests (${otherBackgroundRequests.length + suspiciousDomains.length})</summary>
        <div class="background-request-body">
          <div class="privacy-subheading">AI-Flagged Suspicious Domains</div>
          ${hasSuspicious ? suspiciousHtml : '<div class="empty-state">No heuristic alerts.</div>'}

          <div class="privacy-subheading">Other Background Requests</div>
          ${hasOther ? otherRequestHtml : '<div class="empty-state">No additional background requests.</div>'}
        </div>
      </details>

      ${(!hasKnown && !hasSuspicious && !hasOther) ? '<div class="safe-state">🛡️ Your Privacy is Protected</div>' : ''}
    `;

    animateContainerItems(trackerList);
  }

  const policyFlags = [];
  if (privacy.policy?.thirdPartySharing) {
    policyFlags.push({ icon: '🔗', label: 'Third-party data sharing detected', detail: 'Your data is shared with external partners.' });
  }
  if (privacy.policy?.noOptOut) {
    policyFlags.push({ icon: '🚫', label: 'No opt-out mechanism found', detail: 'You cannot easily withdraw consent.' });
  }
  if (privacy.policy?.extensiveCollection) {
    policyFlags.push({ icon: '📦', label: 'Extensive data collection', detail: 'Site collects location, device, browsing, or purchase data.' });
  }
  if (privacy.fingerprinting) {
    policyFlags.push({ icon: '🖼️', label: 'Canvas fingerprinting detected', detail: 'Site attempts to derive a unique browser fingerprint.' });
  }

  const policyList = document.getElementById('policy-list');
  if (policyList) {
    if (policyFlags.length === 0) {
      policyList.innerHTML = '<div class="safe-state">✅ No major policy issues detected</div>';
    } else {
      policyList.innerHTML = policyFlags.map((flag) => `
        <div class="policy-item report-card">
          <div class="item-icon">${flag.icon}</div>
          <div class="item-body">
            <div class="item-name">${escHtml(flag.label)}</div>
            <div class="item-sub">${escHtml(flag.detail)}</div>
          </div>
        </div>
      `).join('');
    }

    animateContainerItems(policyList);
  }

  const privacyLegalList = document.getElementById('privacy-legal-list');
  if (privacyLegalList) {
    const legalItems = buildPrivacyLegalItems(privacy, uniqueDomainCount);
    if (legalItems.length === 0) {
      privacyLegalList.innerHTML = '<div class="empty-state">No violations mapped</div>';
    } else {
      privacyLegalList.innerHTML = legalItems.map((item) => `
        <div class="legal-item report-card">
          <div class="legal-law">⚖️ ${escHtml(item.law)}</div>
          <div class="legal-detail">${escHtml(item.section)} — ${escHtml(item.issue)}</div>
          <div class="legal-penalty">Max Penalty: ${escHtml(item.penalty)}</div>
        </div>
      `).join('');
    }

    animateContainerItems(privacyLegalList);
  }
}

function buildPrivacyLegalItems(privacy, trackerExposureCount = 0) {
  const items = [];
  if (trackerExposureCount > 0 || (privacy.trackers?.length || 0) > 0) {
    items.push({ law: 'DPDP Act 2023', section: 'Section 6', issue: 'Tracking without explicit consent', penalty: '₹250 crore' });
  }
  if (privacy.policy?.thirdPartySharing) {
    items.push({ law: 'DPDP Act 2023', section: 'Section 8', issue: 'Third-party data sharing obligations', penalty: '₹250 crore' });
  }
  if (privacy.policy?.noOptOut) {
    items.push({ law: 'DPDP Act 2023', section: 'Section 12', issue: 'Right to withdraw consent not provided', penalty: '₹250 crore' });
  }
  if (privacy.fingerprinting) {
    items.push({ law: 'IT Act 2000', section: 'Section 43A', issue: 'Unauthorized data collection via fingerprinting', penalty: '₹5 crore+' });
  }
  return items;
}

function renderManipulationTab(analysis) {
  const manipulation = analysis.manipulation || {};
  const manipulationScore = Number(manipulation.riskScore || 0);
  const patternList = document.getElementById('pattern-list');
  if (patternList) {
    const patterns = withConfidenceFloor(manipulation.patterns || []);
    if (patterns.length === 0) {
      patternList.innerHTML = `
        ${renderHorizontalGauge('Manipulation Risk Gauge', manipulationScore)}
        <div class="safe-state report-card">✅ No dark patterns detected</div>
      `;
    } else {
      const cards = patterns.map((item, index) => {
        const severity = String(item.severity || 'low').toLowerCase();
        const riskClass = severity === 'high' ? 'risk-high' : severity === 'medium' ? 'risk-med' : 'risk-low';
        const patternText = item.text || item.snippet || item.target?.textPreview || '';
        return `
          <div class="pattern-item manipulation-card report-card ${riskClass}" data-pattern-index="${index}" data-pattern-text="${escHtml(patternText)}" data-pattern-type="${escHtml(item.type || '')}" data-pattern-name="${escHtml(item.name || '')}" title="Click to highlight on page">
            <div class="item-icon">${SEVERITY_ICONS[severity] || '⚠️'}</div>
            <div class="item-body">
              <div class="item-name">${escHtml(item.name)}</div>
              <div class="item-sub">${escHtml(item.description || '')}</div>
              ${item.text ? `<div class="item-sub" style="margin-top:3px;font-style:italic;opacity:0.75;">&quot;${escHtml(String(item.text).slice(0, 90))}${String(item.text).length > 90 ? '…' : ''}&quot;</div>` : ''}
            </div>
            <div class="item-badge badge-${severity}">${escHtml(severity)}</div>
          </div>
        `;
      }).join('');

      patternList.innerHTML = `
        ${renderHorizontalGauge('Manipulation Risk Gauge', manipulationScore)}
        <div class="privacy-subheading">Dark Pattern Security Cards</div>
        ${cards}
      `;

      patternList.querySelectorAll('.pattern-item').forEach((card) => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', async () => {
          const patternData = {
            patternText: card.dataset.patternText,
            type: card.dataset.patternType,
            name: card.dataset.patternName,
          };
          if (!patternData.patternText) {
            return;
          }
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: 'focusDetectedPattern',
                pattern: patternData,
              });
            }
          } catch (err) {
            console.warn('[ConsumerShield] Failed to focus pattern:', err);
          }
        });
      });
    }

    animateContainerItems(patternList);
  }

  renderFilteredPatternDebug(analysis.domain || '');

  const manipulationLegalList = document.getElementById('manipulation-legal-list');
  if (manipulationLegalList) {
    const legalItems = buildManipulationLegalItems({
      ...manipulation,
      patterns: withConfidenceFloor(manipulation.patterns || []),
    });
    if (legalItems.length === 0) {
      manipulationLegalList.innerHTML = '<div class="empty-state">No violations mapped</div>';
    } else {
      manipulationLegalList.innerHTML = legalItems.map((item) => `
        <div class="legal-item report-card">
          <div class="legal-law">⚖️ ${escHtml(item.law)}</div>
          <div class="legal-detail">${escHtml(item.section)} — ${escHtml(item.issue)}</div>
          <div class="legal-penalty">Penalty: ${escHtml(item.penalty)}</div>
        </div>
      `).join('');
    }

    animateContainerItems(manipulationLegalList);
  }
}

function buildManipulationLegalItems(manipulation) {
  const legalMap = {
    urgency: { law: 'CCPA Guidelines 2023', section: 'False Urgency', issue: 'Creating artificial scarcity or time pressure', penalty: '₹10 lakh – ₹50 lakh' },
    sneaking: { law: 'CCPA Guidelines 2023', section: 'Drip Pricing', issue: 'Hidden charges not disclosed upfront', penalty: '₹25 lakh – ₹50 lakh' },
    confirmshaming: { law: 'CCPA Guidelines 2023', section: 'Confirmshaming', issue: 'Guilt-based language to force acceptance', penalty: '₹10 lakh – ₹25 lakh' },
    trick_questions: { law: 'CCPA Guidelines 2023', section: 'Trick Questions', issue: 'Double negatives on consent forms', penalty: '₹10 lakh – ₹25 lakh' },
    forced_continuity: { law: 'CCPA Guidelines 2023', section: 'Forced Continuity', issue: 'Auto-renewal without clear notice', penalty: '₹25 lakh – ₹50 lakh' },
    disguised_ads: { law: 'CCPA Guidelines 2023', section: 'Disguised Ads', issue: 'Ads presented as organic content', penalty: '₹10 lakh – ₹25 lakh' },
    misdirection: { law: 'CCPA Guidelines 2023', section: 'Misdirection', issue: 'Visual hierarchy nudges user toward unintended choice', penalty: '₹10 lakh – ₹25 lakh' },
    nagging: { law: 'CCPA Guidelines 2023', section: 'Nagging', issue: 'Repeated prompts that pressure repeated user action', penalty: '₹10 lakh – ₹25 lakh' },
    preselected: { law: 'CCPA Guidelines 2023', section: 'Pre-selected Options', issue: 'Harmful options pre-checked without consent', penalty: '₹10 lakh – ₹25 lakh' },
    obstruction: { law: 'CCPA Guidelines 2023', section: 'Obstruction', issue: 'Making cancellation deliberately difficult', penalty: '₹25 lakh – ₹50 lakh' },
  };

  const seen = new Set();
  const items = [];
  withConfidenceFloor(manipulation.patterns || []).forEach((pattern) => {
    const mapped = legalMap[pattern.type];
    if (mapped && !seen.has(pattern.type)) {
      seen.add(pattern.type);
      items.push(mapped);
    }
  });

  if (items.length > 0) {
    items.push({ law: 'Consumer Protection Act 2019', section: 'Section 2(47)', issue: 'Unfair trade practice', penalty: '₹10 lakh – ₹50 lakh' });
  }
  return items;
}

function buildReportHTML(analysis) {
  const date = new Date(analysis.timestamp).toLocaleString('en-IN');
  const domainAnalysis = analysis.domain_analysis || {};
  const networkActivity = analysis.network_activity || {};
  const manipulation = analysis.manipulation || {};
  const privacy = analysis.privacy || {};
  const networkDomainCount = getNetworkDomainCount(analysis);
  const privacyScore = getDisplayPrivacyScore(analysis);
  const manipulationScore = Number(manipulation.riskScore || 0);
  const overallScore = Math.max(privacyScore, manipulationScore);
  const overallLevel = getRiskLevelFromScore(overallScore);
  const tone = getHeroTone(overallScore);
  const ringRadius = 86;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (Math.max(0, Math.min(10, overallScore)) / 10) * ringCircumference;
  const patternCount = withConfidenceFloor(manipulation.patterns || []).length;
  const resolvedTrackers = (domainAnalysis.resolved_trackers || []).length > 0
    ? (domainAnalysis.resolved_trackers || [])
    : (privacy.trackers || []).map((item) => ({
        domain: item.domain,
        entity: item.name,
        categories: [item.type],
        privacy_score: privacy.riskScore || 2,
      }));
  const topEntities = [...resolvedTrackers]
    .sort((a, b) => Number(b.privacy_score || 0) - Number(a.privacy_score || 0))
    .slice(0, 8);
  const suspiciousDomains = domainAnalysis.suspicious_domains || [];
  const rawDomains = networkActivity.raw_domains || [];
  const identifiedDomainSet = new Set([
    ...resolvedTrackers.map((item) => normalizeDomain(item.domain || item.matched_domain || '')),
    ...suspiciousDomains.map((item) => normalizeDomain(item.domain || '')),
  ].filter(Boolean));
  const otherBackgroundRequests = rawDomains.filter((domain) => !identifiedDomainSet.has(normalizeDomain(domain)));
  const entityRows = topEntities.map((item) => {
    const trackerType = inferTrackerType(item);
    const trackerIcon = TRACKER_ICONS[trackerType] || TRACKER_ICONS.tracker;
    const displayName = item.entity || item.displayName || 'Unknown Entity';
    const score = Number(item.privacy_score || 0);
    return `
      <div class="entity-row">
        <div class="entity-left">
          <span class="company-badge">${escHtml(companyInitials(displayName))}</span>
          <span class="entity-icon">${trackerIcon}</span>
          <div class="entity-meta">
            <div class="entity-name">${escHtml(displayName)}</div>
            <div class="domain code">${escHtml(item.domain || '')}</div>
          </div>
        </div>
        <span class="risk-pill ${getRiskBucket(score)}">${score.toFixed(1)}</span>
      </div>
    `;
  }).join('');
  const suspiciousRows = suspiciousDomains.map((item) => {
    const tag = getSuspiciousKeywordTag(item.reasons || []);
    const reasons = (item.reasons || []).map(prettyReason).join(', ');
    return `
      <div class="alert-row">
        <div>
          <div class="domain code">${escHtml(item.domain || '')}</div>
          <div class="subtle">${escHtml(reasons || 'Heuristic anomaly')}</div>
        </div>
        <span class="alert-tag">${escHtml(tag)}</span>
      </div>
    `;
  }).join('');
  const patternCards = (manipulation.patterns || []).map((item) => {
    const severity = String(item.severity || 'low').toLowerCase();
    const severityKey = severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
    return `
      <article class="pattern-card severity-${severityKey}">
        <div class="pattern-head">
          <strong>${escHtml(item.name || 'Dark Pattern')}</strong>
          <span class="severity-chip severity-${severityKey}">${escHtml(severityKey)}</span>
        </div>
        <p>${escHtml(item.description || 'Manipulative behavior detected.')}</p>
        <div class="citation">${escHtml(getPatternCitation(item.type))}</div>
      </article>
    `;
  }).join('');
  const networkLogRows = otherBackgroundRequests
    .map((domain) => `<div class="log-row code">${escHtml(domain)}</div>`)
    .join('');

  const privacyLegal = buildPrivacyLegalItems(privacy, networkDomainCount);
  const manipulationLegal = buildManipulationLegalItems(manipulation);
  const legalRows = [...privacyLegal, ...manipulationLegal]
    .map((item) => `
      <div class="legal-row">
        <div class="legal-law">⚖️ ${escHtml(item.law)}</div>
        <div class="subtle">${escHtml(item.section)} — ${escHtml(item.issue)}</div>
      </div>
    `)
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>ConsumerShield Report — ${escHtml(analysis.domain)}</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --bg: #0f172a;
      --panel: rgba(15, 23, 42, 0.74);
      --border: rgba(148, 163, 184, 0.3);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --green: #22c55e;
      --yellow: #eab308;
      --red: #ef4444;
    }
    body {
      margin: 0;
      font-family: 'Inter', 'Roboto', 'Segoe UI', sans-serif;
      background:
        radial-gradient(120% 80% at 15% 10%, rgba(56, 189, 248, 0.16), transparent 52%),
        radial-gradient(95% 70% at 85% 90%, rgba(239, 68, 68, 0.12), transparent 58%),
        linear-gradient(170deg, var(--bg), #0b1224 72%);
      color: var(--text);
      padding: 28px;
    }
    .shell {
      max-width: 1180px;
      margin: 0 auto;
    }
    .hero {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
      padding: 16px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 30px rgba(2, 6, 23, 0.52);
    }
    .tone-green { border-color: rgba(74, 222, 128, 0.55); box-shadow: 0 0 0 1px rgba(34,197,94,0.2), 0 0 24px rgba(34,197,94,0.25); }
    .tone-yellow { border-color: rgba(250, 204, 21, 0.6); box-shadow: 0 0 0 1px rgba(234,179,8,0.22), 0 0 24px rgba(234,179,8,0.26); }
    .tone-red { border-color: rgba(248, 113, 113, 0.66); box-shadow: 0 0 0 1px rgba(239,68,68,0.24), 0 0 24px rgba(239,68,68,0.3); }
    .hero-stat {
      text-align: center;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.55);
      padding: 16px 12px;
    }
    .hero-stat-value { font-size: 32px; font-weight: 800; line-height: 1; }
    .hero-stat-label { font-size: 11px; color: var(--muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.6px; }
    .ring-wrap { position: relative; width: 220px; height: 220px; display: grid; place-items: center; }
    .ring svg { width: 220px; height: 220px; }
    .ring-track { fill: none; stroke: rgba(148,163,184,0.22); stroke-width: 14; }
    .ring-progress { fill: none; stroke-width: 14; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
    .ring-progress.tone-green { stroke: var(--green); filter: drop-shadow(0 0 10px rgba(34,197,94,0.65)); }
    .ring-progress.tone-yellow { stroke: var(--yellow); filter: drop-shadow(0 0 10px rgba(234,179,8,0.65)); }
    .ring-progress.tone-red { stroke: var(--red); filter: drop-shadow(0 0 11px rgba(239,68,68,0.72)); }
    .ring-core {
      position: absolute;
      width: 138px;
      height: 138px;
      border-radius: 50%;
      background: rgba(2, 6, 23, 0.78);
      border: 1px solid rgba(148,163,184,0.32);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .ring-score { font-size: 44px; font-weight: 800; line-height: 1; }
    .ring-level {
      margin-top: 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .headline {
      margin: 14px 2px 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .section-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .card {
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 26px rgba(2, 6, 23, 0.46);
      padding: 14px;
    }
    .card h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid rgba(148,163,184,0.35);
      color: var(--muted);
      background: rgba(30,41,59,0.58);
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .progress {
      width: 100%;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(148,163,184,0.22);
      border: 1px solid rgba(148,163,184,0.28);
      margin-bottom: 10px;
    }
    .bar {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #16a34a, #eab308, #ef4444);
    }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .entity-row, .alert-row, .legal-row {
      border-radius: 12px;
      border: 1px solid rgba(148,163,184,0.25);
      background: rgba(15, 23, 42, 0.56);
      padding: 9px 10px;
    }
    .entity-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .entity-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }
    .company-badge {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 800;
      color: #bae6fd;
      background: rgba(14,116,144,0.3);
      border: 1px solid rgba(56,189,248,0.5);
    }
    .entity-icon {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      background: rgba(30,41,59,0.76);
      border: 1px solid rgba(148,163,184,0.28);
    }
    .entity-meta { min-width: 0; }
    .entity-name { font-size: 13px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .domain.code, .log-row.code {
      font-family: 'Source Code Pro', 'Fira Code', monospace;
      font-size: 11px;
      color: #cbd5e1;
      word-break: break-all;
    }
    .subtle { margin-top: 3px; font-size: 11px; color: var(--muted); line-height: 1.4; }
    .risk-pill {
      min-width: 36px;
      text-align: center;
      font-size: 10px;
      font-weight: 800;
      border-radius: 999px;
      padding: 3px 7px;
      border: 1px solid rgba(148,163,184,0.35);
    }
    .risk-pill.low { color: #bbf7d0; background: rgba(20,83,45,0.62); border-color: rgba(74,222,128,0.55); }
    .risk-pill.medium { color: #fde68a; background: rgba(113,63,18,0.68); border-color: rgba(250,204,21,0.55); }
    .risk-pill.high { color: #fecaca; background: rgba(127,29,29,0.7); border-color: rgba(248,113,113,0.6); }
    .alert-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-left: 3px solid rgba(239,68,68,0.78);
    }
    .alert-tag {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #fecaca;
      background: rgba(127,29,29,0.8);
      border: 1px solid rgba(248,113,113,0.64);
      white-space: nowrap;
    }
    .pattern-grid {
      margin-top: 12px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .pattern-card {
      border-radius: 12px;
      border: 1px solid rgba(148,163,184,0.28);
      background: rgba(15,23,42,0.56);
      padding: 10px;
    }
    .pattern-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .severity-chip {
      font-size: 10px;
      font-weight: 800;
      border-radius: 999px;
      padding: 3px 8px;
      text-transform: uppercase;
      letter-spacing: 0.45px;
    }
    .severity-chip.severity-high { color: #fecaca; background: rgba(127,29,29,0.78); border: 1px solid rgba(248,113,113,0.65); }
    .severity-chip.severity-medium { color: #fde68a; background: rgba(113,63,18,0.78); border: 1px solid rgba(250,204,21,0.58); }
    .severity-chip.severity-low { color: #bbf7d0; background: rgba(20,83,45,0.76); border: 1px solid rgba(74,222,128,0.58); }
    .pattern-card p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .citation {
      margin-top: 8px;
      font-size: 11px;
      color: #fde68a;
    }
    .pattern-card.severity-high { border-color: rgba(248,113,113,0.7); box-shadow: 0 0 0 1px rgba(248,113,113,0.24), 0 0 16px rgba(239,68,68,0.28); }
    .pattern-card.severity-medium { border-color: rgba(251,146,60,0.66); box-shadow: 0 0 0 1px rgba(251,146,60,0.2), 0 0 14px rgba(249,115,22,0.24); }
    .pattern-card.severity-low { border-color: rgba(74,222,128,0.62); box-shadow: 0 0 0 1px rgba(74,222,128,0.18), 0 0 12px rgba(34,197,94,0.22); }
    details.log-card {
      margin-top: 12px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    details.log-card summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      font-weight: 700;
      font-size: 12px;
    }
    details.log-card summary::-webkit-details-marker { display: none; }
    .log-list { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 7px; }
    .log-row { border-radius: 10px; border: 1px solid rgba(148,163,184,0.23); background: rgba(15,23,42,0.55); padding: 7px 9px; }
    .legal-grid {
      margin-top: 12px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .legal-row {
      border-radius: 12px;
      border: 1px solid rgba(167,139,250,0.35);
      background: rgba(76,29,149,0.14);
      padding: 10px;
    }
    .legal-law {
      font-size: 12px;
      font-weight: 700;
      color: #ddd6fe;
    }
    .empty {
      border-radius: 12px;
      border: 1px dashed rgba(148,163,184,0.36);
      color: var(--muted);
      text-align: center;
      padding: 14px;
      font-style: italic;
      background: rgba(15,23,42,0.5);
    }
    .footer {
      margin-top: 16px;
      color: #94a3b8;
      font-size: 12px;
      text-align: center;
      padding-top: 12px;
      border-top: 1px solid rgba(148,163,184,0.22);
    }
    @media (max-width: 920px) {
      .hero { grid-template-columns: 1fr; }
      .ring-wrap { margin: 0 auto; }
      .section-grid, .pattern-grid, .legal-grid { grid-template-columns: 1fr; }
    }
  </style></head><body>
  <div class="shell">
    <section class="hero tone-${tone}">
      <div class="hero-stat">
        <div class="hero-stat-value">${networkDomainCount}</div>
        <div class="hero-stat-label">Domains</div>
      </div>
      <div class="ring-wrap">
        <div class="ring">
          <svg viewBox="0 0 220 220" aria-label="Overall security risk gauge">
            <circle class="ring-track" cx="110" cy="110" r="86"></circle>
            <circle class="ring-progress tone-${tone}" cx="110" cy="110" r="86" style="stroke-dasharray:${ringCircumference};stroke-dashoffset:${ringOffset};"></circle>
          </svg>
        </div>
        <div class="ring-core">
          <div class="ring-score">${overallScore.toFixed(1)}</div>
          <div class="ring-level">${escHtml(overallLevel)}</div>
        </div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-value">${patternCount}</div>
        <div class="hero-stat-label">Dark Patterns</div>
      </div>
    </section>

    <p class="headline"><strong>${escHtml(analysis.domain)}</strong> • Generated ${date}<br>${escHtml(analysis.overall?.insight || 'Security dashboard generated from live network and behavioral signals.')}</p>

    <section class="section-grid">
      <article class="card">
        <div class="card-head">
          <h3>Privacy Card</h3>
          <span class="chip">${privacyScore.toFixed(1)}/10</span>
        </div>
        <div class="progress"><div class="bar" style="width:${Math.max(0, Math.min(100, privacyScore * 10))}%"></div></div>
        <div class="list">
          ${entityRows || '<div class="empty">No identified entities.</div>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head">
          <h3>Suspicious Activity</h3>
          <span class="chip">${suspiciousDomains.length} flagged</span>
        </div>
        <div class="list">
          ${suspiciousRows || '<div class="empty">No suspicious domains flagged.</div>'}
        </div>
      </article>
    </section>

    <section class="pattern-grid">
      ${patternCards || '<div class="empty">No dark patterns detected.</div>'}
    </section>

    <details class="log-card">
      <summary>
        <span>Network Traffic Log</span>
        <span>${otherBackgroundRequests.length} other requests</span>
      </summary>
      <div class="log-list">
        ${networkLogRows || '<div class="empty">No additional background requests.</div>'}
      </div>
    </details>

    <section class="legal-grid">
      ${legalRows || '<div class="empty">No legal mappings available.</div>'}
    </section>

    <div class="footer">Generated by ConsumerShield • India&apos;s Complete Consumer Protection Tool</div>
  </div>
  </body></html>`;
}

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
