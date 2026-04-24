// ─── Page geometry ────────────────────────────────────────────────────────────
const PW  = 595.28;   // A4 width  (points)
const PH  = 841.89;   // A4 height (points)
const ML  = 56;       // left margin
const MR  = 56;       // right margin
const MT  = 60;       // top margin
const MB  = 60;       // bottom margin
const CW  = PW - ML - MR;  // usable column width

// Font sizes (points)
const F_TITLE   = 22;
const F_H1      = 15;
const F_H2      = 12;
const F_BODY    = 10;
const F_SMALL   =  9;

// Leading (line gap) per font size
const leading = (sz) => Math.round(sz * 1.55);

// ─── ASCII safety ─────────────────────────────────────────────────────────────
function a(v) {
  return String(v ?? '').replace(/[^\x20-\x7E]/g, '?');
}

function esc(v) {
  return a(v)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitizeFileName(t) {
  return String(t || 'Complaint').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'Complaint';
}

function fmtDate(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d) ? String(v || '') : d.toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' });
}

function fmtDateTime(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function riskTag(score) {
  if (score >= 7) return 'HIGH RISK';
  if (score >= 4) return 'MEDIUM RISK';
  return 'LOW RISK';
}

function sevTag(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'high')   return 'HIGH';
  if (s === 'medium') return 'MED';
  return 'LOW';
}

// Wrap text to fit within `maxPt` points at font size `sz` (~6 pts per char for Helvetica 10pt)
function wrapText(text, sz, maxPt) {
  const avgCharW = sz * 0.52;
  const maxChars = Math.floor(maxPt / avgCharW);
  const words = a(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length > maxChars) { if (cur) lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ─── PDF primitive: a "block" is { sz, bold, text, indent, spaceAfter }
// We accumulate blocks then paginate them.

function txt(text, sz, opts = {}) {
  return { text: a(text), sz, bold: opts.bold || false, indent: opts.indent || 0, spaceAfter: opts.spaceAfter ?? 0 };
}

function gap(pt = 10) { return { gap: pt }; }

function rule(pt = 0.5, spaceAfter = 12) { return { rule: true, ruleW: pt, spaceAfter }; }

// ─── Section header helpers ───────────────────────────────────────────────────
function h1(text)         { return [gap(18), txt(text, F_H1, { bold: true }), gap(4), rule(0.8, 10)]; }
function h2(text)         { return [gap(14), txt(text, F_H2, { bold: true }), gap(2)]; }
function body(text, indent=0) { return [txt(text, F_BODY, { indent })]; }
function small(text, indent=0){ return [txt(text, F_SMALL, { indent })]; }
function kv(key, val, indent=0){ return [txt(`${key}:  ${a(val ?? 'N/A')}`, F_BODY, { indent })]; }

function push(arr, items) {
  for (const item of (Array.isArray(items) ? items : [items])) arr.push(item);
}

// ─── Page builder ─────────────────────────────────────────────────────────────
function buildCover(data, blocks) {
  push(blocks, gap(24));
  push(blocks, txt('CONSUMERSHIELD', F_TITLE, { bold: true }));
  push(blocks, gap(4));
  push(blocks, txt('Consumer Complaint Report', F_H2));
  push(blocks, gap(16));
  push(blocks, rule(1, 14));

  const sev = (data.severity || 'Unknown').toUpperCase();
  push(blocks, kv('Site',          data.company || data.analysis?.domain || 'Unknown'));
  push(blocks, kv('Severity',      sev + ' RISK'));
  push(blocks, kv('Submitted to',  'Central Consumer Protection Authority (CCPA), India'));
  push(blocks, kv('Under',         'DPDP Act 2023  |  CCPA Guidelines 2023  |  CPA 2019'));
  push(blocks, gap(14));
  push(blocks, rule(0.5, 14));

  push(blocks, kv('Report ID',   data.reportId));
  push(blocks, kv('Date',        fmtDate(data.reportDate)));
  push(blocks, kv('Generated',   fmtDateTime(Date.now())));
  if (data.analysis?.url)    push(blocks, kv('URL',     data.analysis.url));
  if (data.analysis?.domain) push(blocks, kv('Domain',  data.analysis.domain));
  push(blocks, kv('Consumer',    data.name || 'Anonymous'));
  push(blocks, gap(20));
  push(blocks, rule(0.5, 4));

  push(blocks, gap(10));
  push(blocks, txt('Contents', F_H2, { bold: true }));
  push(blocks, gap(6));
  const sections = ['Risk Assessment', 'Dark Patterns Detected', 'Third-Party Trackers', 'Your Rights & How to Complain'];
  sections.forEach((s, i) => push(blocks, txt(`  ${i + 1}.  ${s}`, F_BODY)));
}

function buildRiskPage(data, blocks) {
  push(blocks, h1('Risk Assessment'));

  const priv = Number(data.analysis?.privacy?.riskScore  || 0);
  const manip = Number(data.analysis?.manipulation?.riskScore || 0);
  const patterns = (data.analysis?.manipulation?.patterns || []).length;
  const trackers = (data.analysis?.privacy?.trackers || []).length;
  const domains  = (data.analysis?.privacy?.detectedDomains || []).length;

  // Quick stats row
  push(blocks, gap(4));
  push(blocks, txt(`Privacy Risk: ${priv.toFixed(1)} / 10   (${riskTag(priv)})`, F_BODY));
  push(blocks, gap(6));
  push(blocks, txt(`Manipulation Risk: ${manip.toFixed(1)} / 10   (${riskTag(manip)})`, F_BODY));
  push(blocks, gap(14));

  push(blocks, h2('At a Glance'));
  push(blocks, kv('Dark Patterns Found',       patterns));
  push(blocks, kv('Third-Party Trackers',      trackers));
  push(blocks, kv('Third-Party Domains',       domains));

  // Privacy flags
  const policy = data.analysis?.privacy?.policy || {};
  const flags = [];
  if (policy.thirdPartySharing)           flags.push('Third-party data sharing detected without clear consent');
  if (policy.noOptOut)                    flags.push('No opt-out mechanism found');
  if (policy.extensiveCollection)         flags.push('Extensive personal data collection observed');
  if (data.analysis?.privacy?.fingerprinting) flags.push('Browser fingerprinting detected');

  if (flags.length) {
    push(blocks, h2('Privacy Red Flags'));
    flags.forEach(f => push(blocks, txt('  - ' + f, F_BODY)));
  }

  // What this means
  push(blocks, h2('What This Means'));
  if (manip >= 7) push(blocks, body('This site uses significant manipulative design. Your choices may have been influenced without your awareness.'));
  else if (manip >= 4) push(blocks, body('Moderate manipulation detected. Some design choices may be nudging your decisions.'));
  else push(blocks, body('Low manipulation detected. The site appears mostly fair in its design.'));
  push(blocks, gap(4));
  if (priv >= 7) push(blocks, body('Serious privacy concerns exist. Your data may be shared broadly with third parties.'));
  else if (priv >= 4) push(blocks, body('Moderate privacy concerns. Review what data is collected before engaging further.'));
  else push(blocks, body('Privacy risk is low. Standard data practices appear to be in place.'));
}

function buildPatternsPage(data, blocks) {
  const patterns = data.analysis?.manipulation?.patterns || [];
  push(blocks, h1('Dark Patterns Detected'));

  if (!patterns.length) {
    push(blocks, gap(8));
    push(blocks, body('No dark patterns were detected on this site.'));
    return;
  }

  push(blocks, gap(4));
  push(blocks, small(`${patterns.length} pattern(s) found`));
  push(blocks, gap(8));

  patterns.forEach((p, i) => {
    const name  = a(p.name || p.type || 'Unknown Pattern');
    const sev   = sevTag(p.severity);
    const conf  = p.confidence ? `${(p.confidence * 100).toFixed(0)}% confidence` : '';

    push(blocks, gap(10));
    push(blocks, txt(`${i + 1}.  ${name}  [${sev}]${conf ? '  ' + conf : ''}`, F_BODY, { bold: true }));

    if (p.description) {
      const wrapped = wrapText(p.description, F_BODY, CW - 16);
      wrapped.forEach(l => push(blocks, txt('    ' + l, F_BODY)));
    }
    if (p.text && p.text !== p.description) {
      push(blocks, gap(2));
      push(blocks, small('    Evidence: ' + a(p.text).slice(0, 180), 0));
    }
    if (p.law) {
      push(blocks, small('    Law: ' + a(p.law), 0));
    }
  });
}

function buildTrackersPage(data, blocks) {
  const trackers = data.analysis?.privacy?.trackers || [];
  const domains  = data.analysis?.privacy?.detectedDomains || [];
  push(blocks, h1('Third-Party Trackers'));

  if (!trackers.length) {
    push(blocks, gap(8));
    push(blocks, body('No third-party trackers were detected.'));
    return;
  }

  push(blocks, gap(4));
  push(blocks, small(`${trackers.length} tracker(s) detected across ${domains.length} domain(s)`));
  push(blocks, gap(10));

  const show = trackers.slice(0, 20);
  show.forEach((t, i) => {
    const name    = a((t.name || t.hostname || t.url || 'Unknown').slice(0, 40));
    const cat     = a(t.category || t.type || 'tracker');
    const company = t.company || t.entity ? `  (${a((t.company || t.entity).slice(0, 30))})` : '';
    push(blocks, txt(`${String(i + 1).padStart(2, ' ')}.  ${name}${company}`, F_BODY));
    push(blocks, small(`      Type: ${cat}    Host: ${a((t.hostname || '-').slice(0, 40))}`, 0));
    push(blocks, gap(3));
  });

  if (trackers.length > 20) {
    push(blocks, gap(4));
    push(blocks, small(`... and ${trackers.length - 20} more trackers not shown.`));
  }

  if (domains.length) {
    push(blocks, h2('Domains Contacted'));
    const shown = domains.slice(0, 12).map(a).join(', ');
    const wrapped = wrapText(shown, F_SMALL, CW);
    wrapped.forEach(l => push(blocks, small(l)));
    if (domains.length > 12) push(blocks, small(`... and ${domains.length - 12} more.`));
  }
}

function buildRightsPage(data, blocks) {
  push(blocks, h1('Your Rights & How to Complain'));

  push(blocks, h2('Rights under DPDP Act 2023'));
  [
    'Withdraw consent at any time without penalty',
    'Know how your personal data is used',
    'Correct or erase inaccurate data',
    'File a grievance with the company DPO',
    'Escalate to the Data Protection Board if unresolved',
  ].forEach((r, i) => push(blocks, txt(`  ${i + 1}.  ${r}`, F_BODY)));

  push(blocks, h2('Rights under CCPA Guidelines 2023'));
  [
    'Not to be subjected to dark patterns in digital services',
    'To receive clear and truthful product information',
    'To file complaints at ccpa.gov.in',
  ].forEach(r => push(blocks, txt('  -  ' + r, F_BODY)));

  push(blocks, h2('How to Act'));
  [
    'Save this report as evidence.',
    "Contact the company's Data Protection Officer (DPO) first.",
    'If unresolved within 30 days, escalate to the Data Protection Board.',
    'For consumer disputes: call 1800-11-4000 or visit ingram.gov.in.',
    'For dark patterns: file at ccpa.gov.in.',
  ].forEach((s, i) => push(blocks, txt(`  Step ${i + 1}:  ${s}`, F_BODY)));

  push(blocks, h2('Template Complaint Letter'));
  push(blocks, gap(4));
  const company = a(data.company || '[Website Name]');
  [
    `Subject: Complaint Against Dark Patterns & Privacy Violations - ${company}`,
    ``,
    `Dear Sir/Madam,`,
    ``,
    `I am writing to formally complain about deceptive dark patterns and privacy`,
    `violations I observed on ${company}.`,
    ``,
    `The ConsumerShield extension detected the following issues:`,
  ].forEach(l => push(blocks, txt('  ' + l, F_BODY)));

  if (data.issues?.length) {
    data.issues.forEach(issue => push(blocks, txt('    - ' + a(issue), F_BODY)));
  }

  [
    ``,
    `I request your office to investigate and take action under the DPDP Act 2023,`,
    `CCPA Guidelines 2023, and Consumer Protection Act 2019.`,
    ``,
    `Regards,`,
    `[Your Name]  |  [Contact]  |  [Date]`,
  ].forEach(l => push(blocks, txt('  ' + l, F_BODY)));
}

// ─── PDF rendering engine ─────────────────────────────────────────────────────

function makePDFObject(id, body) {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

// Render all blocks into pages. Returns array of page content strings.
function paginate(blocks) {
  const usableH = PH - MT - MB;
  const pages = [];
  let ops = [];      // current page PDF ops
  let y = PH - MT;  // current Y cursor (PDF coords, top-down)

  function newPage() {
    if (ops.length) pages.push(ops.join('\n'));
    ops = [];
    y = PH - MT;
  }

  function ensure(needed) {
    if (y - needed < MB) newPage();
  }

  function drawText(text, sz, bold, xOff) {
    const font = bold ? '/F2' : '/F1';
    ops.push(`${font} ${sz} Tf`);
    ops.push(`${ML + xOff} ${y} Td`);
    ops.push(`(${esc(text)}) Tj`);
    ops.push('0 0 Td'); // reset relative position for next absolute Td
  }

  function drawRule(ruleW) {
    ops.push(`${ruleW} w`);
    ops.push(`${ML} ${y} m`);
    ops.push(`${PW - MR} ${y} l`);
    ops.push('S');
  }

  // Always start with BT
  ops.push('BT');
  let inBT = true;

  function closeBT()  { if (inBT) { ops.push('ET'); inBT = false; } }
  function openBT()   { if (!inBT) { ops.push('BT'); inBT = true; } }

  for (const block of blocks) {
    if (block.gap !== undefined) {
      y -= block.gap;
      if (y < MB) newPage();
      continue;
    }

    if (block.rule) {
      ensure(block.spaceAfter + 4);
      closeBT();
      drawRule(block.ruleW || 0.5);
      y -= (block.spaceAfter || 4);
      continue;
    }

    // Text block — wrap to CW
    const wrapped = wrapText(block.text, block.sz, CW - block.indent);
    const lh = leading(block.sz);

    for (const line of wrapped) {
      ensure(lh + 2);
      openBT();
      ops.push(`1 0 0 1 0 0 Tm`); // reset text matrix
      drawText(line, block.sz, block.bold, block.indent || 0);
      y -= lh;
    }

    if (block.spaceAfter) y -= block.spaceAfter;
  }

  closeBT();
  if (ops.length) pages.push(ops.join('\n'));
  return pages;
}

function buildPDFDocument(pageContents) {
  const totalPages = pageContents.length;
  const objects = [];

  // Font resources: F1=Helvetica, F2=Helvetica-Bold
  const fontRes = '<< /F1 3 0 R /F2 4 0 R >>';
  const resources = `<< /Font ${fontRes} >>`;

  objects.push(makePDFObject(1, '<< /Type /Catalog /Pages 2 0 R >>'));
  const kidRefs = pageContents.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push(makePDFObject(2, `<< /Type /Pages /Kids [${kidRefs}] /Count ${totalPages} >>`));
  objects.push(makePDFObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  objects.push(makePDFObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

  pageContents.forEach((content, i) => {
    const pageId    = 5 + i * 2;
    const contentId = 6 + i * 2;
    const len = content.length;
    objects.push(makePDFObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${resources} /Contents ${contentId} 0 R >>`));
    objects.push(makePDFObject(contentId, `<< /Length ${len} >>\nstream\n${content}\nendstream`));
  });

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const encoder = new TextEncoder();
  let offset = encoder.encode(header).length;
  const offsets = [0];
  const parts = [];

  objects.forEach(obj => {
    offsets.push(offset);
    parts.push(obj);
    offset += encoder.encode(obj).length;
  });

  const xref = ['xref', `0 ${offsets.length}`, '0000000000 65535 f '];
  for (let i = 1; i < offsets.length; i++) {
    xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return encoder.encode(header + parts.join('') + xref.join('\n') + '\n' + trailer);
}

function downloadPDF(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Public entry point ───────────────────────────────────────────────────────
export function generateComplaintPDF(data = {}) {
  const reportId   = data.reportId || `CS-${Date.now()}`;
  const reportDate = data.reportDate || new Date().toISOString();
  const pdfData = {
    ...data,
    reportId,
    reportDate,
    issues:   data.issues   || [],
    laws:     data.laws     || [],
    severity: data.severity || 'Unknown',
  };

  const blocks = [];
  buildCover(pdfData, blocks);
  buildRiskPage(pdfData, blocks);
  buildPatternsPage(pdfData, blocks);
  buildTrackersPage(pdfData, blocks);
  buildRightsPage(pdfData, blocks);

  // Footer note
  push(blocks, [gap(20), rule(0.5, 6)]);
  push(blocks, small('This report is auto-generated by ConsumerShield and is not a legal document.'));
  push(blocks, small(`Report ID: ${reportId}   Generated: ${fmtDateTime(Date.now())}`));

  const pageContents = paginate(blocks);
  const bytes = buildPDFDocument(pageContents);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  downloadPDF(`Complaint_${sanitizeFileName(pdfData.company || 'ConsumerShield')}.pdf`, blob);
}