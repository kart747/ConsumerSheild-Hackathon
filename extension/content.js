/**
 * ConsumerShield — Content Script
 * Runs on every page. Detects:
 *   1. Privacy violations (trackers, policy issues, fingerprinting)
 *   2. Dark patterns (8 types per CCPA Guidelines 2023)
 *   3. Applies visual overlays (blue = privacy, red = manipulation)
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // TRACKER EXTRACTOR (Dynamic collection for Backend Radar Lite)
  // ═══════════════════════════════════════════════════════════════════════════

  const KNOWN_TRACKERS = [
    // Analytics
    { domain: 'google-analytics.com',  type: 'analytics',    name: 'Google Analytics' },
    { domain: 'googletagmanager.com',  type: 'analytics',    name: 'Google Tag Manager' },
    { domain: 'analytics.google.com',  type: 'analytics',    name: 'Google Analytics 4' },
    { domain: 'hotjar.com',            type: 'analytics',    name: 'Hotjar' },
    { domain: 'mixpanel.com',          type: 'analytics',    name: 'Mixpanel' },
    { domain: 'amplitude.com',         type: 'analytics',    name: 'Amplitude' },
    { domain: 'segment.com',           type: 'analytics',    name: 'Segment' },
    { domain: 'heap.io',               type: 'analytics',    name: 'Heap Analytics' },
    { domain: 'newrelic.com',          type: 'analytics',    name: 'New Relic' },
    { domain: 'nr-data.net',           type: 'analytics',    name: 'New Relic Browser' },
    { domain: 'clarity.ms',            type: 'analytics',    name: 'Microsoft Clarity' },
    { domain: 'omtrdc.net',            type: 'analytics',    name: 'Adobe Analytics' },
    { domain: 'adobedtm.com',          type: 'analytics',    name: 'Adobe Tag Manager' },
    { domain: 'clevertap.com',         type: 'analytics',    name: 'CleverTap' },
    { domain: 'webengage.com',         type: 'analytics',    name: 'WebEngage' },
    { domain: 'moengage.com',          type: 'analytics',    name: 'MoEngage' },
    // Advertising
    { domain: 'doubleclick.net',       type: 'advertising',  name: 'DoubleClick (Google)' },
    { domain: 'googlesyndication.com', type: 'advertising',  name: 'Google AdSense' },
    { domain: 'googleadservices.com',  type: 'advertising',  name: 'Google Ad Services' },
    { domain: 'amazon-adsystem.com',   type: 'advertising',  name: 'Amazon AdSystem' },
    { domain: 'adsystem.amazon.com',   type: 'advertising',  name: 'Amazon AdSystem' },
    { domain: 'adservice.google.com',  type: 'advertising',  name: 'Google AdService' },
    { domain: 'criteo.com',            type: 'advertising',  name: 'Criteo' },
    { domain: 'taboola.com',           type: 'advertising',  name: 'Taboola' },
    { domain: 'outbrain.com',          type: 'advertising',  name: 'Outbrain' },
    { domain: 'moat.com',              type: 'advertising',  name: 'Moat Analytics' },
    { domain: 'branch.io',             type: 'advertising',  name: 'Branch Attribution' },
    // Social
    { domain: 'facebook.com',          type: 'social',       name: 'Facebook Pixel' },
    { domain: 'connect.facebook.net',  type: 'social',       name: 'Facebook SDK' },
    { domain: 'platform.twitter.com',  type: 'social',       name: 'Twitter Analytics' },
    { domain: 'linkedin.com',          type: 'social',       name: 'LinkedIn Insight' },
    { domain: 'snap.com',              type: 'social',       name: 'Snapchat Pixel' },
    // Data Brokers
    { domain: 'scorecardresearch.com', type: 'data_broker',  name: 'Comscore/Scorecard' },
    { domain: 'quantserve.com',        type: 'data_broker',  name: 'Quantcast' },
    { domain: 'bluekai.com',           type: 'data_broker',  name: 'Oracle BlueKai' },
    { domain: 'adnxs.com',             type: 'data_broker',  name: 'AppNexus (Xandr)' },
    { domain: 'rubiconproject.com',    type: 'data_broker',  name: 'Rubicon Project' },
  ];

  const TRACKER_SCRIPT_SIGNATURES = [
    { regex: /\bgtag\s*\(|googletagmanager|ga\(/i, name: 'Google Analytics', type: 'analytics', domain: 'google-analytics.com', confidence: 0.82 },
    { regex: /\bfbq\s*\(|facebook\s*pixel/i, name: 'Facebook Pixel', type: 'social', domain: 'connect.facebook.net', confidence: 0.82 },
    { regex: /\bclarity\s*\(/i, name: 'Microsoft Clarity', type: 'analytics', domain: 'clarity.ms', confidence: 0.8 },
    { regex: /\bmixpanel\b/i, name: 'Mixpanel', type: 'analytics', domain: 'mixpanel.com', confidence: 0.8 },
    { regex: /\bsegment\b|analytics\.track\(/i, name: 'Segment', type: 'analytics', domain: 'segment.com', confidence: 0.78 },
    { regex: /\bhotjar\b/i, name: 'Hotjar', type: 'analytics', domain: 'hotjar.com', confidence: 0.78 },
  ];

  const TRACKING_HOST_HINTS = /(analytics|pixel|track|tracker|telemetry|metrics|remarketing|adservice|doubleclick|insight|beacon|tagmanager|moengage|webengage|clevertap|criteo|taboola|outbrain)/i;

  // ═══════════════════════════════════════════════════════════════════════════
  // E-COMMERCE DOMAINS FOR INFINITE SCROLL DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  const ECOMMERCE_DOMAINS = [
    'flipkart.com',
    'amazon.in',
    'amazon.com',
    'myntra.com',
    'ajio.com',
    'snapdeal.com',
    'meesho.com',
    'reliancedigital.in',
    'croma.com',
    'tatacliq.com'
  ];

  function isEcommerceDomain() {
    const hostname = window.location.hostname.toLowerCase();
    return ECOMMERCE_DOMAINS.some(domain => hostname.includes(domain));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DARK PATTERN SIGNATURES
  // ═══════════════════════════════════════════════════════════════════════════

  const DARK_PATTERNS = {
    urgency: {
      name: 'False Urgency',
      severity: 'high',
      law: 'CCPA Dark Patterns Guidelines 2023 — False Urgency',
      penalty: '₹10 lakh – ₹50 lakh',
      description: 'Creates artificial scarcity or time pressure to force rushed decisions.',
      patterns: [
        /\bfalse\s*urgency\b/i,
        /only\s*(\d+|one|two|three|few|several)\s*(left|remaining|in stock|available|spots)/i,
        /hurry[!,\s]*only/i,
        /selling\s*out|sold\s*out/i,
        /selling\s*fast|going\s*fast/i,
        /limited\s*(time|offer|stock|quantity|edition|seats|availability)/i,
        /(\d+)\s*people\s*(are\s*)?(viewing|watching|looking at|browsing|interested)/i,
        /sale\s*ends?\s*(in|at|tonight|today|tomorrow|soon)/i,
        /(\d+)\s*(hours?|mins?|minutes?|seconds?)\s*(left|remaining|till|until)/i,
        /don'?t\s*miss\s*(out|this|the)/i,
        /last\s*(chance|opportunity|few|day|hours?|minute)/i,
        /ends?\s*(tonight|today|noon|midnight|soon|very soon)/i,
        /act\s*now/i,
        /before\s*(it's?\s*)?(gone|sold out)/i,
        /countdown\s*timer|timer\s*countdown/i,
        /offer\s*expires?/i,
        /\d+%\s*off.*only.*today/i,
        /flash\s*sale/i,
        /exclusive.*limited/i,
        /buy\s*now/i,
        /(?:almost|nearly|almost all)\s*(?:gone|sold out|sold)/i,
      ],
    },
    sneaking: {
      name: 'Hidden Costs (Drip Pricing)',
      severity: 'high',
      law: 'CCPA Dark Patterns Guidelines 2023 — Drip Pricing',
      penalty: '₹25 lakh – ₹50 lakh',
      description: 'Hides additional charges until late in the checkout process.',
      patterns: [
        /\b(sneaking|drip\s*pricing|hidden\s*costs?)\b/i,
        /convenience\s*fee/i,
        /handling\s*(charges?|fee|cost)/i,
        /platform\s*fee/i,
        /processing\s*(fee|charges?|cost)/i,
        /\+\s*(?:taxes?|tds)?\s*&?\s*(?:and\s*)?fees?/i,
        /additional\s*(?:charges?|fees?|costs?)\s*(?:may\s*)?apply/i,
        /delivery\s*(?:fee|charges?|cost)\s*(?:added\s*)?(?:at\s*|during\s*)?checkout/i,
        /service\s*(?:fee|charges?)/i,
        /booking\s*fee/i,
        /transaction\s*fee/i,
        /surcharge/i,
        /(?:see|view|check).*charges.*at.*checkout/i,
        /final\s*(?:price|total).*may\s*differ/i,
        /taxes?\s*(?:and\s*)?(?:fees?|duties)\s*(?:to\s*)?(?:be\s*)?(?:added|calculated)/i,
      ],
    },
    confirmshaming: {
      name: 'Confirmshaming',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Confirmshaming',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Uses guilt-inducing language to shame users into accepting offers.',
      patterns: [
        /\bconfirm\s*shaming\b/i,
        /no\s*(?:thanks?|thanx)[,.]?\s*i\s*(?:don'?t|prefer not|hate|refuse|skip|decline)/i,
        /no[,.]?\s*i\s*(?:enjoy|love|like|prefer)\s*(?:paying|spending|wasting|overpaying)/i,
        /i\s*(?:don'?t|do not|really don'?t|never)\s*(?:care|want|need)\s*(?:about|for)?\s*(?:saving|discount|deals?|money)/i,
        /skip[,.]?\s*i'?m?\s*(?:fine|okay|good|happy)\s*(?:with|without)\s*(?:paying|high prices|full price)/i,
        /no\s*thanks\s*i\s*prefer\s*to\s*(?:pay|overpay)/i,
        /decline.*(?:pay more|lose|miss)/i,
        /i'?d\s*rather\s*(?:not|decline)/i,
        /maybe\s*later.*let.*miss/i,
        /turn\s*(?:down|away|decline).*(?:save|offer|deal)/i,
      ],
    },
    trick_questions: {
      name: 'Trick Questions / Double Negatives',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Trick Questions',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Uses confusing double negatives or ambiguous language on consent forms.',
      patterns: [
        /\b(trick\s*questions?|trick\s*wording|double\s*negatives?)\b/i,
        /uncheck\s*(?:this\s*)?(?:box|if)\s*(?:to\s*)?(?:not|stop|opt[\s-]?out)/i,
        /do\s*not\s*(?:un)?check\s*(?:if\s*)?you\s*do\s*not\s*want/i,
        /opt\s*out\s*of\s*(?:not\s*)?receiving/i,
        /untick\s*(?:to\s*)?(?:opt[\s-]?out|receive|unsubscribe)/i,
        /leave.*checked.*continue/i,
        /(?:leaving|keep|keep it)\s*(?:this|this box|it)\s*checked.*(?:means|means you|opt|agree|accept)/i,
        /double\s*negative/i,
      ],
    },
    forced_continuity: {
      name: 'Forced Continuity',
      severity: 'high',
      law: 'CCPA Dark Patterns Guidelines 2023 — Forced Continuity',
      penalty: '₹25 lakh – ₹50 lakh',
      description: 'Auto-renews subscriptions without clear notice or easy cancellation.',
      patterns: [
        /\bforced\s*continuity\b/i,
        /automatically\s*(?:renew|charge|bill|debit)(?:ed)?/i,
        /auto[\s-]?(?:renew|renewal|billing)/i,
        /cancel\s*(?:any\s*)?time|cancel\s*(?:within|after)/i,
        /charged\s*(?:automatically|recurring)/i,
        /free\s*trial.*(?:then\s*)?(?:\$|₹|rs\.?)\s*[\d,\.]+/i,
        /subscription\s*(?:renews?|billed|charged)\s*(?:monthly|annually|yearly|quarterly)/i,
        /after.*free.*trial.*will.*charge/i,
        /continue.*subscription/i,
        /billing\s*(?:will|by default|automatically)/i,
        /recurring\s*(?:charges?|billing)/i,
        /to\s*(?:cancel|stop)\s*(?:subscription|charges?|billing).*(?:contact|call|visit)/i,
      ],
    },
    disguised_ads: {
      name: 'Disguised Advertisements',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Disguised Ads',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Presents paid advertisements as organic content or results.',
      patterns: [
        /\bdisguised\s*ads?\b/i,
        /sponsored\s*(?:result|post|content|link|listing|product|ad)/i,
        /(?:^\s*|\s+)ad\s*(?:\s*·|:|\s*-|\s*$)/i,
        /promoted\s*(?:listing|result|product|post|content|by)/i,
        /advertisement/i,
        /from\s*(?:our\s*)?sponsor/i,
        /in\s*partnership\s*with/i,
        /partners\s*content/i,
        /\[ad\]/i,
        /#ad|#sponsored/i,
        /brand\s*content/i,
      ],
    },
    misdirection: {
      name: 'Misdirection',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Misdirection',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Directs users toward unintended options through visual or hierarchical emphasis.',
      patterns: [
        /\bmisdirection\b/i,
        /(?:highly\s*|most\s*|top\s*)?recommended\s*(?:plan|product|offer|choice|option)/i,
        /best.*seller|best.*choice/i,
        /customers?\s*(?:also\s*)?(?:like|buy|chose|prefer)/i,
        /popular\s*(?:choice|item|product)/i,
        /trending\s*(?:deal|offer|product|item|plan)/i,
        /(?:click\s*|tap\s*)?here\s*for\s*(?:savings?|discount|deal)/i,
        /pre[\s-]?selected/i,
        /default.*(?:yes|selected|opted)/i,
        /(?:yes|true|agree|accept).*by\s*default/i,
      ],
    },
    nagging: {
      name: 'Nagging / Persistent Prompts',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Nagging',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Repeatedly prompts or nags users to take an action.',
      patterns: [
        /\bnagging\b/i,
        /(?:newsletter|subscription|notification|offer|deal|popup|modal).*(?:subscribe|sign[\s-]?up|get|receive)/i,
        /(?:don'?t|never).*(?:show|tell|remind) .*again/i,
        /subscribe.*newsletter|newsletter.*subscribe/i,
        /get\s*(?:the latest|updates?|offers?|deals?|notifications?)/i,
        /sign\s*up\s*(?:for|to)/i,
        /stay\s*(?:updated|informed|in\s*touch)/i,
        /join.*(?:our\s*)?(?:community|list|subscribers)/i,
      ],
    },
    obstruction: {
      name: 'Obstruction / Roach Motel',
      severity: 'high',
      law: 'CCPA Dark Patterns Guidelines 2023 — Obstruction',
      penalty: '₹25 lakh – ₹50 lakh',
      description: 'Makes it difficult to cancel subscriptions, delete accounts, or compare alternatives.',
      patterns: [
        /\b(obstruction|roach\s*motel)\b/i,
        /to\s*(?:cancel|delete|unsubscribe|opt[\s-]?out)[,.]?\s*(?:call|contact|visit|go\s*to|email)/i,
        /cancel.*(?:by\s*)?(?:phone|calling|mail|email|customer\s*service)/i,
        /speak.*(?:to|with).*(?:an?\s*)?agent.*(?:to\s*)?cancel/i,
        /delete\s*account.*(?:contact|call|email)/i,
        /(?:cannot|can't|unable|not possible).*(?:cancel|delete|unsubscribe).*online/i,
        /logout.*automatic.*re[\s-]?enable/i,
      ],
    },
    preselected: {
      name: 'Pre-selected Harmful Options',
      severity: 'medium',
      law: 'CCPA Dark Patterns Guidelines 2023 — Pre-selected Options',
      penalty: '₹10 lakh – ₹25 lakh',
      description: 'Automatically selects options that benefit the company over the user.',
      patterns: [
        /\bpre[\s-]?selected\s*(?:harmful\s*)?options?\b/i,
        /\bpre[\s-]?selected\b/i,
      ],
      domCheck: true,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVACY POLICY SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  const POLICY_SIGNALS = {
    thirdPartySharing: [
      /share\s*(your\s*)?(personal\s*)?data\s*with\s*(third[\s-]parties|partners|affiliates)/i,
      /third[\s-]party\s*(sharing|disclosure)/i,
      /sell\s*(your\s*)?data/i,
      /data\s*(may\s*be)?\s*(shared|disclosed|transferred)\s*to/i,
    ],
    noOptOut: [
      /cannot\s*opt[\s-]out/i,
      /no\s*opt[\s-]out/i,
    ],
    extensiveCollection: [
      /collect\s*(the following|information|data)\s*(including|such as)/i,
      /we\s*collect.*location.*device.*browsing/i,
    ],
    hasOptOut: [
      /opt[\s-]out/i,
      /unsubscribe/i,
      /manage\s*(your\s*)?preferences/i,
      /right\s*to\s*(withdraw|erasure|deletion)/i,
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const state = {
    detectedDomains: [], // Store domains to send to background
    trackers: [],        // Will be empty in content.js now, fulfilled by background.js
    policy: { thirdPartySharing: false, noOptOut: false, extensiveCollection: false, hasOptOut: false },
    fingerprinting: false,
    patterns: [],
    overlayElements: [],
    patternTargetElements: [],
  };

  // Avoid re-running on dynamic pages
  let analysisRun = false;
  let warmupRescanScheduled = false;
  let extensionEnabled = true;
  const EXTENSION_ENABLED_KEY = 'consumershield_enabled';
  const scheduledAnalysisTimers = new Set();
  const PATTERN_TARGET_ATTR = 'data-cs-pattern-target-id';
  const PATTERN_FOCUS_CLASS = 'cs-focus-target';
  const PATTERN_FOCUS_OVERLAY_ID = 'cs-focus-overlay';
  const PATTERN_FOCUS_PADDING_PX = 3;
  const PATTERN_FOCUS_DURATION_MS = 5000;
  let activeFocusOverlay = null;
  let activeFocusTarget = null;
  let activeFocusAnimationFrame = 0;
  let activeFocusClearTimer = null;
  let patternTargetSequence = 0;

  function isExtensionContextInvalidatedError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ''));
  }

  function scheduleTrackedTimeout(callback, delayMs) {
    const timerId = setTimeout(() => {
      scheduledAnalysisTimers.delete(timerId);
      callback();
    }, delayMs);
    scheduledAnalysisTimers.add(timerId);
    return timerId;
  }

  function clearScheduledAnalysisTimers() {
    scheduledAnalysisTimers.forEach((timerId) => clearTimeout(timerId));
    scheduledAnalysisTimers.clear();
  }

  async function refreshExtensionEnabledState() {
    if (!chrome?.storage?.local) return extensionEnabled;

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        try {
          chrome.storage.local.get([EXTENSION_ENABLED_KEY], (storageResult) => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(storageResult);
          });
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        extensionEnabled = false;
        return extensionEnabled;
      }
      throw error;
    }

    if (typeof result[EXTENSION_ENABLED_KEY] === 'boolean') {
      extensionEnabled = result[EXTENSION_ENABLED_KEY];
    } else {
      extensionEnabled = true;
    }
    return extensionEnabled;
  }

  function resetAnalysisState() {
    analysisRun = false;
    warmupRescanScheduled = false;
    clearScheduledAnalysisTimers();
    state.detectedDomains = [];
    state.trackers = [];
    state.patterns = [];
    state.policy = { thirdPartySharing: false, noOptOut: false, extensiveCollection: false, hasOptOut: false };
    state.fingerprinting = false;
    patternTargetSequence = 0;
  }

  function clearConsumerShieldArtifacts() {
    state.overlayElements.forEach((el) => {
      if (!el) return;
      el.classList.remove('cs-overlay-privacy', 'cs-overlay-manipulation');
      el.classList.remove(PATTERN_FOCUS_CLASS);
      if (el.dataset?.csTagged) {
        delete el.dataset.csTagged;
      }
      el.querySelectorAll('.cs-tooltip').forEach((tip) => tip.remove());
    });
    state.patternTargetElements.forEach((el) => {
      if (!el) return;
      el.classList.remove(PATTERN_FOCUS_CLASS);
      if (el.hasAttribute(PATTERN_TARGET_ATTR)) {
        el.removeAttribute(PATTERN_TARGET_ATTR);
      }
    });
    state.overlayElements = [];
    state.patternTargetElements = [];
    clearPatternFocusOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TRACKER DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function detectTrackers() {
    const pageHTML = document.documentElement?.innerHTML || '';
    const mainHost = window.location.hostname;
    const thirdPartyDomains = new Set();
    const trackerMap = new Map();

    const upsertTracker = (tracker, source, confidence = 0.72) => {
      const domain = normalizeDomainLike(tracker.domain);
      const name = String(tracker.name || '').trim() || 'Potential Tracking Endpoint';
      if (!domain) return;

      const key = `${domain}|${name}`;
      const existing = trackerMap.get(key);
      const candidate = {
        domain,
        type: tracker.type || 'tracker',
        name,
        source,
        confidence,
      };

      if (!existing || (existing.confidence || 0) < confidence) {
        trackerMap.set(key, candidate);
      }
    };

    // 1) Inspect domains from page resources (script/img/iframe/link/etc.)
    if (window.performance && performance.getEntriesByType) {
      const resources = performance.getEntriesByType('resource');
      for (const res of resources) {
        try {
          const url = new URL(res.name);
          if (url.hostname && url.hostname !== mainHost && !url.hostname.endsWith('.' + mainHost)) {
            thirdPartyDomains.add(url.hostname);
            const known = findKnownTracker(url.hostname);
            if (known) {
              upsertTracker(known, 'resource', 0.93);
            } else if (TRACKING_HOST_HINTS.test(url.hostname)) {
              upsertTracker({ domain: url.hostname, type: 'tracker', name: 'Potential Tracker' }, 'resource-hint', 0.69);
            }
          }
        } catch(e) {}
      }
    }

    document.querySelectorAll('script[src], iframe[src], link[href]').forEach(el => {
      try {
        const urlStr = el.src || el.href;
        if (urlStr) {
          const url = new URL(urlStr, window.location.href);
          if (url.hostname && url.hostname !== mainHost && !url.hostname.endsWith('.' + mainHost)) {
            thirdPartyDomains.add(url.hostname);
            const known = findKnownTracker(url.hostname);
            if (known) {
              upsertTracker(known, 'dom-resource', 0.93);
            }
          }
        }
      } catch(e) {}
    });

    // 2) Signature fallback from HTML/script text
    KNOWN_TRACKERS.forEach((tracker) => {
      if (pageHTML.includes(tracker.domain)) {
        upsertTracker(tracker, 'html-signature', 0.84);
      }
    });

    TRACKER_SCRIPT_SIGNATURES.forEach((signature) => {
      if (!signature.regex.test(pageHTML)) return;
      upsertTracker(
        {
          domain: signature.domain,
          type: signature.type,
          name: signature.name,
        },
        'script-signature',
        signature.confidence || 0.8,
      );
    });

    state.detectedDomains = Array.from(thirdPartyDomains);
    state.trackers = Array.from(trackerMap.values())
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .map((item) => ({
        domain: item.domain,
        type: item.type,
        name: item.name,
      }));

    // Require multiple fingerprinting signals to reduce false positives.
    let fingerprintSignalHits = 0;
    [
      /getImageData\s*\(/i,
      /toDataURL\s*\(/i,
      /AudioContext|OfflineAudioContext/i,
      /WEBGL_debug_renderer_info|WebGLRenderingContext/i,
      /navigator\.plugins|navigator\.mimeTypes/i,
      /fingerprintjs|fingerprint\s*id/i,
    ].forEach((regex) => {
      if (regex.test(pageHTML)) fingerprintSignalHits += 1;
    });
    state.fingerprinting = fingerprintSignalHits >= 2;
    console.log('[ConsumerShield] Trackers found:', state.trackers);
  }

  async function enrichTrackersFromBackground() {
    if (!chrome?.runtime?.sendMessage) return;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getNetworkTrackers' }, (result) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(result || null);
        });
      });

      const domains = Array.isArray(response?.trackers) ? response.trackers : [];
      if (!domains.length) return;

      const mergedDomains = new Set([...state.detectedDomains, ...domains.map((d) => normalizeDomainLike(d))]);
      state.detectedDomains = Array.from(mergedDomains).filter(Boolean);

      const existing = new Set(state.trackers.map((item) => `${item.domain}|${item.name}`));
      domains.forEach((domain) => {
        const normalized = normalizeDomainLike(domain);
        if (!normalized) return;
        const known = findKnownTracker(normalized);
        const tracker = known || { domain: normalized, type: 'tracker', name: 'Potential Tracker' };
        const key = `${tracker.domain}|${tracker.name}`;
        if (existing.has(key)) return;
        existing.add(key);
        state.trackers.push({
          domain: tracker.domain,
          type: tracker.type || 'tracker',
          name: tracker.name || tracker.domain,
        });
      });
    } catch {
      // Ignore transient worker messaging errors.
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. PRIVACY POLICY ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  function analyzePrivacyPolicy() {
    // Look for privacy policy links on page
    const policyLinks = Array.from(document.querySelectorAll('a'))
      .filter(a => /privacy\s*policy|privacy\s*statement|data\s*protection/i.test(a.textContent));

    // Scan visible page text for policy signals (works if policy is on same page)
    const pageText = document.body?.innerText || '';

    Object.entries(POLICY_SIGNALS).forEach(([signal, regexList]) => {
      regexList.forEach(re => {
        if (re.test(pageText)) {
          state.policy[signal] = true;
        }
      });
    });

    // If has opt-out, noOptOut becomes false (opt-out available overrides detection)
    if (state.policy.hasOptOut) {
      state.policy.noOptOut = false;
    }

    // If no policy link found at all → flag as missing opt-out
    if (policyLinks.length === 0 && !state.policy.hasOptOut) {
      state.policy.noOptOut = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DARK PATTERN DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  async function detectDarkPatterns() {
    const bodyText = document.body?.innerText || '';
    const normalizedBodyText = normalizeScanText(bodyText).slice(0, 140000);
    const candidates = collectDarkPatternCandidates(bodyText);

    const upsertPattern = (type, config, sampleText, element, confidence, descriptionOverride = null) => {
      const normalizedText = normalizeScanText(sampleText || '').slice(0, 160);
      const existing = state.patterns.find((p) => (
        p.type === type && normalizeScanText(p.text || '').slice(0, 160) === normalizedText
      ));
      if (!existing) {
        state.patterns.push({
          type,
          name: config.name,
          severity: config.severity,
          confidence,
          law: config.law,
          penalty: config.penalty,
          description: descriptionOverride || config.description,
          element,
          text: sampleText,
          occurrence_count: 1,
        });
      } else if ((existing.confidence || 0) < confidence) {
        existing.confidence = confidence;
        existing.text = sampleText;
        existing.description = descriptionOverride || existing.description;
        existing.element = element || existing.element;
        existing.occurrence_count = Number(existing.occurrence_count || 1) + 1;
      } else {
        existing.occurrence_count = Number(existing.occurrence_count || 1) + 1;
      }

      if (element) {
        applyOverlay(element, 'manipulation', config.name);
      }
    };

    Object.entries(DARK_PATTERNS).forEach(([type, config]) => {
      // Text pattern matching
      config.patterns.forEach((regex) => {
        const matchedCandidate = candidates.find((candidate) => regex.test(candidate.text));
        if (matchedCandidate) {
          const sampleText = getPatternSample(matchedCandidate.text, regex) || matchedCandidate.text.slice(0, 100).trim();
          const confidence = Math.min(0.97, (matchedCandidate.contextScore || 0.7) + (matchedCandidate.element ? 0.08 : 0));
          upsertPattern(type, config, sampleText, matchedCandidate.element, confidence);
          return;
        }

        // Old branch behavior fallback: broad body-text scan catches patterns missed by focused candidates.
        if (!normalizedBodyText) return;
        const bodyMatch = normalizedBodyText.match(regex);
        if (!bodyMatch) return;

        const anchorElement = findElementContaining(regex) || document.body;
        const sampleText = (bodyMatch[0] || getPatternSample(normalizedBodyText, regex) || normalizedBodyText.slice(0, 120)).slice(0, 120);
        const fallbackConfidence = Math.min(
          0.84,
          (config.severity === 'high' ? 0.72 : 0.66) + (anchorElement && anchorElement !== document.body ? 0.05 : 0),
        );

        upsertPattern(type, config, sampleText, anchorElement, fallbackConfidence);
      });
    });

    // Pre-selected checkboxes / radio buttons
    detectPreselectedOptions();
    
    // DOM-based detections for visual patterns
    detectCountdownTimers();
    detectStickyBanners();
    detectModalsAndPopups();
    detectDifficultCancellation();
    detectEcommercePricingManipulation();
    detectTrickWordingAdvanced();
    detectVisualInterference();

    await enrichTaxonomyPatternMentions(bodyText, upsertPattern);
  }

  async function enrichTaxonomyPatternMentions(bodyText, upsertPattern) {
    const currentText = normalizeScanText(bodyText || '');
    if (!currentText) return;

    // Educational catalog pages (e.g., deceptive pattern directories) are expected to mention many pattern families.
    const hasTaxonomyCue = /\b(deceptive\s*patterns?|dark\s*patterns?)\b/i.test(currentText)
      && /\b(types?|taxonomy|hall\s*of\s*shame|view\s*types)\b/i.test(currentText);
    if (!hasTaxonomyCue) return;

    const typesAnchor = document.querySelector('a[href*="/types"], a[href*="types"]');
    let catalogText = currentText;

    if (typesAnchor) {
      try {
        const typesUrl = new URL(typesAnchor.getAttribute('href') || '', window.location.href).toString();
        const response = await fetch(typesUrl, { credentials: 'same-origin' });
        if (response.ok) {
          const html = await response.text();
          const stripped = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ');
          catalogText = `${catalogText} ${normalizeScanText(stripped)}`.slice(0, 220000);
        }
      } catch {
        // Ignore network failures and continue with on-page text only.
      }
    }

    Object.entries(DARK_PATTERNS).forEach(([type, config]) => {
      if (state.patterns.some((p) => p.type === type)) return;

      const matchedRegex = config.patterns.find((regex) => regex.test(catalogText));
      if (!matchedRegex) return;

      const sampleText = (getPatternSample(catalogText, matchedRegex) || config.name).slice(0, 120);
      const confidence = config.severity === 'high' ? 0.69 : 0.64;

      upsertPattern(
        type,
        config,
        sampleText,
        document.body,
        confidence,
        'Pattern family appears in deceptive-pattern taxonomy/reference content.',
      );
    });
  }

  function detectPreselectedOptions() {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked'));
    const suspicious = checkboxes.filter(el => {
      const label = normalizeScanText(getLabel(el) || getElementActionText(el));
      if (!label) return false;

      const marketingOptIn = /(newsletter|marketing|offers|updates|promotional|notifications?)/i.test(label);
      const paidAddOnOptIn = /(assurance|protection|extended\s*warranty|donation|tip|gift\s*wrap|add[-\s]?on|secure\s*packaging|priority\s*delivery|premium\s*delivery|insurance)/i.test(label);
      return marketingOptIn || paidAddOnOptIn;
    });

    if (suspicious.length > 0) {
      const suspiciousLabels = suspicious.map((el) => normalizeScanText(getLabel(el) || getElementActionText(el))).filter(Boolean);
      const hasPaidAddOn = suspiciousLabels.some((label) => /(?:₹|rs\.?|inr)\s*[\d,]+|extended\s*warranty|secure\s*packaging|protection|tip|donation|gift\s*wrap/i.test(label));
      const existing = state.patterns.find(p => p.type === 'preselected');
      if (!existing) {
        state.patterns.push({
          type: 'preselected',
          name: DARK_PATTERNS.preselected.name,
          severity: hasPaidAddOn ? 'high' : 'medium',
          confidence: hasPaidAddOn ? 0.9 : 0.85,
          law: DARK_PATTERNS.preselected.law,
          penalty: DARK_PATTERNS.preselected.penalty,
          description: hasPaidAddOn
            ? `${suspicious.length} pre-checked option(s) detected, including paid add-ons in checkout flow.`
            : `${suspicious.length} pre-checked option(s) detected for marketing/promotional content.`,
          element: suspicious[0],
          text: suspiciousLabels[0] || 'Pre-selected option detected',
        });
      } else if (hasPaidAddOn && existing.severity !== 'high') {
        existing.severity = 'high';
        existing.confidence = Math.max(existing.confidence || 0, 0.9);
        existing.description = `${suspicious.length} pre-checked option(s) detected, including paid add-ons in checkout flow.`;
      }
      suspicious.forEach(el => {
        const parent = el.closest('label') || el.parentElement;
        if (parent) applyOverlay(parent, 'manipulation', 'Pre-selected Option');
      });
    }
  }

  // DOM-based dark pattern detection functions
  function detectCountdownTimers() {
    const candidates = document.querySelectorAll('span, div, p, strong, b, section');
    const timerElements = [];
    const scanLimit = Math.min(candidates.length, 1200);

    for (let i = 0; i < scanLimit; i += 1) {
      const el = candidates[i];
      const text = normalizeScanText(el.textContent || '');
      if (!text || text.length > 120) continue;

      const isTimer = /\d+\s*(?:hours?|mins?|minutes?|seconds?)\s*(?:left|remaining)/i.test(text);
      if (!isTimer) continue;

      const isVisible = el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none';
      const isReasonableSize = el.offsetWidth > 30 && el.offsetHeight > 12;
      if (isVisible && isReasonableSize) {
        timerElements.push(el);
      }

      if (timerElements.length >= 6) break;
    }

    if (timerElements.length > 0) {
      const existing = state.patterns.find(p => p.type === 'urgency' && p.text === 'Countdown Timer');
      if (!existing) {
        state.patterns.push({
          type: 'urgency',
          name: 'Countdown Timer',
          severity: 'high',
          confidence: 0.9,
          law: DARK_PATTERNS.urgency.law,
          penalty: DARK_PATTERNS.urgency.penalty,
          description: 'Countdown timer detected to create artificial urgency.',
          element: timerElements[0],
          text: 'Countdown Timer',
        });
      }
      timerElements.slice(0, 3).forEach(el => applyOverlay(el, 'manipulation', 'Countdown Timer'));
    }
  }

  function detectStickyBanners() {
    const stickyBanners = Array.from(document.querySelectorAll('[style*="position"][style*="sticky"], [style*="position"][style*="fixed"]')).filter(el => {
      const text = (el.textContent || '').toLowerCase();
      const hasUrgency = text.match(/urgent|hurry|now|limited|only|ends?|sale|offer|deal|buy|subscribe|sign up/i);
      const isVisible = el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none';
      const notTooLarge = el.offsetHeight < 400;
      return isVisible && hasUrgency && notTooLarge;
    });

    if (stickyBanners.length > 0) {
      const existing = state.patterns.find(p => p.type === 'urgency' && p.text === 'Sticky Banner');
      if (!existing) {
        state.patterns.push({
          type: 'urgency',
          name: 'Sticky Urgency Banner',
          severity: 'high',
          confidence: 0.88,
          law: DARK_PATTERNS.urgency.law,
          penalty: DARK_PATTERNS.urgency.penalty,
          description: 'Persistent banner with urgency language designed to distract and pressure.',
          element: stickyBanners[0],
          text: 'Sticky Banner',
        });
      }
      stickyBanners.slice(0, 2).forEach(el => applyOverlay(el, 'manipulation', 'Sticky Urgency Banner'));
    }
  }

  function detectModalsAndPopups() {
    const modals = document.querySelectorAll('[role="dialog"], .modal, .popup, [class*="modal"], [id*="popup"], [class*="overlay"]');
    const visibleModals = Array.from(modals).filter(el => {
      const isVisible = el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden';
      const notTooBig = el.offsetHeight < 800 && el.offsetWidth < 800;
      if (!isVisible || !notTooBig) return false;

      const text = normalizeScanText(el.textContent || '');
      const hasPersuasiveText = /(subscribe|sign\s*up|allow\s*notifications|accept\s*all|limited|offer|deal|save|continue|cookie|consent)/i.test(text);
      const style = window.getComputedStyle(el);
      const looksBlocking = style.position === 'fixed' || style.zIndex === '9999' || style.zIndex === '10000' || /overlay|backdrop/i.test(el.className || '');
      const hasActionControls = !!el.querySelector('button, a, [role="button"], input[type="submit"], input[type="button"]');
      const isFocusedContainer = text.length > 0 && text.length < 1600;
      return isFocusedContainer && hasActionControls && (hasPersuasiveText || looksBlocking);
    });

    if (visibleModals.length > 0) {
      const existing = state.patterns.find(p => p.type === 'nagging');
      if (!existing) {
        state.patterns.push({
          type: 'nagging',
          name: 'Intrusive Modals',
          severity: 'medium',
          confidence: Math.min(0.9, 0.72 + (visibleModals.length * 0.04)),
          law: DARK_PATTERNS.nagging.law,
          penalty: DARK_PATTERNS.nagging.penalty,
          description: `${visibleModals.length} persuasive/blocking modal(s) detected that may pressure user action.`,
          element: visibleModals[0],
          text: `${visibleModals.length} modal/popup detected`,
        });
      }
      visibleModals.forEach(el => applyOverlay(el, 'manipulation', 'Intrusive Modal'));
    }
  }

  function detectDifficultCancellation() {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const hasSubscription = bodyText.match(/subscribe|newsletter|unsubscribe|membership|account/i);
    
    if (hasSubscription) {
      const cancelLinks = document.querySelectorAll('[href*="unsubscribe"], [href*="cancel"], [href*="delete"]');
      const cancelButtons = document.querySelectorAll('button[aria-label*="cancel" i], button[title*="cancel" i], button[aria-label*="unsubscribe" i]');
      
      const allCancelElements = Array.from([...cancelLinks, ...cancelButtons]);
      const isBuried = allCancelElements.length === 0 || allCancelElements.every(el => {
        const rect = el.getBoundingClientRect();
        return rect.height < 15 || rect.width < 30 || window.getComputedStyle(el).display === 'none';
      });

      if (isBuried && hasSubscription) {
        const existing = state.patterns.find(p => p.type === 'obstruction' && p.text === 'Difficult Cancellation');
        if (!existing) {
          state.patterns.push({
            type: 'obstruction',
            name: 'Difficult Cancellation',
            severity: 'high',
            confidence: 0.75,
            law: DARK_PATTERNS.obstruction.law,
            penalty: DARK_PATTERNS.obstruction.penalty,
            description: 'Unsubscribe or cancel button is hidden, buried, or non-functional.',
            element: allCancelElements[0] || document.body,
            text: 'Difficult Cancellation',
          });
        }
      }
    }
  }

  function detectEcommercePricingManipulation() {
    detectDripPricingInCheckout();
    detectMisleadingDiscountMath();
    detectFakeOriginalPrice();
    detectPriceAnchoring();
    detectSubscriptionTrap();
    detectDynamicPricing();
  }

  function detectDripPricingInCheckout() {
    const feeRegex = /\b(convenience|platform|handling|processing|delivery|service|packaging|small\s*order|surge|protection|booking)\b/i;
    const revealRegex = /\b(added\s*at\s*checkout|at\s*checkout|during\s*checkout|extra\s*charges?|additional\s*charges?|taxes\s*extra|exclusive\s*of\s*taxes|calculated\s*at\s*payment|final\s*amount\s*may\s*differ)\b/i;

    let bestFinding = null;
    findPriceRelatedContainers().forEach((item) => {
      const text = item.text;
      const values = extractCurrencyValues(text);
      const feeHits = text.match(new RegExp(feeRegex.source, 'gi')) || [];
      const hasRevealLanguage = revealRegex.test(text);

      if (feeHits.length === 0) return;
      if (!hasRevealLanguage && values.length < 3) return;

      const confidence = Math.min(
        0.95,
        0.73 + Math.min(0.12, feeHits.length * 0.03) + (hasRevealLanguage ? 0.08 : 0) + (values.length >= 4 ? 0.04 : 0),
      );

      const severity = hasRevealLanguage && /(convenience|platform|handling|processing|small\s*order)/i.test(text)
        ? 'high'
        : 'medium';

      if (!bestFinding || confidence > bestFinding.confidence) {
        bestFinding = {
          text,
          element: item.element,
          confidence,
          severity,
          feeCount: feeHits.length,
        };
      }
    });

    if (!bestFinding) return;

    const evidence = bestFinding.text.slice(0, 180);
    const existing = state.patterns.find((p) => p.type === 'sneaking' && /drip\s*pricing\s*-\s*checkout\s*add-ons/i.test(p.name || ''));
    const payload = {
      type: 'sneaking',
      name: 'Drip Pricing - Checkout Add-ons',
      severity: bestFinding.severity,
      confidence: bestFinding.confidence,
      law: DARK_PATTERNS.sneaking.law,
      penalty: DARK_PATTERNS.sneaking.penalty,
      description: `Checkout summary includes ${bestFinding.feeCount} fee component(s) likely revealed late in the purchase flow.`,
      element: bestFinding.element,
      text: evidence,
    };

    if (!existing) {
      state.patterns.push(payload);
    } else if ((existing.confidence || 0) < payload.confidence) {
      Object.assign(existing, payload);
    }

    if (bestFinding.element) {
      applyOverlay(bestFinding.element, 'manipulation', 'Drip Pricing');
    }
  }

  function detectMisleadingDiscountMath() {
    let bestMismatch = null;

    findPriceRelatedContainers().forEach((item) => {
      const text = item.text;
      const discountMatch = text.match(/(\d{1,3})\s*%\s*off/i);
      if (!discountMatch) return;

      const displayedDiscount = Number(discountMatch[1]);
      if (!Number.isFinite(displayedDiscount) || displayedDiscount < 5 || displayedDiscount > 95) return;

      const values = extractCurrencyValues(text).slice(0, 6);
      if (values.length < 2) return;

      const strikeNode = item.element.querySelector('s, del, [class*="strike"], [class*="line-through"], [style*="line-through"]');
      const strikeValues = extractCurrencyValues(normalizeScanText(strikeNode?.textContent || ''));

      const oldPrice = strikeValues[0] || Math.max(...values);
      const newPrice = values.find((value) => value < oldPrice) || Math.min(...values);
      if (!(oldPrice > newPrice && oldPrice > 0)) return;

      const computedDiscount = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
      const delta = Math.abs(computedDiscount - displayedDiscount);
      if (delta < 10) return;

      const confidence = Math.min(0.95, 0.74 + Math.min(0.18, delta / 100));
      if (!bestMismatch || confidence > bestMismatch.confidence) {
        bestMismatch = {
          element: item.element,
          confidence,
          displayedDiscount,
          computedDiscount,
          oldPrice,
          newPrice,
          delta,
        };
      }
    });

    if (!bestMismatch) return;

    const severity = bestMismatch.delta >= 20 ? 'high' : 'medium';
    const evidence = `Shown ${bestMismatch.displayedDiscount}% off, but Rs ${Math.round(bestMismatch.oldPrice)} to Rs ${Math.round(bestMismatch.newPrice)} implies about ${bestMismatch.computedDiscount}% off.`;
    const existing = state.patterns.find((p) => p.type === 'sneaking' && /misleading\s*discount\s*math/i.test(p.name || ''));

    const payload = {
      type: 'sneaking',
      name: 'Misleading Discount Math',
      severity,
      confidence: bestMismatch.confidence,
      law: DARK_PATTERNS.sneaking.law,
      penalty: DARK_PATTERNS.sneaking.penalty,
      description: 'Displayed discount percentage does not align with visible old-vs-current price math.',
      element: bestMismatch.element,
      text: evidence,
    };

    if (!existing) {
      state.patterns.push(payload);
    } else if ((existing.confidence || 0) < payload.confidence) {
      Object.assign(existing, payload);
    }

    applyOverlay(bestMismatch.element, 'manipulation', 'Misleading Discount');
  }

  function detectFakeOriginalPrice() {
    const selectors = [
      's', 'del', 'strike', '.strike-through', '.was-price', '.original-price',
      '[class*="strike"]', '[class*="was-price"]', '[class*="original"]',
      '[style*="line-through"]', '.mp-price__strike'
    ];

    const containers = findPriceRelatedContainers();
    let bestFinding = null;

    containers.forEach((item) => {
      const text = item.text;
      const element = item.element;

      const crossedElements = Array.from(element?.querySelectorAll?.(selectors.join(', ')) || []);
      
      if (crossedElements.length === 0) return;

      const crossedTexts = crossedElements
        .map(el => normalizeScanText(el.textContent || ''))
        .filter(t => t.length > 0);

      if (crossedTexts.length === 0) return;

      const currentPrices = extractCurrencyValues(text);
      const originalPrices = crossedTexts.flatMap(t => extractCurrencyValues(t));

      if (currentPrices.length === 0 || originalPrices.length === 0) return;

      const lowestCurrent = Math.min(...currentPrices);
      const highestOriginal = Math.max(...originalPrices);

      if (lowestCurrent >= highestOriginal) return;

      const displayedDiscount = Math.round(((highestOriginal - lowestCurrent) / highestOriginal) * 100);
      
      if (displayedDiscount < 20 || displayedDiscount > 95) return;

      const confidence = Math.min(0.95, 0.72 + Math.min(0.15, displayedDiscount / 100));
      
      if (!bestFinding || confidence > bestFinding.confidence) {
        bestFinding = {
          element,
          confidence,
          displayedDiscount,
          originalPrice: highestOriginal,
          currentPrice: lowestCurrent,
          crossedText: crossedTexts[0].slice(0, 100)
        };
      }
    });

    if (!bestFinding) return;

    const severity = bestFinding.displayedDiscount >= 50 ? 'high' : 'medium';
    const evidence = `Displayed "was Rs.${Math.round(bestFinding.originalPrice)}" but current price is Rs.${Math.round(bestFinding.currentPrice)} — ${bestFinding.displayedDiscount}% "discount"`;
    const existing = state.patterns.find((p) => p.type === 'sneaking' && /fake.*original.*price/i.test(p.name || ''));

    const payload = {
      type: 'sneaking',
      name: 'Fake Original Price',
      severity,
      confidence: bestFinding.confidence,
      law: DARK_PATTERNS.sneaking.law,
      penalty: DARK_PATTERNS.sneaking.penalty,
      description: 'Displayed original price appears inflated to make discount look larger than it truly is.',
      element: bestFinding.element,
      text: evidence,
    };

    if (!existing) {
      state.patterns.push(payload);
    } else if ((existing.confidence || 0) < payload.confidence) {
      Object.assign(existing, payload);
    }

    if (bestFinding.element) {
      applyOverlay(bestFinding.element, 'manipulation', 'Fake Original Price');
    }
  }

  function detectPriceAnchoring() {
    const pricingTierPatterns = [
      /(\₹|Rs\.?|INR)\s*[\d,]+(\.\d{2})?\s*[\/]?\s*(month|year|yr)/i,
      /basic/i,
      /standard/i,
      /premium/i,
      /pro\s*plan/i,
      /basic\s*plan/i,
      /standard\s*plan/i,
      /premium\s*plan/i,
      /free\s*trial/i,
      /starts\s*(at|from)\s*(\₹|Rs\.?|INR)/i,
    ];

    const containers = Array.from(document.querySelectorAll('section, div, table')).filter(el => {
      const text = normalizeScanText(el.textContent || '');
      return pricingTierPatterns.some(pattern => pattern.test(text));
    });

    let bestFinding = null;

    containers.forEach((container) => {
      const text = normalizeScanText(container.textContent || '');
      const pricingMatches = text.match(/(?:(\₹|Rs\.?|INR)\s*)?([\d,]+(?:\.\d{2})?)/gi);
      
      if (!pricingMatches || pricingMatches.length < 2) return;

      const prices = pricingMatches
        .map(m => extractCurrencyValues(m))
        .flat()
        .filter(p => p > 0);

      if (prices.length < 2) return;

      const sortedPrices = [...prices].sort((a, b) => a - b);
      const lowestPrice = sortedPrices[0];
      const highestPrice = sortedPrices[sortedPrices.length - 1];

      if (highestPrice <= lowestPrice * 1.5) return;

      const hasRecommended = /\b(recommended|most\s*popular|best\s*value|most\s*chosen|suggested|preferred)\b/i.test(text);
      const hasBasic = /\b(basic|starter|free| Lite)\b/i.test(text.toLowerCase());
      const hasPremium = /\b(premium|pro|advanced|ultimate|best)\b/i.test(text.toLowerCase());

      const recommendedOnHighest = hasRecommended && (text.indexOf('premium') > -1 || text.indexOf('pro') > -1 || text.indexOf('advanced') > -1 || text.indexOf('ultimate') > -1);
      const basicOptionHidden = hasPremium && hasBasic === false;

      if (!hasRecommended && !basicOptionHidden) return;

      const confidence = Math.min(0.92, 0.68 + (recommendedOnHighest ? 0.15 : 0) + (basicOptionHidden ? 0.1 : 0));
      const severity = (recommendedOnHighest || bestFinding?.confidence > 0.8) ? 'medium' : 'low';

      if (!bestFinding || confidence > bestFinding.confidence) {
        bestFinding = {
          element: container,
          confidence,
          severity,
          lowestPrice,
          highestPrice,
          anchorType: recommendedOnHighest ? 'recommended_on_expensive' : 'hidden_cheap_option'
        };
      }
    });

    if (!bestFinding) return;

    const evidence = `Price tiers: Rs.${Math.round(bestFinding.lowestPrice)} to Rs.${Math.round(bestFinding.highestPrice)} — ${bestFinding.anchorType.replace(/_/g, ' ')}`;
    const existing = state.patterns.find((p) => p.type === 'misdirection' && /price\s*anchoring/i.test(p.name || ''));

    const payload = {
      type: 'misdirection',
      name: 'Price Anchoring',
      severity: bestFinding.severity,
      confidence: bestFinding.confidence,
      law: DARK_PATTERNS.misdirection.law,
      penalty: DARK_PATTERNS.misdirection.penalty,
      description: 'Pricing tiers designed to direct users toward expensive options through psychological anchoring.',
      element: bestFinding.element,
      text: evidence,
    };

    if (!existing) {
      state.patterns.push(payload);
    } else if ((existing.confidence || 0) < payload.confidence) {
      Object.assign(existing, payload);
    }

    if (bestFinding.element) {
      applyOverlay(bestFinding.element, 'manipulation', 'Price Anchoring');
    }
  }

  function detectSubscriptionTrap() {
    const trapPatterns = [
      /first\s*(month|week|year)?\s*(only)?\s*(\₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?/i,
      /(\₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?\s*\/?\s*(first|initial)\s*(month|year|week)/i,
      /(\₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?\s*then\s*(\₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?/i,
      /after\s*(trial|free)\s*(period)?\s*,?\s*(will\s*)?(charge|bill|renew)\s*at/i,
      /subscription\s*(will\s*)?(auto[\s-]?)?renew\s*at/i,
      /recurring\s*(charge|billing|payment)\s*of/i,
      /charged?\s*(monthly|yearly|annually)\s*(at|after)\s*(rs\.?|₹|inr)?\s*[\d,]+/i,
      /starts?\s*(at|from)?\s*(rs\.?|₹|inr)?\s*[\d,]+(?:\.\d{2})?\s*\/\s*(month|year)/i,
      /(free|trial)\s*membership.*(then|after).*(\₹|Rs\.?|INR)/i,
    ];

    const bodyText = document.body?.innerText || '';
    let bestMatch = null;

    trapPatterns.forEach((pattern) => {
      const match = bodyText.match(pattern);
      if (!match) return;

      const matchIndex = bodyText.indexOf(match[0]);
      const contextStart = Math.max(0, matchIndex - 100);
      const contextEnd = Math.min(bodyText.length, matchIndex + match[0].length + 100);
      const context = bodyText.slice(contextStart, contextEnd);

      const confidence = Math.min(0.9, 0.7 + (match[0].length > 30 ? 0.1 : 0));

      const priceMatches = extractCurrencyValues(match[0]);
      const hasTwoPrices = priceMatches.length >= 2;
      const priceJump = hasTwoPrices && priceMatches[1] > priceMatches[0] * 3;

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          text: match[0],
          context,
          confidence,
          severity: priceJump ? 'high' : 'medium',
          hasPriceEscalation: priceJump
        };
      }
    });

    if (!bestMatch) return;

    const existing = state.patterns.find((p) => p.type === 'forced_continuity' && /subscription\s*trap/i.test(p.name || ''));

    const payload = {
      type: 'forced_continuity',
      name: 'Subscription Trap',
      severity: bestMatch.severity,
      confidence: bestMatch.confidence,
      law: DARK_PATTERNS.forced_continuity.law,
      penalty: DARK_PATTERNS.forced_continuity.penalty,
      description: bestMatch.hasPriceEscalation 
        ? `Low introductory price that escalates significantly after trial period.`
        : `Subscription terms with unclear renewal pricing hidden in fine print.`,
      element: document.body,
      text: bestMatch.text.slice(0, 120),
    };

    if (!existing) {
      state.patterns.push(payload);
    } else if ((existing.confidence || 0) < payload.confidence) {
      Object.assign(existing, payload);
    }
  }

  function detectDynamicPricing() {
    const userAgent = navigator.userAgent || '';
    const isLoggedIn = Boolean(document.cookie.match(/(session|token|auth|login)/i));
    
    if (!isLoggedIn) return;

    const priceSelectors = [
      '.price', '.product-price', '.current-price', '.selling-price',
      '.a-price-whole', '.pdp-price', '.product__price'
    ];

    const priceElements = priceSelectors
      .flatMap(sel => Array.from(document.querySelectorAll(sel)))
      .filter(el => el.offsetHeight > 0 && el.offsetWidth > 0);

    if (priceElements.length === 0) return;

    const priceText = normalizeScanText(priceElements[0].textContent || '');
    const prices = extractCurrencyValues(priceText);

    if (prices.length === 0) return;

    const currentPrice = prices[0];
    const pageUrl = window.location.href;
    const domain = window.location.hostname;

    console.log('[ConsumerShield] Dynamic pricing check:', { domain, currentPrice, isLoggedIn });
  }

  function detectTrickWordingAdvanced() {
    const explicitFormCueRegex = /\b(uncheck|untick|opt[\s-]?out|do\s*not|don't|not\s*receive|not\s*want|without\s*consent)\b/i;
    const candidates = collectDarkPatternCandidates(document.body?.innerText || '')
      .filter((candidate) => (
        candidate.text.length <= 220
        && /\b(consent|cookie|marketing|newsletter|email|updates?|notifications?|subscribe|opt|receive|communication)\b/i.test(candidate.text)
        && explicitFormCueRegex.test(candidate.text)
      ));

    const negationRegex = /\b(no|not|never|without|uncheck|untick|opt[\s-]?out|do\s*not|don't|cannot|can't)\b/gi;
    let bestMatch = null;

    candidates.forEach((candidate) => {
      const negations = candidate.text.match(negationRegex) || [];
      if (negations.length < 2) return;
      const score = Math.min(0.95, 0.72 + (negations.length * 0.07));
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { candidate, score, negationCount: negations.length };
      }
    });

    if (!bestMatch) return;

    const existing = state.patterns.find((p) => p.type === 'trick_questions');
    const description = `Consent text contains ${bestMatch.negationCount} negation cues, indicating possible double-negative wording.`;

    if (!existing) {
      state.patterns.push({
        type: 'trick_questions',
        name: DARK_PATTERNS.trick_questions.name,
        severity: bestMatch.negationCount >= 3 ? 'high' : 'medium',
        confidence: bestMatch.score,
        law: DARK_PATTERNS.trick_questions.law,
        penalty: DARK_PATTERNS.trick_questions.penalty,
        description,
        element: bestMatch.candidate.element,
        text: bestMatch.candidate.text.slice(0, 120),
      });
    } else if ((existing.confidence || 0) < bestMatch.score) {
      existing.confidence = bestMatch.score;
      existing.description = description;
      existing.text = bestMatch.candidate.text.slice(0, 120);
      existing.element = bestMatch.candidate.element || existing.element;
    }

    if (bestMatch.candidate.element) {
      applyOverlay(bestMatch.candidate.element, 'manipulation', DARK_PATTERNS.trick_questions.name);
    }
  }

  function detectVisualInterference() {
    const containers = findConsentContainers();
    let bestFinding = null;

    containers.forEach((container) => {
      const actions = Array.from(container.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
        .filter((el) => isElementVisibleForDetection(el));
      if (actions.length < 2) return;

      const acceptEl = actions.find((el) => /\b(accept|allow|agree|yes|continue|ok|got\s*it)\b/i.test(getElementActionText(el)));
      const rejectEl = actions.find((el) => /\b(reject|decline|deny|manage|settings|customi[sz]e|no\s*thanks|necessary|essential|only)\b/i.test(getElementActionText(el)));
      if (!acceptEl || !rejectEl || acceptEl === rejectEl) return;

      const acceptWeight = buttonVisualWeight(acceptEl);
      const rejectWeight = Math.max(1, buttonVisualWeight(rejectEl));
      const ratio = acceptWeight / rejectWeight;
      const rejectWeak = isWeaklyVisibleAction(rejectEl);
      const isManipulative = ratio >= 1.6 || rejectWeak;
      if (!isManipulative) return;

      if (!bestFinding || ratio > bestFinding.ratio) {
        bestFinding = { acceptEl, rejectEl, ratio, rejectWeak };
      }
    });

    if (!bestFinding) return;

    const confidence = Math.min(0.96, 0.7 + Math.min(0.2, (bestFinding.ratio - 1.0) * 0.09) + (bestFinding.rejectWeak ? 0.08 : 0));
    const evidence = `Accept-vs-reject visual weight ratio: ${bestFinding.ratio.toFixed(2)}x${bestFinding.rejectWeak ? '; reject appears weak/hidden.' : '.'}`;
    const existing = state.patterns.find((p) => p.type === 'misdirection' && /visual interference/i.test(p.name || ''));

    if (!existing) {
      state.patterns.push({
        type: 'misdirection',
        name: 'Visual Interference',
        severity: (bestFinding.ratio >= 2.0 || bestFinding.rejectWeak) ? 'high' : 'medium',
        confidence,
        law: DARK_PATTERNS.misdirection.law,
        penalty: DARK_PATTERNS.misdirection.penalty,
        description: 'Acceptance path is visually emphasized over rejection in a consent-style UI.',
        element: bestFinding.acceptEl,
        text: evidence,
      });
    } else if ((existing.confidence || 0) < confidence) {
      existing.confidence = confidence;
      existing.text = evidence;
      existing.element = bestFinding.acceptEl;
    }

    applyOverlay(bestFinding.acceptEl, 'manipulation', 'Visual Interference');
    applyOverlay(bestFinding.rejectEl, 'manipulation', 'Visual Interference');
  }

  function getLabel(input) {
    const id = input.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.innerText || label.textContent;
    }
    const parent = input.closest('label');
    if (parent) return parent.innerText || parent.textContent;
    const next = input.nextElementSibling;
    if (next) return next.innerText || next.textContent;
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VISUAL OVERLAYS
  // ═══════════════════════════════════════════════════════════════════════════

  function injectOverlayStyles() {
    if (document.getElementById('cs-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'cs-overlay-styles';
    style.textContent = `
      .cs-overlay-privacy {
        outline: 2.5px solid #3b82f6 !important;
        outline-offset: 2px !important;
        position: relative !important;
      }
      .cs-overlay-manipulation {
        outline: 2.5px solid #ef4444 !important;
        outline-offset: 2px !important;
        animation: cs-pulse 2s infinite !important;
        position: relative !important;
      }
      @keyframes cs-pulse {
        0%   { outline-color: #ef4444; box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
        50%  { outline-color: #f97316; box-shadow: 0 0 0 5px rgba(239,68,68,0); }
        100% { outline-color: #ef4444; box-shadow: 0 0 0 0 rgba(239,68,68,0); }
      }
      .cs-tooltip {
        position: absolute !important;
        top: -38px !important;
        left: 0 !important;
        background: rgba(17,17,17,0.95) !important;
        color: #fff !important;
        font-size: 11px !important;
        font-family: 'Inter', -apple-system, sans-serif !important;
        padding: 5px 9px !important;
        border-radius: 5px !important;
        white-space: nowrap !important;
        z-index: 9999998 !important;
        pointer-events: none !important;
        display: none !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
        line-height: 1.4 !important;
      }
      .cs-overlay-manipulation:hover .cs-tooltip,
      .cs-overlay-privacy:hover .cs-tooltip {
        display: block !important;
      }
      .cs-focus-target {
        outline: 3px solid #ef4444 !important;
        outline-offset: 4px !important;
        box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.18), 0 0 24px rgba(239, 68, 68, 0.45) !important;
        animation: cs-focus-beacon 1.6s ease-in-out 2 !important;
        scroll-margin-top: 96px !important;
      }
      .cs-focus-overlay {
        position: absolute !important;
        border: 3px solid #ef4444 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.18), 0 0 28px rgba(239, 68, 68, 0.5) !important;
        z-index: 9999999 !important;
        pointer-events: none !important;
        animation: cs-focus-box-pulse 1.2s ease-in-out 2 !important;
      }
      .cs-focus-overlay-label {
        position: absolute !important;
        left: -1px !important;
        top: -28px !important;
        background: rgba(17, 17, 17, 0.96) !important;
        color: #f8fafc !important;
        border: 1px solid rgba(239, 68, 68, 0.85) !important;
        border-radius: 8px !important;
        font-size: 11px !important;
        line-height: 1.1 !important;
        padding: 5px 8px !important;
        white-space: nowrap !important;
        max-width: min(70vw, 420px) !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      @keyframes cs-focus-beacon {
        0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.42); }
        60% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
        100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
      }
      @keyframes cs-focus-box-pulse {
        0% { transform: scale(0.995); opacity: 0.88; }
        50% { transform: scale(1.004); opacity: 1; }
        100% { transform: scale(1); opacity: 0.96; }
      }
    `;
    document.head.appendChild(style);
  }

  function applyOverlay(el, type, label) {
    // Keep privacy highlights, but skip manipulation overlays to avoid red boxes.
    if (type === 'manipulation') return;

    const target = resolveOverlayTarget(el);
    if (!target || target.dataset?.csTagged) return;
    target.dataset.csTagged = '1';
    target.classList.add(type === 'privacy' ? 'cs-overlay-privacy' : 'cs-overlay-manipulation');

    const tooltip = document.createElement('div');
    tooltip.className = 'cs-tooltip';
    const icon = type === 'privacy' ? '🔒' : '⚠️';
    tooltip.textContent = `${icon} ConsumerShield: ${label}`;

    // Make element relative if static
    const pos = window.getComputedStyle(target).position;
    if (pos === 'static') target.style.position = 'relative';
    target.appendChild(tooltip);

    state.overlayElements.push(target);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizeDomainLike(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const noProtocol = raw.replace(/^https?:\/\//, '');
    const noPath = noProtocol.split('/')[0].split(':')[0].replace(/^www\./, '');
    return noPath;
  }

  function resolveOverlayTarget(el) {
    if (!el) return null;

    const nonRenderableTags = new Set(['area', 'base', 'br', 'col', 'head', 'html', 'link', 'meta', 'param', 'script', 'source', 'style', 'title', 'track', 'wbr']);
    const tag = String(el.tagName || '').toLowerCase();

    if (nonRenderableTags.has(tag)) {
      return el.closest('label, div, section, article, form') || el.parentElement || null;
    }

    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect && rect.width >= 2 && rect.height >= 2) {
      return el;
    }

    // Fallback only for tiny/hidden wrappers where the clicked node is not paintable.
    const parentCandidate = el.closest('button, a, label, input, img, div, section, article, form, li, p, span');
    if (parentCandidate) return parentCandidate;

    return el;
  }

  function isGenericFocusContainer(el) {
    if (!el) return true;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'body' || tag === 'html';
  }

  function isUsableFocusTarget(el) {
    if (!el || !el.isConnected) return false;
    if (isGenericFocusContainer(el)) return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function escapeCssToken(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(token);
    }
    return token.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function buildStableElementSelector(target) {
    if (!target || isGenericFocusContainer(target)) return '';

    const segments = [];
    let current = target;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 6) {
      const tag = String(current.tagName || '').toLowerCase();
      if (!tag || tag === 'html') break;

      let segment = tag;
      const domId = String(current.id || '').trim();
      if (domId) {
        segment += `#${escapeCssToken(domId)}`;
        segments.unshift(segment);
        break;
      }

      const classTokens = Array.from(current.classList || [])
        .map((name) => String(name || '').trim())
        .filter((name) => name.length >= 2 && name.length <= 40)
        .slice(0, 2);
      if (classTokens.length > 0) {
        segment += `.${classTokens.map(escapeCssToken).join('.')}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children)
          .filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) {
          segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
        }
      }

      segments.unshift(segment);
      current = current.parentElement;
      depth += 1;
      if (current && String(current.tagName || '').toLowerCase() === 'body') {
        segments.unshift('body');
        break;
      }
    }

    return segments.join(' > ').slice(0, 320);
  }

  function selectElementBySelector(selector) {
    const candidateSelector = String(selector || '').trim();
    if (!candidateSelector) return null;
    try {
      const match = document.querySelector(candidateSelector);
      if (!isUsableFocusTarget(match)) return null;
      return match;
    } catch {
      return null;
    }
  }

  function getPatternCandidateText(el) {
    return normalizeScanText(
      el?.innerText
      || el?.textContent
      || el?.getAttribute?.('aria-label')
      || el?.getAttribute?.('alt')
      || el?.getAttribute?.('title')
      || el?.getAttribute?.('value')
      || '',
    );
  }

  function buildXPathStringLiteral(value) {
    const input = String(value || '');
    if (!input.includes("'")) {
      return `'${input}'`;
    }
    if (!input.includes('"')) {
      return `"${input}"`;
    }

    const parts = input.split("'");
    const tokens = [];
    parts.forEach((part, index) => {
      tokens.push(`'${part}'`);
      if (index < parts.length - 1) {
        tokens.push(`"'"`);
      }
    });

    return `concat(${tokens.join(', ')})`;
  }

  function getElementDepth(el) {
    let depth = 0;
    let current = el;
    while (current && depth < 160) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function scoreFocusTextMatch(candidateText, searchText, tokens) {
    const haystack = normalizeScanText(candidateText || '').toLowerCase();
    if (!haystack) return 0;

    const needle = String(searchText || '').trim().toLowerCase();
    if (!needle) return 0;

    if (haystack === needle) return 1;

    let score = 0;
    if (haystack.includes(needle)) {
      score = 0.94;
    } else if (needle.includes(haystack) && haystack.length >= Math.min(42, needle.length)) {
      score = 0.76;
    }

    if (tokens.length > 0) {
      let matched = 0;
      tokens.forEach((token) => {
        if (haystack.includes(token)) matched += 1;
      });
      const coverage = matched / tokens.length;
      score = Math.max(score, coverage * 0.84);
    }

    if (haystack.length > 360) {
      score -= 0.06;
    }

    return Math.max(0, Math.min(1, score));
  }

  function findReactElementByText(searchText) {
    const normalizedSearch = normalizeScanText(searchText || '').toLowerCase().slice(0, 200);
    if (!normalizedSearch || normalizedSearch.length < 3) return null;

    const tokens = normalizedSearch
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter((token) => token.length >= 3)
      .slice(0, 12);

    let bestTarget = null;
    let bestScore = 0;

    const considerNode = (textNode) => {
      const parent = textNode?.parentElement;
      if (!parent) return;

      const target = resolveOverlayTarget(parent);
      if (!isUsableFocusTarget(target)) return;

      const candidateText = getPatternCandidateText(target);
      if (!candidateText) return;

      const matchScore = scoreFocusTextMatch(candidateText, normalizedSearch, tokens);
      if (matchScore <= 0) return;

      const rect = target.getBoundingClientRect();
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const targetArea = Math.max(1, rect.width * rect.height);
      const areaPenalty = targetArea > viewportArea * 0.55 ? 0.08 : 0;
      const depthBonus = Math.min(0.08, getElementDepth(target) / 400);
      const finalScore = matchScore + depthBonus - areaPenalty;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestTarget = target;
      }
    };

    const scanXPathTextNodes = (expression, limit) => {
      let snapshot;
      try {
        snapshot = document.evaluate(expression, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      } catch {
        return;
      }

      const total = Math.min(snapshot.snapshotLength, limit);
      for (let index = 0; index < total; index += 1) {
        const node = snapshot.snapshotItem(index);
        considerNode(node);
        if (bestScore >= 0.98) break;
      }
    };

    const lowerExpr = 'translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")';
    const exactExpr = `//text()[contains(${lowerExpr}, ${buildXPathStringLiteral(normalizedSearch)})]`;
    scanXPathTextNodes(exactExpr, 2400);

    if (bestTarget && bestScore >= 0.76) {
      return bestTarget;
    }

    const tokenClauses = tokens.slice(0, 4)
      .map((token) => `contains(${lowerExpr}, ${buildXPathStringLiteral(token)})`);
    if (tokenClauses.length > 0) {
      const fuzzyExpr = `//text()[${tokenClauses.join(' or ')}]`;
      scanXPathTextNodes(fuzzyExpr, 3600);
      if (bestTarget && bestScore >= 0.6) {
        return bestTarget;
      }
    }

    // TreeWalker fallback helps when text is split/virtualized across dynamic React fragments.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let scanned = 0;
    let node;
    while ((node = walker.nextNode()) && scanned < 4200) {
      scanned += 1;
      considerNode(node);
      if (bestScore >= 0.98) break;
    }

    if (bestTarget && bestScore >= 0.52) {
      return bestTarget;
    }

    return null;
  }

  async function findReactElementByTextWithRetry(searchText, maxAttempts = 5, delayMs = 300) {
    const normalizedSearch = normalizeScanText(searchText || '');
    if (!normalizedSearch) return null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const el = findReactElementByText(normalizedSearch);
      if (el && isUsableFocusTarget(el)) {
        return el;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return null;
  }

  function findWithMutationObserver(searchText, callback, timeoutMs = 3000) {
    const normalizedSearch = normalizeScanText(searchText || '');
    if (!normalizedSearch || typeof callback !== 'function' || !document.body) {
      return () => {};
    }

    let finished = false;
    const observer = new MutationObserver(() => {
      const el = findReactElementByText(normalizedSearch);
      if (!el || !isUsableFocusTarget(el)) return;

      finished = true;
      observer.disconnect();
      callback(el);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const timeoutId = setTimeout(() => {
      if (finished) return;
      observer.disconnect();
    }, timeoutMs);

    return () => {
      finished = true;
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }

  function waitForReactElementByMutation(searchText, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const initial = findReactElementByText(searchText);
      if (initial && isUsableFocusTarget(initial)) {
        resolve(initial);
        return;
      }

      let settled = false;
      const stop = findWithMutationObserver(searchText, (el) => {
        if (settled) return;
        settled = true;
        stop();
        resolve(el);
      }, timeoutMs);

      setTimeout(() => {
        if (settled) return;
        settled = true;
        stop();
        resolve(null);
      }, timeoutMs + 20);
    });
  }

  function flashFullPageFocusFallback() {
    const target = document.body || document.documentElement;
    if (!target) return;

    const previousOutline = target.style.outline;
    const previousOffset = target.style.outlineOffset;
    target.style.outline = '4px solid red';
    target.style.outlineOffset = '-4px';

    scheduleTrackedTimeout(() => {
      target.style.outline = previousOutline;
      target.style.outlineOffset = previousOffset;
    }, 2000);
  }

  function buildPatternTargetMeta(element) {
    const target = resolveOverlayTarget(element);
    if (!target) return null;

    const isGeneric = isGenericFocusContainer(target);

    let targetId = '';
    if (!isGeneric) {
      targetId = target.getAttribute(PATTERN_TARGET_ATTR) || '';
      if (!targetId) {
        patternTargetSequence += 1;
        targetId = `cs-pattern-${Date.now().toString(36)}-${patternTargetSequence}`;
        target.setAttribute(PATTERN_TARGET_ATTR, targetId);
      }

      if (!state.patternTargetElements.includes(target)) {
        state.patternTargetElements.push(target);
      }
    }

    const textPreview = normalizeScanText(target.innerText || target.textContent || '').slice(0, 120);
    return {
      id: targetId,
      tag: String(target.tagName || '').toLowerCase(),
      textPreview,
      selector: isGeneric ? '' : buildStableElementSelector(target),
      domId: isGeneric ? '' : String(target.id || '').trim().slice(0, 100),
      generic: isGeneric,
    };
  }

  function getPatternTargetSelector(targetId) {
    const safeId = String(targetId || '').trim();
    if (!safeId) return '';
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return `[${PATTERN_TARGET_ATTR}="${CSS.escape(safeId)}"]`;
    }
    return `[${PATTERN_TARGET_ATTR}="${safeId.replace(/(["\\])/g, '\\$1')}"]`;
  }

  function findElementContainingSnippet(snippet, options = {}) {
    const normalizedSnippet = normalizeScanText(snippet || '').slice(0, 120);
    if (!normalizedSnippet) return null;

    const preferredTag = String(options.tag || '').trim().toLowerCase();
    const baseSelector = 'button, a, label, input, img, div, span, p, li, section, article';
    const selector = /^[a-z][a-z0-9-]*$/.test(preferredTag)
      ? `${preferredTag}, ${baseSelector}`
      : baseSelector;

    const candidates = document.querySelectorAll(selector);
    const scanLimit = Math.min(candidates.length, 2600);
    const tokens = normalizedSnippet
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter((token) => token.length >= 3)
      .slice(0, 12);

    let bestCandidate = null;
    let bestScore = 0;

    for (let index = 0; index < scanLimit; index += 1) {
      const candidate = candidates[index];
      if (!isUsableFocusTarget(candidate)) continue;

      const haystack = getPatternCandidateText(candidate);
      if (!haystack) continue;

      const normalizedHaystack = haystack.toLowerCase();
      const directHit = normalizedHaystack.includes(normalizedSnippet.toLowerCase());
      if (directHit) {
        return candidate;
      }

      if (tokens.length === 0) continue;
      let matchedTokenCount = 0;
      tokens.forEach((token) => {
        if (normalizedHaystack.includes(token)) matchedTokenCount += 1;
      });

      const tokenScore = matchedTokenCount / tokens.length;
      if (tokenScore > bestScore) {
        bestScore = tokenScore;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.58) {
      return bestCandidate;
    }

    return null;
  }

  function findPatternFocusElement(patternRequest) {
    const request = patternRequest || {};
    const requestText = normalizeScanText(
      request.patternText
      || request.snippet
      || request.text
      || request.target?.textPreview
      || '',
    );

    const reactTextMatch = findReactElementByText(requestText);
    if (reactTextMatch) return reactTextMatch;

    const targetId = String(request.target?.id || request.targetId || '').trim();
    if (targetId) {
      const directMatch = document.querySelector(getPatternTargetSelector(targetId));
      if (isUsableFocusTarget(directMatch)) return directMatch;
    }

    const selectorMatch = selectElementBySelector(request.target?.selector);
    if (selectorMatch) return selectorMatch;

    const domId = String(request.target?.domId || '').trim();
    if (domId) {
      const domIdMatch = document.getElementById(domId);
      if (isUsableFocusTarget(domIdMatch)) {
        return domIdMatch;
      }
    }

    const normalizedType = String(request.type || '').trim().toLowerCase();
    const normalizedName = String(request.name || '').trim().toLowerCase();
    const normalizedText = requestText.slice(0, 120);
    const preferredTag = String(request.target?.tag || '').trim().toLowerCase();

    const livePattern = state.patterns.find((pattern) => {
      if (!pattern) return false;
      const typeMatches = normalizedType && String(pattern.type || '').trim().toLowerCase() === normalizedType;
      const nameMatches = normalizedName && String(pattern.name || '').trim().toLowerCase() === normalizedName;
      const textMatches = normalizedText && normalizeScanText(pattern.text || '').includes(normalizedText);
      return typeMatches || nameMatches || textMatches;
    });

    if (livePattern?.element) {
      const resolvedLiveTarget = resolveOverlayTarget(livePattern.element);
      if (isUsableFocusTarget(resolvedLiveTarget)) {
        return resolvedLiveTarget;
      }
    }

    if (normalizedText) {
      const reactSnippetTarget = findReactElementByText(normalizedText);
      if (reactSnippetTarget) return reactSnippetTarget;

      const snippetTarget = findElementContainingSnippet(normalizedText, { tag: preferredTag });
      if (snippetTarget) return snippetTarget;
    }

    const liveText = normalizeScanText(livePattern?.text || '').slice(0, 120);
    if (liveText) {
      const liveTextTarget = findElementContainingSnippet(liveText, { tag: preferredTag });
      if (liveTextTarget) return liveTextTarget;
    }

    return null;
  }

  function clearPatternFocusOverlay() {
    if (activeFocusAnimationFrame) {
      cancelAnimationFrame(activeFocusAnimationFrame);
      activeFocusAnimationFrame = 0;
    }

    if (activeFocusClearTimer) {
      clearTimeout(activeFocusClearTimer);
      scheduledAnalysisTimers.delete(activeFocusClearTimer);
      activeFocusClearTimer = null;
    }

    activeFocusTarget = null;

    if (activeFocusOverlay?.parentElement) {
      activeFocusOverlay.remove();
    }
    activeFocusOverlay = null;

    const staleOverlay = document.getElementById(PATTERN_FOCUS_OVERLAY_ID);
    if (staleOverlay) {
      staleOverlay.remove();
    }
  }

  function updatePatternFocusOverlayPosition(overlay, target) {
    if (!overlay || !target || !target.isConnected) return false;

    const rect = target.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1) {
      return false;
    }

    const pad = PATTERN_FOCUS_PADDING_PX;
  const top = window.scrollY + rect.top - pad;
  const left = window.scrollX + rect.left - pad;
    const width = Math.max(2, rect.width + (pad * 2));
    const height = Math.max(2, rect.height + (pad * 2));

    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    return true;
  }

  function drawPatternFocusOverlay(element, label) {
    const target = resolveOverlayTarget(element);
    if (!target) return false;

    clearPatternFocusOverlay();

    const overlay = document.createElement('div');
    overlay.id = PATTERN_FOCUS_OVERLAY_ID;
    overlay.className = 'cs-focus-overlay';
    overlay.style.willChange = 'top,left,width,height';

    const labelText = String(label || '').trim();
    if (labelText) {
      const tag = document.createElement('div');
      tag.className = 'cs-focus-overlay-label';
      tag.textContent = `ConsumerShield: ${labelText}`;
      overlay.appendChild(tag);
    }

    if (!document.body) return false;
    document.body.appendChild(overlay);
    activeFocusOverlay = overlay;
    activeFocusTarget = target;

    if (!updatePatternFocusOverlayPosition(overlay, target)) {
      clearPatternFocusOverlay();
      return false;
    }

    const trackPosition = () => {
      if (!activeFocusOverlay || !activeFocusTarget) {
        activeFocusAnimationFrame = 0;
        return;
      }

      const ok = updatePatternFocusOverlayPosition(activeFocusOverlay, activeFocusTarget);
      if (!ok) {
        clearPatternFocusOverlay();
        return;
      }

      activeFocusAnimationFrame = requestAnimationFrame(trackPosition);
    };

    activeFocusAnimationFrame = requestAnimationFrame(trackPosition);

    activeFocusClearTimer = scheduleTrackedTimeout(() => {
      activeFocusClearTimer = null;
      clearPatternFocusOverlay();
    }, PATTERN_FOCUS_DURATION_MS);

    return true;
  }

  function focusPatternElement(element, label) {
    const target = resolveOverlayTarget(element);
    if (!target) return false;

    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch {
      target.scrollIntoView();
    }

    if (typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch {
        // Ignore focus failures on non-focusable elements.
      }
    }

    target.classList.remove(PATTERN_FOCUS_CLASS);
    void target.offsetWidth;
    target.classList.add(PATTERN_FOCUS_CLASS);

    drawPatternFocusOverlay(target, label);

    scheduleTrackedTimeout(() => {
      target.classList.remove(PATTERN_FOCUS_CLASS);
    }, PATTERN_FOCUS_DURATION_MS - 200);

    return true;
  }

  function extractHostnameFromUrl(raw) {
    const input = String(raw || '').trim();
    if (!input || input.startsWith('data:') || input.startsWith('javascript:') || input.startsWith('#')) return '';
    try {
      return normalizeDomainLike(new URL(input, window.location.href).hostname);
    } catch {
      return '';
    }
  }

  function isFirstPartyDomain(candidateDomain, firstPartyDomain) {
    if (!candidateDomain || !firstPartyDomain) return false;
    return (
      candidateDomain === firstPartyDomain
      || candidateDomain.endsWith(`.${firstPartyDomain}`)
      || firstPartyDomain.endsWith(`.${candidateDomain}`)
    );
  }

  function findKnownTracker(candidateDomain) {
    const normalizedCandidate = normalizeDomainLike(candidateDomain);
    if (!normalizedCandidate) return null;
    return KNOWN_TRACKERS.find((tracker) => (
      normalizedCandidate === tracker.domain
      || normalizedCandidate.endsWith(`.${tracker.domain}`)
    )) || null;
  }

  function collectResourceDomains() {
    const selectorToAttr = [
      ['script[src]', 'src'],
      ['img[src]', 'src'],
      ['iframe[src]', 'src'],
      ['link[href]', 'href'],
      ['source[src]', 'src'],
      ['video[src]', 'src'],
      ['audio[src]', 'src'],
      ['embed[src]', 'src'],
      ['object[data]', 'data'],
      ['form[action]', 'action'],
    ];

    const hits = [];
    const seen = new Set();

    const addHit = (domain, source) => {
      const normalized = normalizeDomainLike(domain);
      if (!normalized) return;
      const key = `${normalized}|${source}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push({ domain: normalized, source });
    };

    // Include runtime resource activity so dynamically loaded trackers are captured.
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      try {
        const resourceEntries = window.performance.getEntriesByType('resource') || [];
        resourceEntries.forEach((entry) => {
          if (!entry?.name) return;
          try {
            const host = new URL(entry.name, window.location.href).hostname;
            const initiator = entry.initiatorType ? `performance:${entry.initiatorType}` : 'performance:resource';
            addHit(host, initiator);
          } catch {
            // Ignore malformed resource URLs.
          }
        });
      } catch {
        // Ignore environments where Performance entries are restricted.
      }
    }

    selectorToAttr.forEach(([selector, attr]) => {
      document.querySelectorAll(selector).forEach((el) => {
        const host = extractHostnameFromUrl(el.getAttribute(attr));
        if (!host) return;
        addHit(host, selector);
      });
    });

    const inlineUrlRegex = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?[^\s"'`)]*/gi;
    document.querySelectorAll('script:not([src])').forEach((script) => {
      const text = script.textContent || '';
      const matches = text.match(inlineUrlRegex) || [];
      matches.forEach((url) => {
        const host = extractHostnameFromUrl(url);
        if (!host) return;
        addHit(host, 'inline-script-url');
      });
    });

    return hits;
  }

  function findPriceRelatedContainers() {
    const selectors = [
      '[class*="price"]',
      '[id*="price"]',
      '[class*="summary"]',
      '[id*="summary"]',
      '[class*="cart"]',
      '[id*="cart"]',
      '[class*="checkout"]',
      '[id*="checkout"]',
      '[class*="deal"]',
      '[class*="offer"]',
      '[class*="discount"]',
      '.a-price',
      '._30jeq3',
      '._3I9_wc',
    ];

    const seen = new Set();
    const containers = [];
    document.querySelectorAll(selectors.join(', ')).forEach((el) => {
      if (!isElementVisibleForDetection(el)) return;

      const text = normalizeScanText(el.textContent || '');
      if (text.length < 20 || text.length > 1600) return;
      if (!/(₹|rs\.?|inr|\$)\s*[\d,]+/i.test(text)) return;

      const dedupeKey = text.toLowerCase().slice(0, 180);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      containers.push({ element: el, text });
    });

    return containers.slice(0, 120);
  }

  function extractCurrencyValues(text) {
    const values = [];
    const regex = /(?:₹|rs\.?|inr|\$)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
    const normalized = String(text || '');
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      const parsed = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) values.push(parsed);
    }
    return values;
  }

  function normalizeScanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isElementVisibleForDetection(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || 1) < 0.08) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 24 && rect.height >= 12;
  }

  function getElementActionText(el) {
    const aria = el.getAttribute?.('aria-label') || '';
    const title = el.getAttribute?.('title') || '';
    const text = el.innerText || el.textContent || '';
    return normalizeScanText(`${aria} ${title} ${text}`);
  }

  function isTransparentColor(colorValue) {
    if (!colorValue) return true;
    const lower = String(colorValue).toLowerCase().trim();
    return lower === 'transparent' || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)/.test(lower);
  }

  function buttonVisualWeight(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const area = Math.max(1, rect.width * rect.height);

    const fontWeightRaw = parseInt(style.fontWeight, 10);
    const fontFactor = Number.isFinite(fontWeightRaw)
      ? 1 + Math.max(0, Math.min(0.45, (fontWeightRaw - 400) / 1000))
      : 1;

    const backgroundFactor = isTransparentColor(style.backgroundColor) ? 1 : 1.2;
    const opacityFactor = Math.max(0.4, Math.min(1, Number(style.opacity || 1)));

    return area * fontFactor * backgroundFactor * opacityFactor;
  }

  function isWeaklyVisibleAction(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity || 1) < 0.6 ||
      rect.width < 48 ||
      rect.height < 20
    );
  }

  function collectDarkPatternCandidates(bodyText) {
    const selectors = [
      'button',
      'a',
      'label',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'li',
      'p',
      'strong',
      '[role="button"]',
      '[role="dialog"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      '[aria-label]',
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '.modal',
      '.popup',
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(', ')));
    const candidates = [];
    const seen = new Set();

    nodes.forEach((el) => {
      if (!isElementVisibleForDetection(el)) return;
      const text = getElementActionText(el);
      if (text.length < 8) return;
      if (text.length > 260) return;
      const dedupeKey = text.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const hasConsentCue = /\b(cookie|consent|accept|reject|decline|allow|manage|settings|opt\s*out|unsubscribe|cancel|no\s*thanks)\b/i.test(text);
      candidates.push({
        text: text.slice(0, 260),
        element: el,
        contextScore: hasConsentCue ? 0.84 : 0.72,
      });
    });

    const highSignalSentenceRegex = /\b(cookie|consent|accept|reject|decline|no\s*thanks|uncheck|untick|opt\s*out|newsletter|unsubscribe|allow|manage|settings|marketing|double\s*negative|dark\s*patterns?|deceptive\s*patterns?|false\s*urgency|sneaking|drip\s*pricing|hidden\s*costs?|confirm\s*shaming|trick\s*wording|forced\s*continuity|disguised\s*ads?|misdirection|nagging|obstruction|roach\s*motel|pre[\s-]?selected)\b/i;
    const bodySentences = normalizeScanText(bodyText || '')
      .split(/(?<=[.!?])\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 20 && entry.length <= 260 && highSignalSentenceRegex.test(entry));

    bodySentences.slice(0, 24).forEach((entry) => {
      const dedupeKey = entry.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      candidates.push({
        text: entry,
        element: document.body,
        contextScore: 0.68,
      });
    });

    if (candidates.length === 0) {
      const compactFallback = normalizeScanText(bodyText || '').slice(0, 220);
      if (compactFallback) {
        candidates.push({
          text: compactFallback,
          element: document.body,
          contextScore: 0.58,
        });
      }
    }

    return candidates;
  }

  function findConsentContainers() {
    const containerSelectors = [
      '[role="dialog"]',
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '.modal',
      '.popup',
    ];

    return Array.from(document.querySelectorAll(containerSelectors.join(', ')))
      .filter((el) => {
        if (!isElementVisibleForDetection(el)) return false;
        const text = normalizeScanText(el.textContent || '');
        return /\b(cookie|consent|privacy|accept|reject|decline|manage|settings|preferences)\b/i.test(text);
      })
      .slice(0, 8);
  }

  function findElementContaining(regex) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    let node;
    while ((node = walker.nextNode())) {
      if (regex.test(node.textContent)) {
        const el = node.parentElement;
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
      }
    }
    return null;
  }

  function getPatternSample(text, regex) {
    const match = text.match(regex);
    return match ? match[0].slice(0, 80) : '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RUNNER
  // ═══════════════════════════════════════════════════════════════════════════

  async function runAnalysis() {
    await refreshExtensionEnabledState();
    if (!extensionEnabled) {
      resetAnalysisState();
      clearConsumerShieldArtifacts();
      return;
    }

    if (analysisRun) return;
    analysisRun = true;

    if (!warmupRescanScheduled) {
      warmupRescanScheduled = true;
      [2800, 6500].forEach((delayMs) => {
        scheduleTrackedTimeout(() => {
          if (!extensionEnabled) return;
          resetAnalysisState();
          runAnalysis();
        }, delayMs);
      });
    }

    try {
      injectOverlayStyles();
      detectTrackers();
      await enrichTrackersFromBackground();
      analyzePrivacyPolicy();
      await detectDarkPatterns();

      // Send price sample (if product page)
      const priceSample = collectPriceSample();
      if (priceSample && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'priceSample',
          data: priceSample,
        }, () => {
          if (chrome.runtime?.lastError) { /* noop */ }
        });
      }

      // Send results to background worker
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            action: 'analyzeComplete',
            data: {
              url: window.location.href,
              domain: window.location.hostname,
              timestamp: Date.now(),
              privacy: {
                trackers: state.trackers,
                detectedDomains: state.detectedDomains,
                policy: state.policy,
                fingerprinting: state.fingerprinting,
              },
              manipulation: {
                patterns: state.patterns.map(p => ({
                  type: p.type,
                  name: p.name,
                  severity: p.severity,
                  confidence: p.confidence,
                  law: p.law,
                  penalty: p.penalty,
                  description: p.description,
                  text: p.text,
                  occurrence_count: Number(p.occurrence_count || 1),
                  target: buildPatternTargetMeta(p.element),
                })),
              },
            }
          }, () => {
            // Ignore transient messaging failures (popup closed / extension reloaded)
            if (chrome.runtime?.lastError) { /* noop */ }
          });
        } catch (error) {
          if (!isExtensionContextInvalidatedError(error)) {
            throw error;
          }
        }
      }
    } catch (err) {
      if (!isExtensionContextInvalidatedError(err)) {
        console.warn('[ConsumerShield] Analysis error:', err);
      }
    }
  }

  function collectPriceSample() {
    const url = window.location.href || '';
    const domain = (window.location.hostname || '').replace(/^www\./, '').toLowerCase();
    let productId = null;
    let priceSelectors = [];
    let oldPriceSelectors = [];

    if (domain.includes('amazon')) {
      const match = url.match(/\/dp\/([A-Z0-9]+)/);
      productId = match ? match[1] : null;
      priceSelectors = ['#priceblock_ourprice', '#priceblock_dealprice', '.a-price-whole'];
      oldPriceSelectors = ['#priceblock_listprice', '.a-text-price .a-offprice'];
    } else if (domain.includes('flipkart')) {
      const match = url.match(/pid=([A-Z0-9]+)/);
      productId = match ? match[1] : null;
      priceSelectors = ['._30xHcL', '.NhGU7', '._16nhp8'];
      oldPriceSelectors = ['._3I9_wc', '._2p6lqe'];
    } else {
      return null;
    }

    if (!productId) return null;

    const currentPrice = pickPriceFromSelectors(priceSelectors);
    if (!currentPrice) return null;

    const oldPrice = pickPriceFromSelectors(oldPriceSelectors);
    const discountMatch = document.body?.innerText?.match(/(\d{1,3})\s*%\s*off/i);
    const displayedDiscount = discountMatch ? Number(discountMatch[1]) : null;

    return {
      productId,
      domain,
      url,
      currentPrice,
      oldPrice,
      displayedDiscount,
      ts: Date.now(),
    };
  }

  function pickPriceFromSelectors(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const values = extractCurrencyValues(el.textContent || '');
      if (values.length > 0) return values[0];
    }
    return null;
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.action === 'focusDetectedPattern') {
        (async () => {
          injectOverlayStyles();
          const pattern = message.pattern || {};
          const patternText = normalizeScanText(
            pattern.patternText
            || pattern.snippet
            || pattern.text
            || pattern.target?.textPreview
            || '',
          );

          let target = await findReactElementByTextWithRetry(patternText);
          if (!target) {
            target = findPatternFocusElement(pattern);
          }
          if (!target && patternText) {
            target = await waitForReactElementByMutation(patternText, 3000);
          }

          const focusLabel = String(pattern?.name || pattern?.type || 'Detected pattern');
          const focused = target ? focusPatternElement(target, focusLabel) : false;

          if (!focused) {
            flashFullPageFocusFallback();
          }

          sendResponse({
            success: focused,
            searchText: patternText.slice(0, 120),
            targetTag: focused ? String(target?.tagName || '').toLowerCase() : null,
            fallback: focused ? null : 'page-outline',
          });
        })().catch((error) => {
          console.warn('[ConsumerShield] Focus fallback error:', error);
          flashFullPageFocusFallback();
          sendResponse({
            success: false,
            targetTag: null,
            fallback: 'page-outline',
          });
        });
        return true;
      }

      if (message?.action !== 'extensionEnabledChanged') return;

      extensionEnabled = Boolean(message.enabled);
      if (!extensionEnabled) {
        resetAnalysisState();
        clearConsumerShieldArtifacts();
        return;
      }

      setTimeout(runAnalysis, 200);
    });
  }

  window.addEventListener('beforeunload', () => {
    clearScheduledAnalysisTimers();
  });

  // Run after page is interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      await refreshExtensionEnabledState();
      if (!extensionEnabled) return;
      runAnalysis();
    });
  } else {
    // Slight delay so dynamic content has time to render
    scheduleTrackedTimeout(async () => {
      await refreshExtensionEnabledState();
      if (!extensionEnabled) return;
      runAnalysis();
    }, 800);
  }

  // Re-run on SPA navigation (More efficient check)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetAnalysisState();
      scheduleTrackedTimeout(async () => {
        await refreshExtensionEnabledState();
        if (!extensionEnabled) return;
        runAnalysis();
      }, 1200);
    }
  }, 2000);

  // ═══════════════════════════════════════════════════════════════════════════
  // INFINITE SCROLL DETECTION (MutationObserver)
  // ═══════════════════════════════════════════════════════════════════════════

  function detectUrgencyPatterns() {
    const scarcityPatterns = [
      /only\s*(\d+|one|two|three|few|several)\s*(left|remaining|in stock|available|spots)/i,
      /selling\s*out|sold\s*out/i,
      /(\d+)\s*people\s*(are\s*)?(viewing|watching|looking at|browsing|interested)/i,
      /(\d+)\s*(hours?|mins?|minutes?|seconds?)\s*(left|remaining|till|until)/i,
      /limited\s*(time|offer|stock|quantity)/i,
      /last\s*(chance|opportunity|few|day)/i,
      /hurry[!,\s]*only/i,
      /fast\s*selling/i,
    ];

    const bodyText = document.body.innerText || '';
    
    for (const pattern of scarcityPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const existing = state.patterns.find(p => p.type === 'urgency' && p.name === 'Scarcity Signal');
        if (!existing) {
          state.patterns.push({
            type: 'urgency',
            name: 'Scarcity Signal',
            severity: 'high',
            confidence: 0.78,
            law: DARK_PATTERNS.urgency.law,
            penalty: DARK_PATTERNS.urgency.penalty,
            description: `Artificial scarcity detected: "${match[0]}"`,
            element: document.body,
            text: match[0].slice(0, 100),
          });
        }
        break;
      }
    }
  }

  function setupInfiniteScrollObserver() {
    if (!isEcommerceDomain()) return;
    
    let rescanTimeout = null;
    const DEBOUNCE_MS = 400;

    const itemLevelPatterns = [
      'fake_original_price',
      'price_anchoring',
      'urgency'
    ];

    const rescanForInfiniteScroll = () => {
      if (rescanTimeout) clearTimeout(rescanTimeout);
      rescanTimeout = setTimeout(() => {
        if (!extensionEnabled) return;
        
        injectOverlayStyles();
        detectFakeOriginalPrice();
        detectPriceAnchoring();
        detectCountdownTimers();
        detectUrgencyPatterns();
        
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            chrome.runtime.sendMessage({
              action: 'analyzeComplete',
              data: {
                url: window.location.href,
                domain: window.location.hostname,
                timestamp: Date.now(),
                privacy: {
                  trackers: state.trackers,
                  detectedDomains: state.detectedDomains,
                  policy: state.policy,
                  fingerprinting: state.fingerprinting,
                },
                manipulation: {
                  patterns: state.patterns
                    .filter(p => itemLevelPatterns.includes(p.type))
                    .map(p => ({
                      type: p.type,
                      name: p.name,
                      severity: p.severity,
                      confidence: p.confidence,
                      law: p.law,
                      penalty: p.penalty,
                      description: p.description,
                      text: p.text,
                      occurrence_count: Number(p.occurrence_count || 1),
                      target: buildPatternTargetMeta(p.element),
                    })),
                },
              }
            }, () => {
              if (chrome.runtime?.lastError) { /* noop */ }
            });
          } catch (error) {
            if (!isExtensionContextInvalidatedError(error)) {
              console.warn('[ConsumerShield] Infinite scroll rescan error:', error);
            }
          }
        }
      }, DEBOUNCE_MS);
    };

    const observer = new MutationObserver((mutations) => {
      const hasNewNodes = mutations.some(mutation => mutation.addedNodes.length > 0);
      if (hasNewNodes) {
        rescanForInfiniteScroll();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[ConsumerShield] Infinite scroll observer active for:', window.location.hostname);
  }

  // Start infinite scroll observer after initial analysis
  scheduleTrackedTimeout(() => {
    setupInfiniteScrollObserver();
  }, 2000);

})();
