const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 40;
const LINE_HEIGHT = 14;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const MAX_CHARS_PER_LINE = 88;
const PAGE_CHAR_WIDTH = CONTENT_WIDTH / MAX_CHARS_PER_LINE;

function sanitizeFileName(text) {
  return String(text || 'Complaint')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'Complaint';
}

function escapePDFString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

function wrapLines(text, maxChars = MAX_CHARS_PER_LINE) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = [];
  normalized.split('\n').forEach((paragraph) => {
    const words = paragraph.split(' ').filter(Boolean);
    let current = '';
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
    if (!words.length) lines.push('');
  });
  return lines;
}

function formatReportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || 'Unknown date');
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function makeBar(score, max = 10, width = 24) {
  const filled = Math.round((Math.min(Math.max(score, 0), max) / max * width));
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getRiskEmoji(score) {
  if (score >= 7) return '🔴';
  if (score >= 4) return '🟡';
  return '🟢';
}

function getSeverityEmoji(severity) {
  const s = (severity || '').toLowerCase();
  if (s === 'high') return '🔴';
  if (s === 'medium') return '🟡';
  if (s === 'low') return '🟢';
  return '⚪';
}

function blank(lines, count = 1) {
  for (let i = 0; i < count; i++) lines.push('');
}

function rule(lines, char = '─', len = 60) {
  lines.push(char.repeat(len));
}

function section(lines, title, level = 1) {
  blank(lines);
  if (level === 1) {
    lines.push(`════════════════════════════════════════════════════════════════`);
    lines.push(`  ${title.toUpperCase()}`);
    lines.push(`════════════════════════════════════════════════════════════════`);
  } else {
    lines.push(`──────────────────────────────────────────────────`);
    lines.push(`  ${title}`);
    lines.push(`──────────────────────────────────────────────────`);
  }
  blank(lines);
}

function toc(lines, items) {
  items.forEach((item, i) => {
    const num = String(i + 1).padStart(2, ' ');
    const dots = '.'.repeat(Math.max(2, 56 - item.length));
    lines.push(`  ${num}.  ${item}${dots}${i + 1}`);
  });
}

function kv(lines, key, value, indent = 2) {
  const v = String(value != null ? value : 'N/A').slice(0, 80);
  const spaces = ' '.repeat(indent);
  lines.push(`${spaces}${key}:  ${v}`);
}

function bullet(lines, text, bulletChar = '◆', maxLen = MAX_CHARS_PER_LINE) {
  const wrapped = wrapLines(text, maxLen - 6);
  wrapped.forEach((l, i) => lines.push(i === 0 ? `  ${bulletChar} ${l}` : `      ${l}`));
}

function framed(lines, contentLines, frameChar = '─') {
  const width = 60;
  lines.push(`┌${frameChar.repeat(width)}┐`);
  contentLines.forEach(l => lines.push(`│${l}${' '.repeat(Math.max(0, width - l.length))}│`));
  lines.push(`└${frameChar.repeat(width)}┘`);
}

function framedKeyValue(lines, data, width = 60) {
  lines.push(`┌${'─'.repeat(width)}┐`);
  data.forEach(([key, value]) => {
    const v = String(value != null ? value : 'N/A').slice(0, width - 4);
    lines.push(`│  ${key}:  ${v}${' '.repeat(Math.max(0, width - 6 - key.length - v.length))}│`);
  });
  lines.push(`└${'─'.repeat(width)}┘`);
}

function framedText(lines, title, text, width = 60) {
  lines.push(`┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐`);
  const wrapped = wrapLines(text, width - 4);
  wrapped.forEach(l => lines.push(`│${l}${' '.repeat(Math.max(0, width - l.length))}│`));
  lines.push(`└${'─'.repeat(width)}┘`);
}

function buildCoverPage(data, lines) {
  blank(lines);
  lines.push(`🛡️  CONSUMERSHIELD  —  OFFICIAL CONSUMER COMPLAINT REPORT`);
  lines.push(`                  Automated Consumer Protection Analysis`);
  blank(lines);

  const severity = (data.severity || 'Unknown').toUpperCase();
  const sevEmoji = severity === 'HIGH' ? '🔴' : severity === 'MEDIUM' ? '🟡' : '🟢';
  framed(lines, [
    `COMPLAINT AGAINST:  ${data.company || 'Unknown Website'}`,
    `SEVERITY LEVEL:    ${sevEmoji}  ${severity} RISK`,
    `SUBMITTED TO:     Central Consumer Protection Authority (CCPA), India`,
    `UNDER ACTS:       DPDP Act 2023 | CCPA Guidelines 2023 | Consumer Protection Act 2019`,
  ]);
  blank(lines);

  lines.push(`  TABLE OF CONTENTS`);
  lines.push(`  ────────────────────────────────────────────────────`);
  toc(lines, [
    'Risk Assessment Summary',
    'Dark Pattern Analysis',
    'Third-Party Tracker Details',
    'Summary of Evidence',
    'Consumer Rights & Complaint Guidance',
  ]);
  blank(lines);

  lines.push(`  REPORT DETAILS`);
  lines.push(`  ────────────────────────────────────────────────────`);
  kv(lines, 'Report ID', data.reportId);
  kv(lines, 'Report Date', formatReportDate(data.reportDate));
  kv(lines, 'Generated At', formatDateTime(Date.now()));
  if (data.analysis?.url) kv(lines, 'URL Scanned', data.analysis.url);
  if (data.analysis?.domain) kv(lines, 'Domain', data.analysis.domain);
  kv(lines, 'Consumer', data.name || 'Anonymous');
  blank(lines);
  rule(lines, '═');
}

function buildRiskSummaryPage(data, lines) {
  section(lines, 'Risk Assessment Summary');

  const privacyScore = Number(data.analysis?.privacy?.riskScore || 0);
  const manipulationScore = Number(data.analysis?.manipulation?.riskScore || 0);
  const privacyBar = makeBar(privacyScore);
  const manipulationBar = makeBar(manipulationScore);
  const privacyEmoji = getRiskEmoji(privacyScore);
  const manipulationEmoji = getRiskEmoji(manipulationScore);

  blank(lines);
  lines.push(`  PRIVACY RISK SCORE`);
  blank(lines);
  lines.push(`  ${privacyBar}  ${privacyScore.toFixed(1)} / 10.0`);
  lines.push(`  ${privacyEmoji}  ${privacyScore >= 7 ? 'HIGH RISK' : privacyScore >= 4 ? 'MEDIUM RISK' : 'LOW RISK'}  —  ${getImpactText(privacyScore, 'privacy')}`);
  blank(lines);

  lines.push(`  MANIPULATION RISK SCORE`);
  blank(lines);
  lines.push(`  ${manipulationBar}  ${manipulationScore.toFixed(1)} / 10.0`);
  lines.push(`  ${manipulationEmoji}  ${manipulationScore >= 7 ? 'HIGH RISK' : manipulationScore >= 4 ? 'MEDIUM RISK' : 'LOW RISK'}  —  ${getImpactText(manipulationScore, 'manipulation')}`);
  blank(lines);

  const policy = data.analysis?.privacy?.policy || {};
  const flags = [];
  if (policy.thirdPartySharing) flags.push('⚠️  Third-party data sharing without user consent');
  if (policy.noOptOut) flags.push('⚠️  No opt-out mechanism provided');
  if (policy.extensiveCollection) flags.push('⚠️  Extensive collection of personal data');
  if (data.analysis?.privacy?.fingerprinting) flags.push('⚠️  Browser fingerprinting detected');

  if (flags.length > 0) {
    blank(lines);
    lines.push(`  PRIVACY POLICY RED FLAGS`);
    lines.push(`  ────────────────────────────────────────────────────`);
    flags.forEach(f => bullet(lines, f));
  }
  blank(lines);

  const trackers = data.analysis?.privacy?.trackers || [];
  const totalPatterns = (data.analysis?.manipulation?.patterns || []).length;
  const thirdPartyCount = trackers.filter(t => {
    const domain = (data.analysis?.domain || '').replace('www.', '').toLowerCase();
    const host = (t.hostname || t.url || '').replace('www.', '').toLowerCase();
    return !host.includes(domain);
  }).length;

  lines.push(`  SUMMARY STATISTICS`);
  lines.push(`  ────────────────────────────────────────────────────`);
  kv(lines, 'Total Dark Patterns Detected', totalPatterns);
  kv(lines, 'Total Third-Party Trackers', thirdPartyCount);
  kv(lines, 'Third-Party Domains Contacted', (data.analysis?.privacy?.detectedDomains || []).length);
  blank(lines);
  rule(lines);
}

function getImpactText(score, type) {
  if (type === 'privacy') {
    if (score >= 7) return 'Significant privacy violations detected. Immediate attention recommended.';
    if (score >= 4) return 'Moderate privacy concerns detected. Review recommended.';
    return 'Minimal privacy risks detected. No immediate action required.';
  } else {
    if (score >= 7) return 'Significant dark patterns detected. Immediate attention recommended.';
    if (score >= 4) return 'Moderate manipulative patterns detected. Review recommended.';
    return 'Minimal manipulation detected. No immediate action required.';
  }
}

function buildPatternsPage(data, lines) {
  const patterns = data.analysis?.manipulation?.patterns || [];
  section(lines, 'Dark Pattern Analysis');

  if (patterns.length === 0) {
    lines.push(`  🟢  No dark patterns detected on this page.`);
    blank(lines);
    return;
  }

  lines.push(`  Total Dark Patterns Detected: ${patterns.length}`);
  blank(lines);

  patterns.forEach((p, i) => {
    const sevEmoji = getSeverityEmoji(p.severity);
    const sevLabel = (p.severity || 'unknown').toUpperCase();
    const name = p.name || p.type || 'Unknown Pattern';
    const conf = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : 'N/A';
    const bar = makeBar((p.confidence || 0) * 10);
    const occ = p.occurrence_count || 1;

    const cardLines = [];

    cardLines.push(`PATTERN #${i + 1}  ${sevEmoji}  ${sevLabel} RISK`);
    cardLines.push(`──────────────────────────────────────────────────`);
    cardLines.push(`  Name:         ${name}`);
    cardLines.push(`  Category:     ${p.type || 'unknown'}`);
    cardLines.push(`  Confidence:   ${conf}  ${bar}`);
    cardLines.push(`  Occurrences:  ${occ}`);

    if (p.description) {
      cardLines.push(`  ───────────────────────────────────────────`);
      const descWrapped = wrapLines(p.description, 56);
      cardLines.push(`  Description:`);
      descWrapped.forEach(l => cardLines.push(`    ${l}`));
    }

    if (p.text) {
      cardLines.push(`  ───────────────────────────────────────────`);
      const evWrapped = wrapLines(p.text.slice(0, 300), 56);
      cardLines.push(`  Evidence:`);
      evWrapped.forEach(l => cardLines.push(`    ${l}`));
    }

    if (p.law) {
      cardLines.push(`  ───────────────────────────────────────────`);
      const lawWrapped = wrapLines(p.law, 56);
      cardLines.push(`  Regulatory Reference:`);
      lawWrapped.forEach(l => cardLines.push(`    ${l}`));
    }

    if (p.penalty) {
      const penaltyStr = typeof p.penalty === 'object'
        ? `${p.penalty.min || 'N/A'} — ${p.penalty.max || 'N/A'}`
        : p.penalty;
      cardLines.push(`  Penalty:      ${penaltyStr}`);
    }

    framed(lines, cardLines);
    blank(lines);
  });

  rule(lines);
}

function buildTrackersPage(data, lines) {
  const trackers = data.analysis?.privacy?.trackers || [];
  section(lines, 'Third-Party Tracker Details');

  if (trackers.length === 0) {
    lines.push(`  🟢  No third-party trackers detected.`);
    blank(lines);
    return;
  }

  lines.push(`  Total Trackers Detected: ${trackers.length}`);
  lines.push(`  ────────────────────────────────────────────────────`);
  blank(lines);

  const displayTrackers = trackers.slice(0, 30);
  displayTrackers.forEach((t, i) => {
    const name = (t.name || t.hostname || t.url || 'Unknown').slice(0, 30);
    const cat = (t.category || t.type || 'tracker').slice(0, 12);
    const company = (t.company || t.entity || '-').slice(0, 25);
    const host = (t.hostname || '-').slice(0, 35);

    lines.push(`  Tracker ${String(i + 1).padStart(2, '0')}  ◆  ${name}`);
    lines.push(`           Type: ${cat}  |  Company: ${company}`);
    lines.push(`           Host: ${host}`);
    blank(lines);
  });

  if (trackers.length > 30) {
    lines.push(`  (... ${trackers.length - 30} more trackers not listed ...)`);
    blank(lines);
  }

  const domains = data.analysis?.privacy?.detectedDomains || [];
  if (domains.length > 0) {
    blank(lines);
    lines.push(`  Third-Party Domains Contacted: ${domains.length}`);
    lines.push(`  ────────────────────────────────────────────────────`);
    lines.push(`  ${domains.slice(0, 15).join(', ')}`);
    if (domains.length > 15) {
      lines.push(`  ...and ${domains.length - 15} more.`);
    }
  }

  blank(lines);
  rule(lines);
}

function buildEvidencePage(data, lines) {
  section(lines, 'Summary of Evidence');

  const patterns = data.analysis?.manipulation?.patterns || [];
  if (patterns.length > 0) {
    lines.push(`  DETECTED PATTERNS`);
    lines.push(`  ────────────────────────────────────────────────────`);
    patterns.forEach(p => {
      const conf = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : 'N/A';
      const sevEmoji = getSeverityEmoji(p.severity);
      const sevLabel = (p.severity || 'unknown').toUpperCase();
      lines.push(`  ${sevEmoji}  ${p.name || p.type}  —  ${sevLabel}  (${conf} confidence)`);
    });
    blank(lines);
  }

  const domains = data.analysis?.privacy?.detectedDomains || [];
  if (domains.length > 0) {
    lines.push(`  THIRD-PARTY DOMAINS CONTACTED: ${domains.length}`);
    lines.push(`  ────────────────────────────────────────────────────`);
    lines.push(`  ${domains.slice(0, 15).join(', ')}`);
    if (domains.length > 15) lines.push(`  ...and ${domains.length - 15} more.`);
    blank(lines);
  }

  if (data.laws?.length > 0) {
    section(lines, 'Applicable Laws & Regulations', 2);
    data.laws.forEach(l => bullet(lines, l));
    blank(lines);
  }

  if (data.issues?.length > 0) {
    section(lines, 'Complaint Issues', 2);
    data.issues.forEach(issue => bullet(lines, issue));
    blank(lines);
  }

  rule(lines);
}

function buildRightsPage(data, lines) {
  section(lines, 'Consumer Rights & Complaint Guidance');

  lines.push(`  RIGHTS UNDER DPDP ACT, 2023`);
  lines.push(`  ────────────────────────────────────────────────────`);
  const dpdpRights = [
    'Right to Consent — withdraw consent at any time without detriment',
    'Right to Information — know how and why personal data is being processed',
    'Right to Correction & Erasure — correct inaccurate data, delete personal data',
    'Right to Grievance Redressal — file complaints with the Data Protection Officer (DPO)',
    'Right to Nominated Data Protection Officer assistance',
  ];
  dpdpRights.forEach((r, i) => {
    lines.push(`  ${i + 1}.  ${r}`);
  });
  blank(lines);

  lines.push(`  RIGHTS UNDER CCPA GUIDELINES 2023`);
  lines.push(`  ────────────────────────────────────────────────────`);
  lines.push(`  ◆  Right not to be a victim of dark patterns in e-commerce and digital services`);
  lines.push(`  ◆  Right to clear and truthful product information`);
  lines.push(`  ◆  Right to file complaints at ccpa.gov.in or CCPA helpline`);
  blank(lines);

  lines.push(`  RIGHTS UNDER CONSUMER PROTECTION ACT, 2019`);
  lines.push(`  ────────────────────────────────────────────────────`);
  lines.push(`  ◆  Right not to be a victim of unfair trade practices`);
  lines.push(`  ◆  Right to file complaints at District Consumer Forum`);
  lines.push(`  ◆  Consumer Helpline: 1800-11-4000 (National Consumer Helpline)`);
  lines.push(`  ◆  Online Portal: ingram.gov.in (Integrated Grievance Redressal Mechanism)`);
  blank(lines);

  section(lines, 'How to File a Complaint', 2);
  const steps = [
    'Download and preserve this report as evidence.',
    'File a complaint with the company\'s Data Protection Officer (DPO).',
    'If unresolved within 30 days, escalate to the Data Protection Board under DPDP Act 2023.',
    'For consumer disputes, approach the nearest District Consumer Forum or call 1800-11-4000.',
    'For dark pattern complaints, visit ccpa.gov.in or contact the CCPA grievance portal.',
  ];
  steps.forEach((step, i) => {
    lines.push(`  Step ${i + 1}:  ${step}`);
  });
  blank(lines);

  section(lines, 'Complaint Letter Draft', 2);
  const letterLines = [
    `Subject: Complaint Against Dark Patterns & Privacy Violations — ${data.company || '[Website]'}`,
    ``,
    `Dear Sir/Madam,`,
    ``,
    `I am writing to file a formal complaint regarding deceptive dark patterns and`,
    `privacy violations observed on the website [URL].`,
    ``,
    `The ConsumerShield browser extension detected the following issues:`,
  ];
  letterLines.forEach(l => lines.push(`  ${l}`));
  if (data.issues?.length > 0) {
    data.issues.forEach(issue => lines.push(`    ◆  ${issue}`));
  }
  const letterFooter = [
    ``,
    `I request your office to investigate this matter and take appropriate action`,
    `under the DPDP Act 2023, CCPA Guidelines 2023, and Consumer Protection Act 2019.`,
    ``,
    `Regards,`,
    `[Your Name]`,
    `[Your Contact Details]`,
    `[Date]`,
  ];
  letterFooter.forEach(l => lines.push(`  ${l}`));

  blank(lines);
  rule(lines);
}

function buildPageContent(lines, pageNum, totalPages) {
  const pageLines = [];
  pageLines.push('BT');
  pageLines.push('/F1 12 Tf');
  pageLines.push(`${LINE_HEIGHT} TL`);
  pageLines.push(`${PAGE_MARGIN} ${PAGE_HEIGHT - PAGE_MARGIN} Td`);
  lines.forEach((line, index) => {
    pageLines.push(`(${escapePDFString(line)}) Tj`);
    if (index < lines.length - 1) {
      pageLines.push('T*');
    }
  });
  pageLines.push('ET');
  return pageLines.join('\n');
}

function makePDFObject(id, body) {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function buildPDFDocument(lines) {
  const pageLineCount = Math.floor((PAGE_HEIGHT - PAGE_MARGIN * 2) / LINE_HEIGHT);
  const pages = [];
  for (let i = 0; i < lines.length; i += pageLineCount) {
    pages.push(lines.slice(i, i + pageLineCount));
  }
  const totalPages = pages.length;

  const objects = [];
  objects.push(makePDFObject(1, '<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(makePDFObject(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${totalPages} >>`));
  objects.push(makePDFObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = 5 + index * 2;
    const content = buildPageContent(pageLines, index + 1, totalPages);
    const contentLength = new TextEncoder().encode(`${content}\n`).length;
    objects.push(makePDFObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(makePDFObject(contentId, `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`));
  });

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const encoder = new TextEncoder();
  let offset = encoder.encode(header).length;
  const offsets = [0];
  const bodyParts = [];
  objects.forEach((obj) => {
    offsets.push(offset);
    bodyParts.push(obj);
    offset += encoder.encode(obj).length;
  });
  const xrefLines = ['xref', `0 ${offsets.length}`, '0000000000 65535 f '];
  for (let i = 1; i < offsets.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return encoder.encode(header + bodyParts.join('') + xrefLines.join('\n') + '\n' + trailer);
}

function downloadPDF(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function generateComplaintPDF(data = {}) {
  const reportDate = data.reportDate || new Date().toISOString();
  const reportId = data.reportId || `CS-${Date.now()}`;
  const pdfData = {
    ...data,
    reportDate,
    reportId,
    issues: data.issues || [],
    laws: data.laws || [],
    severity: data.severity || 'Unknown',
  };

  const lines = [];
  buildCoverPage(pdfData, lines);
  buildRiskSummaryPage(pdfData, lines);
  buildPatternsPage(pdfData, lines);
  buildTrackersPage(pdfData, lines);
  buildEvidencePage(pdfData, lines);
  buildRightsPage(pdfData, lines);

  blank(lines, 2);
  lines.push(`════════════════════════════════════════════════════════════════`);
  lines.push(`  🛡️  ConsumerShield — Automated Consumer Protection Analysis`);
  lines.push(`  This report is not a legal document and must be reviewed by a qualified`);
  lines.push(`  consumer protection advisor before filing any formal complaint.`);
  lines.push(`════════════════════════════════════════════════════════════════`);
  lines.push(`  Report ID: ${reportId}  |  Generated: ${formatDateTime(Date.now())}`);
  lines.push('');

  const pdfBytes = buildPDFDocument(lines);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const filename = `Complaint_${sanitizeFileName(pdfData.company || 'ConsumerShield')}.pdf`;
  downloadPDF(filename, blob);
}