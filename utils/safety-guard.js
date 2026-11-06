/**
 * Siddarth Deterministic Safety Rails Subsystem
 * Slice 16: Deterministic Safety Rails (Domain & Password / Card Guards)
 * 
 * Enforces zero-compromise deterministic safety rules in code:
 * 1. Hard Domain Blocking:
 *    - Blocks banking, payments, UPI, and financial URLs immediately.
 *    - Blocks internal browser URLs (chrome://, edge://, devtools://, etc.).
 * 2. Sensitive Element Protection:
 *    - Intercepts and rejects any attempt to interact with password, OTP, CVV, PIN, or credit card inputs.
 *    - Uses multi-attribute heuristic inspection (type, name, id, placeholder, autocomplete, aria-label).
 * 3. Consequential Action Double-Confirmation:
 *    - Detects consequential actions (submit, pay, buy, delete, remove, transfer, send, confirm).
 *    - Enforces a mandatory secondary confirmation modal before execution.
 */

// Banking, Payment, and UPI URL pattern (Architecture Section 5.1 & Edge Cases Section 6)
export const BANKING_URL_REGEX = /(bank|banking|hdfc|sbi|icici|axis|kotak|pnb|bob|paypal|stripe|razorpay|paytm|phonepe|gpay|pay\.|payment|upi|billdesk|cashfree|instamojo|checkout\.stripe|authorize\.net|netbanking)/i;

// Browser internal URL pattern
export const INTERNAL_URL_REGEX = /^(chrome|chrome-extension|devtools|edge|about|view-source):/i;

// Sensitive credentials, PIN, OTP, and financial input fields pattern
export const SENSITIVE_FIELD_REGEX = /(pass|password|pin|otp|cvv|cvc|card|credit|cardnumber|exp-date|secret|token|ssn|aadhaar|security-code)/i;

// Consequential action trigger keywords requiring secondary confirmation
export const CONSEQUENTIAL_REGEX = /(submit|buy|order|pay|transfer|delete|remove|send|confirm|checkout|purchase|destroy|terminate)/i;

export class SafetyGuard {
  /**
   * Deterministically checks if a URL is a banking, payment, or UPI domain
   * @param {string} url
   * @returns {boolean}
   */
  static isFinancialUrl(url = '') {
    if (!url || typeof url !== 'string') return false;
    const cleanUrl = url.trim().toLowerCase();

    // Check full URL string
    if (BANKING_URL_REGEX.test(cleanUrl)) return true;

    // Check parsed hostname if valid URL
    try {
      const parsed = new URL(cleanUrl);
      if (BANKING_URL_REGEX.test(parsed.hostname) || BANKING_URL_REGEX.test(parsed.pathname)) {
        return true;
      }
    } catch {
      // URL parsing failed; rely on regex check on raw string
    }

    return false;
  }

  /**
   * Checks if URL is an internal or restricted browser URL
   * @param {string} url
   * @returns {boolean}
   */
  static isInternalUrl(url = '') {
    if (!url || typeof url !== 'string') return true;
    return INTERNAL_URL_REGEX.test(url.trim());
  }

  /**
   * Comprehensive domain check: returns structured safety status
   * @param {string} url
   * @returns {{ safe: boolean, error: string|null, type: 'financial'|'internal'|null }}
   */
  static checkUrlSafety(url = '') {
    if (!url || typeof url !== 'string') {
      return { safe: false, error: 'No URL provided.', type: 'internal' };
    }

    if (this.isFinancialUrl(url)) {
      return {
        safe: false,
        error: 'Automated actions are disabled on banking/financial domains.',
        type: 'financial'
      };
    }

    if (this.isInternalUrl(url)) {
      const displayUrl = (url || '').split('?')[0];
      return {
        safe: false,
        error: `Cannot automate internal browser page (${displayUrl}). Please open a regular website.`,
        type: 'internal'
      };
    }

    return { safe: true, error: null, type: null };
  }

  /**
   * Deterministically inspects an input element or attribute bundle for sensitive credentials/cards
   * @param {HTMLElement|object} el
   * @returns {boolean}
   */
  static isSensitiveField(el) {
    if (!el) return false;

    // 1. Direct type check
    const type = (el.type || el.getAttribute?.('type') || '').toLowerCase().trim();
    if (type === 'password') return true;

    // 2. Autocomplete attribute check (HTML5 standard payment/security attributes)
    const autocomplete = (el.autocomplete || el.getAttribute?.('autocomplete') || '').toLowerCase().trim();
    if (
      autocomplete.includes('cc-') ||
      autocomplete.includes('current-password') ||
      autocomplete.includes('new-password') ||
      autocomplete.includes('one-time-code') ||
      autocomplete.includes('transaction-amount')
    ) {
      return true;
    }

    // 3. Multi-attribute heuristic check (handles masqueraded text inputs like type="text" name="user_pin")
    const combined = [
      el.id || el.getAttribute?.('id') || '',
      el.name || el.getAttribute?.('name') || '',
      el.placeholder || el.getAttribute?.('placeholder') || '',
      el.getAttribute?.('aria-label') || '',
      el.title || el.getAttribute?.('title') || '',
      el.label || el.role || ''
    ].join(' ').toLowerCase();

    return SENSITIVE_FIELD_REGEX.test(combined);
  }

  /**
   * Asserts that a targeted field is safe to receive automated actions.
   * Throws deterministic security error if sensitive.
   * @param {string} action
   * @param {HTMLElement|object} el
   * @param {number|string} targetId
   */
  static assertFieldSafeForAction(action = '', el = null, targetId = '') {
    const cleanAction = String(action || '').toLowerCase().trim();

    if (cleanAction === 'type' || cleanAction === 'click') {
      if (this.isSensitiveField(el)) {
        throw new Error(
          `Security Guard: Automated actions on password, PIN, OTP, or credit card field #${targetId || 'unknown'} are strictly prohibited.`
        );
      }
    }
  }

  /**
   * Deterministically detects if an action is consequential (irreversible, submit, delete, payment)
   * @param {object} proposal
   * @param {HTMLElement|object} [el=null]
   * @returns {boolean}
   */
  static isConsequentialAction(proposal = {}, el = null) {
    if (!proposal) return false;

    // Direct flag from planner or scanner
    if (proposal.isConsequential) return true;
    if (el?.isConsequential) return true;

    // Inspect action description, reason, label, and value
    const textToCheck = [
      proposal.reason || '',
      proposal.label || '',
      proposal.value || '',
      el?.label || el?.innerText || el?.value || '',
      el?.getAttribute?.('aria-label') || ''
    ].join(' ').toLowerCase();

    return CONSEQUENTIAL_REGEX.test(textToCheck);
  }
}

// Global exposure for content scripts and extensions
if (typeof window !== 'undefined') {
  window.SafetyGuard = SafetyGuard;
  window.BANKING_URL_REGEX = BANKING_URL_REGEX;
  window.SENSITIVE_FIELD_REGEX = SENSITIVE_FIELD_REGEX;
  window.CONSEQUENTIAL_REGEX = CONSEQUENTIAL_REGEX;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SafetyGuard,
    BANKING_URL_REGEX,
    INTERNAL_URL_REGEX,
    SENSITIVE_FIELD_REGEX,
    CONSEQUENTIAL_REGEX
  };
}
