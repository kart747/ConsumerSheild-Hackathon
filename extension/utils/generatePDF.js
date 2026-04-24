const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 40;
const LINE_HEIGHT = 14;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const MAX_CHARS_PER_LINE = 88;

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

function getRiskLevel(score) {
  const s = Number(score) || 0;
  if (s >= 7) return 'HIGH';
  if (s >= 4) return 'MEDIUM';
  return 'LOW';
}

function getSeverityLabel(severity) {
  const s = (severity || '').toLowerCase();
  if (s === 'high') return '[HIGH RISK]';
  if (s === 'medium') return '[MEDIUM RISK]';
  if (s === 'low') return '[LOW RISK]';
  return '[UNKNOWN RISK]';
}

function hr(lines, char = '-', len = 60) {
  lines.push(char.repeat(len));
}

function section(lines, title) {
  lines.push('');
  lines.push(`== ${title.toUpperCase()} ==`);
  lines.push('');
}

function kv(lines, key, value) {
  const v = String(value != null ? value : 'N/A').slice(0, 120);
  lines.push(`  ${key}: ${v}`);
}

function bullet(lines, text, maxLen = MAX_CHARS_PER_LINE) {
  const wrapped = wrapLines(text, maxLen - 4);
  wrapped.forEach((l, i) => lines.push(i === 0 ? `  * ${l}` : `    ${l}`));
}

function blank(lines, count = 1) {
  for (let i = 0; i < count; i++) lines.push('');
}

function buildCoverPage(data, lines) {
  blank(lines);
  lines.push('============================================================');
  lines.push('              CONSUMERSHIELD — COMPLAINT REPORT               ');
  lines.push('============================================================');
  blank(lines);
  lines.push(`Complaint Against: ${data.company || 'Unknown Website'}`);
  lines.push(`Severity Level:     ${(data.severity || 'Unknown').toUpperCase()} RISK`);
  blank(lines);
  lines.push('--- SUBMITTED TO ---');
  lines.push('  Central Consumer Protection Authority (CCPA), India');
  lines.push('  Under DPDP Act 2023 & CCPA Guidelines 2023');
  blank(lines);
  lines.push('--- REPORT DETAILS ---');
  kv(lines, 'Report ID', data.reportId);
  kv(lines, 'Report Date', formatReportDate(data.reportDate));
  kv(lines, 'Generated At', formatDateTime(Date.now()));
  if (data.analysis?.url) kv(lines, 'URL Scanned', data.analysis.url);
  if (data.analysis?.domain) kv(lines, 'Domain', data.analysis.domain);
  blank(lines);
  lines.push(`Consumer Name:      ${data.name || 'Anonymous'}`);
  blank(lines);
  hr(lines, '=');
}

function buildRiskSummaryPage(data, lines) {
  section(lines, 'Risk Assessment Summary');
  const privacyScore = Number(data.analysis?.privacy?.riskScore || 0);
  const manipulationScore = Number(data.analysis?.manipulation?.riskScore || 0);
  const privacyLevel = getRiskLevel(privacyScore);
  const manipulationLevel = getRiskLevel(manipulationScore);
  blank(lines);
  lines.push('--- PRIVACY RISK ---');
  lines.push(`  Score:   ${privacyScore.toFixed(1)} / 10 — ${privacyLevel}`);
  lines.push(`  Impact:  ${privacyScore >= 7 ? 'Significant privacy violations detected.' : privacyScore >= 4 ? 'Moderate privacy concerns found.' : 'Minimal privacy risks detected.'}`);
  blank(lines);
  lines.push('--- MANIPULATION RISK ---');
  lines.push(`  Score:   ${manipulationScore.toFixed(1)} / 10 — ${manipulationLevel}`);
  lines.push(`  Impact:  ${manipulationScore >= 7 ? 'Significant dark patterns detected.' : manipulationScore >= 4 ? 'Moderate manipulative patterns found.' : 'Minimal manipulation detected.'}`);
  blank(lines);
  lines.push('--- PRIVACY POLICY FLAGS ---');
  const policy = data.analysis?.privacy?.policy || {};
  const flags = [];
  if (policy.thirdPartySharing) flags.push('Third-party data sharing without user consent');
  if (policy.noOptOut) flags.push('No opt-out mechanism provided');
  if (policy.extensiveCollection) flags.push('Extensive collection of personal data');
  if (data.analysis?.privacy?.fingerprinting) flags.push('Browser fingerprinting detected');
  if (flags.length === 0) {
    lines.push('  No major privacy policy red flags detected.');
  } else {
    flags.forEach(f => bullet(lines, f));
  }
  blank(lines);
  lines.push(`Total Trackers Detected: ${data.analysis?.privacy?.trackers?.length || 0}`);
  const firstPartyTrackers = (data.analysis?.privacy?.trackers || []).filter(t => {
    const domain = data.analysis?.domain || '';
    const trackerHost = (t.hostname || t.url || '').toLowerCase();
    return !trackerHost.includes(domain.replace('www.', ''));
  });
  const thirdPartyCount = firstPartyTrackers.length;
  lines.push(`  Third-party trackers: ${thirdPartyCount}`);
  if (firstPartyTrackers.length > 0) {
    const uniqueDomains = [...new Set(firstPartyTrackers.map(t => t.hostname || t.company || t.url || 'Unknown'))].slice(0, 20);
    uniqueDomains.forEach(d => bullet(lines, d, MAX_CHARS_PER_LINE - 6));
    if (uniqueDomains.length >= 20) {
      lines.push(`  ...and ${firstPartyTrackers.length - 20} more trackers.`);
    }
  }
  blank(lines);
  hr(lines);
}

function buildPatternsPage(data, lines) {
  const patterns = data.analysis?.manipulation?.patterns || [];
  section(lines, 'Dark Pattern Analysis');
  if (patterns.length === 0) {
    lines.push('  No dark patterns detected on this page.');
    blank(lines);
    return;
  }
  lines.push(`Total Dark Patterns Detected: ${patterns.length}`);
  blank(lines);
  patterns.forEach((p, i) => {
    lines.push(`--- PATTERN #${i + 1} ---`);
    const severityBadge = getSeverityLabel(p.severity);
    const name = p.name || p.type || 'Unknown Pattern';
    lines.push(`  Name:       ${name} ${severityBadge}`);
    lines.push(`  Category:   ${p.type || 'unknown'}`);
    const conf = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : 'N/A';
    lines.push(`  Confidence: ${conf}`);
    lines.push(`  Occurrences: ${p.occurrence_count || 1}`);
    blank(lines);
    if (p.description) {
      lines.push('  Description:');
      bullet(lines, p.description);
    }
    blank(lines);
    if (p.text) {
      lines.push('  Evidence Text:');
      bullet(lines, p.text.slice(0, 300), MAX_CHARS_PER_LINE - 6);
    }
    blank(lines);
    if (p.law) {
      lines.push('  Regulatory Reference:');
      bullet(lines, p.law, MAX_CHARS_PER_LINE - 6);
    }
    if (p.penalty) {
      const penaltyStr = typeof p.penalty === 'object' ? `${p.penalty.min || 'N/A'} — ${p.penalty.max || 'N/A'}` : p.penalty;
      lines.push(`  Penalty:    ${penaltyStr}`);
    }
    blank(lines);
  });
  hr(lines);
}

function buildTrackersPage(data, lines) {
  const trackers = data.analysis?.privacy?.trackers || [];
  section(lines, 'Third-Party Tracker Details');
  if (trackers.length === 0) {
    lines.push('  No third-party trackers detected.');
    blank(lines);
    return;
  }
  lines.push(`Total Trackers: ${trackers.length}`);
  blank(lines);
  trackers.slice(0, 40).forEach((t, i) => {
    const name = t.name || t.hostname || t.url || 'Unknown Tracker';
    const cat = t.category || t.type || 'tracker';
    const company = t.company || t.entity || '-';
    const host = t.hostname || '-';
    lines.push(`--- Tracker ${i + 1} ---`);
    lines.push(`  Name:    ${name}`);
    lines.push(`  Type:    ${cat}`);
    lines.push(`  Company: ${company}`);
    lines.push(`  Host:    ${host}`);
    blank(lines);
  });
  if (trackers.length > 40) {
    lines.push(`(... ${trackers.length - 40} more trackers not listed ...)`);
  }
  blank(lines);
  const domains = data.analysis?.privacy?.detectedDomains || [];
  if (domains.length > 0) {
    section(lines, 'Third-Party Domains Contacted');
    lines.push(`Total Domains: ${domains.length}`);
    blank(lines);
    domains.slice(0, 30).forEach(d => bullet(lines, d));
    if (domains.length > 30) {
      lines.push(`(... ${domains.length - 30} more domains ...)`);
    }
  }
  blank(lines);
  hr(lines);
}

function buildEvidencePage(data, lines) {
  section(lines, 'Summary of Evidence');
  const patterns = data.analysis?.manipulation?.patterns || [];
  if (patterns.length > 0) {
    lines.push('Detected Patterns:');
    patterns.forEach(p => {
      const conf = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : 'N/A';
      lines.push(`  * ${p.name || p.type} — Severity: ${(p.severity || 'unknown').toUpperCase()}, Confidence: ${conf}`);
    });
  }
  blank(lines);
  const domains = data.analysis?.privacy?.detectedDomains || [];
  if (domains.length > 0) {
    lines.push(`Third-party domains contacted: ${domains.length}`);
    lines.push('  ' + domains.slice(0, 15).join(', '));
    if (domains.length > 15) lines.push(`  ...and ${domains.length - 15} more.`);
  }
  blank(lines);
  if (data.laws?.length > 0) {
    section(lines, 'Applicable Laws & Regulations');
    data.laws.forEach(l => bullet(lines, l));
    blank(lines);
  }
  if (data.issues?.length > 0) {
    section(lines, 'Complaint Issues');
    data.issues.forEach(issue => bullet(lines, issue));
    blank(lines);
  }
  hr(lines);
}

function buildRightsPage(data, lines) {
  section(lines, 'Consumer Rights & Complaint Guidance');
  blank(lines);
  lines.push('--- RIGHTS UNDER DPDP ACT, 2023 (INDIA) ---');
  lines.push('  Consumers have the following rights under this Act:');
  lines.push('  1. Right to Consent — withdraw consent at any time without detriment.');
  lines.push('  2. Right to Information — know how and why personal data is being processed.');
  lines.push('  3. Right to Correction & Erasure — correct inaccurate data, delete personal data.');
  lines.push('  4. Right to Grievance Redressal — file complaints with the Data Protection Officer (DPO).');
  lines.push('  5. Right to Nominated Data Protection Officer assistance.');
  blank(lines);
  lines.push('--- RIGHTS UNDER CCPA GUIDELINES 2023 ---');
  lines.push('  The Central Consumer Protection Authority Guidelines specifically prohibit:');
  lines.push('  * Dark patterns in e-commerce and digital services.');
  lines.push('  * Deceptive practices that manipulate consumer choice.');
  lines.push('  * Unfair trade practices that cause financial harm to consumers.');
  lines.push('  * File complaints at ccpa.gov.in or call the CCPA helpline.');
  blank(lines);
  lines.push('--- RIGHTS UNDER CONSUMER PROTECTION ACT, 2019 ---');
  lines.push('  * Right not to be a victim of unfair trade practices.');
  lines.push('  * Right to file complaints at District Consumer Forum.');
  lines.push('  * Consumer Helpline: 1800-11-4000 (National Consumer Helpline).');
  lines.push('  * Online Portal: ingram.gov.in (Integrated Grievance Redressal Mechanism).');
  blank(lines);
  section(lines, 'How to File a Complaint');
  lines.push('  Step 1: Download and preserve this report as evidence.');
  lines.push('  Step 2: File a complaint with the companys Data Protection Officer (DPO).');
  lines.push('  Step 3: If unresolved within 30 days, escalate to the Data Protection Board');
  lines.push('           constituted under DPDP Act 2023.');
  lines.push('  Step 4: For consumer disputes, approach the District Consumer Forum or');
  lines.push('           National Consumer Helpline (1800-11-4000).');
  lines.push('  Step 5: For CCPA dark pattern complaints, visit ccpa.gov.in or contact');
  lines.push('           the CCPA through their official grievance portal.');
  blank(lines);
  section(lines, 'Complaint Reference Templates');
  lines.push('  Subject: Complaint Against Dark Patterns & Privacy Violations — [Website Name]');
  lines.push('  ');
  lines.push('  Dear Sir/Madam,');
  lines.push('  ');
  lines.push('  I am writing to file a formal complaint regarding deceptive dark patterns');
  lines.push('  and privacy violations observed on the website [URL].');
  lines.push('  ');
  lines.push('  The ConsumerShield browser extension detected the following issues:');
  if (data.issues?.length > 0) {
    data.issues.forEach(issue => lines.push(`  - ${issue}`));
  }
  lines.push('  ');
  lines.push('  I request your office to investigate this matter and take appropriate action');
  lines.push('  under the DPDP Act 2023, CCPA Guidelines 2023, and Consumer Protection');
  lines.push('  Act 2019.');
  lines.push('  ');
  lines.push('  Regards,');
  lines.push('  [Your Name]');
  blank(lines);
  hr(lines);
}

function buildPageContent(lines) {
  const content = [];
  content.push('BT');
  content.push('/F1 12 Tf');
  content.push(`${LINE_HEIGHT} TL`);
  content.push(`${PAGE_MARGIN} ${PAGE_HEIGHT - PAGE_MARGIN} Td`);
  lines.forEach((line, index) => {
    content.push(`(${escapePDFString(line)}) Tj`);
    if (index < lines.length - 1) {
      content.push('T*');
    }
  });
  content.push('ET');
  return content.join('\n');
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
  const objects = [];
  objects.push(makePDFObject(1, '<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(makePDFObject(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  objects.push(makePDFObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = 5 + index * 2;
    const content = buildPageContent(pageLines);
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
  lines.push('============================================================');
  lines.push('  This report is generated by ConsumerShield automated analysis.');
  lines.push('  It is not a legal document and should be reviewed by a qualified');
  lines.push('  consumer protection advisor before filing any formal complaint.');
  lines.push('============================================================');
  lines.push('');
  lines.push(`Report ID: ${reportId} | Generated: ${formatDateTime(Date.now())}`);
  lines.push('');

  const pdfBytes = buildPDFDocument(lines);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const filename = `Complaint_${sanitizeFileName(pdfData.company || 'ConsumerShield')}.pdf`;
  downloadPDF(filename, blob);
}