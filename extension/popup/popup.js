import lawMapping from '../utils/lawMapping.js';
import { generateComplaintPDF } from '../utils/generatePDF.js';

const REPORT_PAGE_URL = chrome.runtime.getURL('report.html');

const ISSUE_ICONS = [
  { match: /hidden|charge|price|cost/i, icon: '⚠️' },
  { match: /subscription|continuity|renewal/i, icon: '🚨' },
  { match: /dark|pattern|manipulative/i, icon: '⚠️' },
  { match: /privacy|data|tracking/i, icon: '🔒' },
];

const ELEMENTS = {
  status: document.getElementById('status-pill'),
  score: document.getElementById('risk-score'),
  label: document.getElementById('risk-label'),
  siteName: document.getElementById('site-name'),
  issueList: document.getElementById('issue-list'),
  btnGenerate: document.getElementById('btn-generate'),
  btnReport: document.getElementById('btn-report'),
};

let currentAnalysis = null;
let currentCompany = 'Website';
let currentDomain = '';

async function initializePopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentDomain = normalizeDomain(tab?.url || '');
  currentCompany = String(tab?.title || currentDomain || 'Consumer Shield');

  const analysis = await loadAnalysis(currentDomain);
  currentAnalysis = analysis;

  const score = calculateRiskScore(analysis);
  const label = getRiskLabel(score);
  const issues = collectIssues(analysis);
  const laws = mapIssuesToLaws(issues);

  renderHeader(score, label, currentCompany);
  renderIssues(issues);
  renderStatus(analysis, score);
  setupActions({ analysis, score, issues, laws });
}

function normalizeDomain(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return String(value || '').trim();
  }
}

function loadAnalysis(domain) {
  return new Promise((resolve) => {
    if (!domain) {
      resolve(null);
      return;
    }

    chrome.storage.local.get([domain], (result) => {
      resolve(result?.[domain] || null);
    });
  });
}

function calculateRiskScore(analysis) {
  if (!analysis) return 0;
  const privacy = Number(analysis.privacy?.riskScore || 0);
  const manipulation = Number(analysis.manipulation?.riskScore || 0);
  const topScore = Math.max(privacy, manipulation, 0);
  return Math.round(Math.max(0, Math.min(10, topScore)) * 10);
}

function getRiskLabel(score) {
  if (score <= 40) return { label: 'Safe', style: 'safe' };
  if (score <= 70) return { label: 'Caution', style: 'caution' };
  return { label: 'Risky', style: 'risky' };
}

function collectIssues(analysis) {
  const rawPatterns = Array.isArray(analysis?.manipulation?.patterns)
    ? analysis.manipulation.patterns
    : [];

  const issueNames = rawPatterns
    .map((pattern) => pattern.name || pattern.type || '')
    .filter(Boolean)
    .map(normalizeIssueName);

  if (issueNames.length) {
    return [...new Set(issueNames)];
  }

  const fallbackIssues = [];
  if (analysis?.privacy?.policy?.thirdPartySharing) {
    fallbackIssues.push('Hidden Charges');
  }
  if (analysis?.privacy?.trackers?.length) {
    fallbackIssues.push('Data Privacy Violation');
  }

  return fallbackIssues.length ? [...new Set(fallbackIssues)] : ['No detected issues yet'];
}

function normalizeIssueName(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();

  if (/hidden|charge|price|cost/.test(lower)) return 'Hidden Charges';
  if (/subscription|continuity|renewal/.test(lower)) return 'Subscription Trap';
  if (/dark|pattern|manipulative/.test(lower)) return 'Dark Patterns';
  if (/privacy|data|tracking/.test(lower)) return 'Data Privacy Violation';

  return raw
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function mapIssuesToLaws(issues) {
  const laws = new Set();
  issues.forEach((issue) => {
    const mapped = lawMapping[issue];
    if (Array.isArray(mapped)) {
      mapped.forEach((law) => laws.add(law));
    }
  });
  return [...laws];
}

function issueIcon(issue) {
  const match = ISSUE_ICONS.find((entry) => entry.match.test(issue));
  return match ? match.icon : '⚠️';
}

function renderHeader(score, label, company) {
  const labelEl = ELEMENTS.label;
  const scoreEl = ELEMENTS.score;
  const siteNameEl = ELEMENTS.siteName;

  if (scoreEl) scoreEl.textContent = String(score);
  if (labelEl) {
    labelEl.textContent = label.label;
    labelEl.className = `score-badge ${label.style}`;
  }
  if (siteNameEl) {
    siteNameEl.textContent = company ? `Website: ${company}` : 'Website analysis unavailable';
  }
}

function renderIssues(issues) {
  const list = ELEMENTS.issueList;
  if (!list) return;
  list.innerHTML = '';

  issues.forEach((issue) => {
    const item = document.createElement('li');
    item.className = 'issue-item';
    item.innerHTML = `<span>${issueIcon(issue)}</span><span>${issue}</span>`;
    list.appendChild(item);
  });
}

function renderStatus(analysis, score) {
  const status = ELEMENTS.status;
  if (!status) return;

  if (!analysis) {
    status.textContent = 'No scan data yet';
    return;
  }

  if (score === 0) {
    status.textContent = 'Scan completed — low risk';
  } else {
    status.textContent = 'Scan completed — review issues';
  }
}

function buildEvidenceText(analysis) {
  const patternText = Array.isArray(analysis?.manipulation?.patterns)
    ? analysis.manipulation.patterns
        .map((pattern) => pattern.name || pattern.description || pattern.type)
        .filter(Boolean)
        .join(' | ')
    : '';

  if (patternText) {
    return `Detected via extension: ${patternText}`;
  }

  return 'Detected via extension. Evidence is based on page analysis and dark pattern detection.';
}

function setupActions({ analysis, score, issues, laws }) {
  const generateButton = ELEMENTS.btnGenerate;
  const reportButton = ELEMENTS.btnReport;

  if (generateButton) {
    generateButton.addEventListener('click', () => {
      const complaintData = {
        name: 'Anonymous',
        company: currentCompany || currentDomain || 'Website',
        analysis,
        issues: issues.filter((item) => item !== 'No detected issues yet'),
        laws,
        severity: score >= 71 ? 'High' : score >= 41 ? 'Medium' : 'Low',
        evidence: buildEvidenceText(analysis),
      };

      generateComplaintPDF(complaintData);
    });
  }

  if (reportButton) {
    reportButton.addEventListener('click', () => {
      if (!analysis) {
        alert('No report data available yet. Please open a website and let the extension complete a scan.');
        return;
      }

      chrome.storage.local.set({ consumershield_last_report: analysis }, () => {
        chrome.tabs.create({ url: REPORT_PAGE_URL });
      });
    });
  }
}

initializePopup();
