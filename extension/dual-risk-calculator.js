/**
 * ConsumerShield — Dual Risk Calculator
 * Calculates Privacy Risk (0–10) and Manipulation Risk (0–10)
 * No external dependencies — runs in both content script and background.
 */

class DualRiskCalculator {

  // ─── Privacy Risk ──────────────────────────────────────────────────────────

  calculatePrivacyRisk(privacyData) {
    let score = 0;

    // Trackers detected (max 4 points)
    const trackerCount = (privacyData.trackers || []).length;
    if (trackerCount >= 10) score += 4;
    else if (trackerCount >= 6) score += 3;
    else if (trackerCount >= 3) score += 2;
    else if (trackerCount >= 1) score += 1;

    // Third-party data sharing (1.5 points)
    if (privacyData.policy?.thirdPartySharing) score += 1.5;

    // No opt-out mechanism (1.5 points)
    if (privacyData.policy?.noOptOut) score += 1.5;

    // Extensive data collection language (1 point)
    if (privacyData.policy?.extensiveCollection) score += 1;

    // Fingerprinting / canvas tracking (2 points)
    if (privacyData.fingerprinting) score += 2;

    return Math.min(10, parseFloat(score.toFixed(1)));
  }

  // ─── Manipulation Risk ─────────────────────────────────────────────────────

  calculateManipulationRisk(manipulationData) {
    const severityWeights = { low: 0.8, medium: 2.0, high: 4.0 };
    let score = 0;

    const patterns = manipulationData.patterns || [];
    for (const pattern of patterns) {
      const weight = severityWeights[pattern.severity] || 0.8;
      const confidence = pattern.confidence || 1.0;
      score += weight * confidence;
    }

    return Math.min(10, parseFloat(score.toFixed(1)));
  }

  // ─── Overall Risk ──────────────────────────────────────────────────────────

  calculateOverallRisk(privacyRisk, manipulationRisk) {
    // Conservative scoring: overall risk is driven by the strongest signal.
    return parseFloat(Math.max(privacyRisk, manipulationRisk).toFixed(1));
  }

  // ─── Risk Level Labels ─────────────────────────────────────────────────────

  getRiskLevel(score) {
    if (score >= 8.5) return 'CRITICAL';
    if (score >= 6.5) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    if (score >= 2.0) return 'LOW';
    return 'MINIMAL';
  }

  getRiskColor(level) {
    const colors = {
      CRITICAL: '#ef4444',
      HIGH: '#f97316',
      MEDIUM: '#eab308',
      LOW: '#22c55e',
      MINIMAL: '#6ee7b7'
    };
    return colors[level] || '#6ee7b7';
  }

  getRiskEmoji(level) {
    const emojis = {
      CRITICAL: '🚨',
      HIGH: '⚠️',
      MEDIUM: '🔔',
      LOW: '✅',
      MINIMAL: '✅'
    };
    return emojis[level] || '✅';
  }

  // ─── Insight Generator ─────────────────────────────────────────────────────

  generateInsight(analysis) {
    const pLevel = this.getRiskLevel(analysis.privacy?.riskScore || 0);
    const mLevel = this.getRiskLevel(analysis.manipulation?.riskScore || 0);
    const trackers = (analysis.privacy?.trackers || []).length;
    const patterns = (analysis.manipulation?.patterns || []).length;

    if (pLevel === 'CRITICAL' && mLevel === 'CRITICAL') {
      return `🚨 This site aggressively exploits you on BOTH fronts — ${trackers} trackers stealing your data and ${patterns} manipulation tactics distorting your decisions. Proceed with extreme caution.`;
    }
    if (pLevel === 'HIGH' || pLevel === 'CRITICAL') {
      return `⚠️ This site invades your privacy with ${trackers} trackers and shares your data with third parties without clear consent, violating the DPDP Act 2023.`;
    }
    if (mLevel === 'HIGH' || mLevel === 'CRITICAL') {
      return `⚠️ This site uses ${patterns} psychological manipulation tactic(s) to pressure your decisions, violating CCPA Dark Patterns Guidelines 2023.`;
    }
    if (pLevel === 'MEDIUM' || mLevel === 'MEDIUM') {
      return `🔔 This site has some concerning practices — review the Privacy and Manipulation tabs for details.`;
    }
    if (trackers === 0 && patterns === 0) {
      return `✅ No major privacy violations or dark patterns detected on this page.`;
    }
    return `ℹ️ ${trackers} tracker(s) and ${patterns} dark pattern(s) detected. Review tabs for details.`;
  }
}

// Export for both module and classic script contexts
if (typeof module !== 'undefined') {
  module.exports = DualRiskCalculator;
}
