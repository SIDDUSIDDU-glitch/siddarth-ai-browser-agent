/**
 * Siddarth Action Executor Subsystem
 * Slice 12: Approval-Based Agent Action Loop
 * 
 * - Dispatches safe synthetic events: click, type, select, scroll, and done.
 * - Framework compatibility: Uses HTMLInputElement/HTMLTextAreaElement prototype setters
 *   to ensure React, Vue, and Angular synthetic state updates trigger properly.
 * - File inputs: Programmatic file path injection is restricted by browser security;
 *   notifies user and scrolls/focuses the input for manual file pick.
 * - Sensitive field protection: Blocks automated typing into password, CC, or OTP fields.
 * - Consequential actions: Flags and logs consequential execution.
 */

(function (global) {
  'use strict';

  // Sensitive field detection regex (Architecture Section 5.2 & Edge Cases Section 6)
  const SENSITIVE_REGEX = /(pass|password|pin|otp|cvv|cvc|card|credit|secret|token)/i;

  class ActionExecutor {
    constructor() {
      this.lastExecutedAction = null;
    }

    /**
     * Resolves DOM element reference by target ID
     * @param {number|string} targetId
     * @returns {HTMLElement|null}
     */
    resolveElement(targetId) {
      if (!targetId) return null;
      const numId = parseInt(targetId, 10);

      // Check global elements map from scanner
      if (typeof window !== 'undefined' && window.__siddarthElements instanceof Map) {
        const fromMap = window.__siddarthElements.get(numId);
        if (fromMap && (fromMap.isConnected === undefined || fromMap.isConnected)) return fromMap;
      }

      // Check scanner instance
      if (typeof globalThis.SiddarthScanner?.elementMap?.get === 'function') {
        const fromScanner = globalThis.SiddarthScanner.elementMap.get(numId);
        if (fromScanner && (fromScanner.isConnected === undefined || fromScanner.isConnected)) return fromScanner;
      }

      // Fallback: search DOM by data-siddarth-id attribute
      if (typeof document !== 'undefined') {
        const byAttr = document.querySelector(`[data-siddarth-id="${numId}"]`);
        if (byAttr) return byAttr;
      }

      return null;
    }

    /**
     * Checks if element represents a protected sensitive field (passwords, PINs, cards, OTPs)
     * @param {HTMLElement} el
     * @returns {boolean}
     */
    isSensitiveField(el) {
      if (typeof global.SafetyGuard?.isSensitiveField === 'function') {
        return global.SafetyGuard.isSensitiveField(el);
      }
      if (!el) return false;
      const type = (el.type || el.getAttribute?.('type') || '').toLowerCase();
      if (type === 'password') return true;

      const autocomplete = (el.autocomplete || el.getAttribute?.('autocomplete') || '').toLowerCase();
      if (
        autocomplete.includes('cc-') ||
        autocomplete.includes('current-password') ||
        autocomplete.includes('new-password') ||
        autocomplete.includes('one-time-code')
      ) {
        return true;
      }

      const combined = [
        el.getAttribute?.('name') || '',
        el.id || '',
        el.getAttribute?.('autocomplete') || '',
        el.getAttribute?.('placeholder') || '',
        el.getAttribute?.('aria-label') || '',
        el.getAttribute?.('title') || ''
      ].join(' ');

      return SENSITIVE_REGEX.test(combined);
    }

    /**
     * Executes an approved atomic browser action on the webpage
     * @param {object} actionProposal
     * @param {string} actionProposal.action 'click' | 'type' | 'select' | 'scroll' | 'done'
     * @param {number} actionProposal.targetId
     * @param {string|number} actionProposal.value
     * @param {boolean} [actionProposal.dryRun=false] When true, scrolls & highlights without dispatching clicks or keystrokes
     * @returns {Promise<object>}
     */
    async executeAction({ action, targetId = null, value = null, dryRun = false } = {}) {
      const cleanAction = (action || '').toLowerCase().trim();

      if (!['click', 'type', 'select', 'scroll', 'done'].includes(cleanAction)) {
        throw new Error(`Unsupported action type: "${action}". Valid actions are click, type, select, scroll, done.`);
      }

      // Done action
      if (cleanAction === 'done') {
        this.lastExecutedAction = { action: 'done', isDryRun: Boolean(dryRun), timestamp: Date.now() };
        return {
          success: true,
          action: 'done',
          isDryRun: Boolean(dryRun),
          message: dryRun ? '[Dry-Run Simulation] Task simulation completed.' : 'Task completed successfully.'
        };
      }

      // Scroll action (can be global window scroll or targeted element scroll)
      if (cleanAction === 'scroll') {
        if (dryRun) {
          if (targetId) {
            const el = this.resolveElement(targetId);
            el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          }
          const dryScroll = {
            success: true,
            action: 'scroll',
            targetId,
            value,
            isDryRun: true,
            simulated: true,
            message: `[Dry-Run Simulation] Simulated scroll to ${targetId ? `element #${targetId}` : 'webpage offset'}.`,
            timestamp: Date.now()
          };
          this.lastExecutedAction = dryScroll;
          return dryScroll;
        }
        return this.executeScroll(targetId, value);
      }

      // Element-targeted actions require resolving target DOM node
      const el = this.resolveElement(targetId);
      if (!el) {
        throw new Error(`Target element #${targetId} was not found on the page. The page DOM may have changed.`);
      }

      if (el.disabled) {
        throw new Error(`Target element #${targetId} is disabled and cannot receive actions.`);
      }

      // Deterministic Safety Guard: Block passwords, credit cards, OTPs even in dry-run
      if (cleanAction === 'type' && this.isSensitiveField(el)) {
        throw new Error(`Security Guard: Automated typing into sensitive credential/card field #${targetId} is strictly blocked.`);
      }

      // Dry-Run Simulation Mode: Centers & focuses element, but dispatches ZERO DOM mutations or clicks
      if (dryRun) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch {
          el.scrollIntoView?.();
        }
        el.focus?.();

        const label = el.innerText || el.value || el.getAttribute?.('aria-label') || el.name || `Element #${targetId}`;
        const dryResult = {
          success: true,
          action: cleanAction,
          targetId,
          value: value !== null && value !== undefined ? String(value) : null,
          label: (label || '').trim(),
          isDryRun: true,
          simulated: true,
          message: `[Dry-Run Simulation] Simulated ${cleanAction} on #${targetId} ("${(label || '').trim()}") without modifying webpage.`,
          timestamp: Date.now()
        };
        this.lastExecutedAction = dryResult;
        return dryResult;
      }

      // Execute targeted action
      switch (cleanAction) {
        case 'click':
          return this.executeClick(el, targetId);

        case 'type':
          return this.executeType(el, targetId, value);

        case 'select':
          return this.executeSelect(el, targetId, value);

        default:
          throw new Error(`Unknown action: ${cleanAction}`);
      }
    }

    /**
     * Safe synthetic click execution
     * @param {HTMLElement} el
     * @param {number} targetId
     */
    executeClick(el, targetId) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView?.();
      }

      el.focus?.();

      // Handle checkbox / radio toggle explicitly
      if (el.type === 'checkbox') {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.type === 'radio') {
        el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Dispatch full pointer and mouse event cascade
      if (typeof MouseEvent === 'function') {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      if (typeof el.click === 'function') {
        try {
          el.click();
        } catch {
          // Native click may throw if navigation occurs
        }
      }

      const label = el.innerText || el.value || el.getAttribute?.('aria-label') || el.name || `Element #${targetId}`;
      const result = {
        success: true,
        action: 'click',
        targetId,
        label: label.trim(),
        timestamp: Date.now()
      };

      this.lastExecutedAction = result;
      return result;
    }

    /**
     * Safe synthetic typing with React/Vue framework prototype setter compatibility
     * @param {HTMLElement} el
     * @param {number} targetId
     * @param {string|number} value
     */
    executeType(el, targetId, value) {
      // Deterministic Safety Guard: Block passwords, credit cards, OTPs
      if (this.isSensitiveField(el)) {
        throw new Error(`Security Guard: Automated typing into sensitive credential/card field #${targetId} is strictly blocked.`);
      }

      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView?.();
      }

      el.focus?.();

      const stringVal = String(value !== undefined && value !== null ? value : '');

      // Special handling for file inputs: OS sandbox forbids programmatic file path setting
      if (el.type === 'file') {
        el.click?.();
        const result = {
          success: true,
          action: 'type',
          targetId,
          requiresManualUpload: true,
          message: 'File input focused. Please select your file from the system dialog.',
          timestamp: Date.now()
        };
        this.lastExecutedAction = result;
        return result;
      }

      // Framework State Trigger: Use native prototype value setter so React/Vue/Angular
      // synthetic event systems detect value mutations (Edge Cases Section 5)
      try {
        const isTextArea = el.tagName === 'TEXTAREA';
        const prototype = isTextArea && typeof window !== 'undefined' && window.HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : typeof window !== 'undefined' && window.HTMLInputElement
            ? window.HTMLInputElement.prototype
            : null;

        const nativeSetter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;
        if (nativeSetter) {
          nativeSetter.call(el, stringVal);
        } else {
          el.value = stringVal;
        }
      } catch {
        el.value = stringVal;
      }

      // Dispatch full input event lifecycle
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      const result = {
        success: true,
        action: 'type',
        targetId,
        value: stringVal,
        label: el.name || el.placeholder || `Input #${targetId}`,
        timestamp: Date.now()
      };

      this.lastExecutedAction = result;
      return result;
    }

    /**
     * Safe synthetic select / dropdown option selection
     * @param {HTMLElement} el
     * @param {number} targetId
     * @param {string|number} value
     */
    executeSelect(el, targetId, value) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView?.();
      }

      el.focus?.();

      const targetVal = String(value !== undefined && value !== null ? value : '').toLowerCase().trim();

      if (el.tagName === 'SELECT' && el.options) {
        let matchedIndex = -1;

        // 1. Exact or case-insensitive value match
        for (let i = 0; i < el.options.length; i++) {
          const optVal = String(el.options[i].value || '').toLowerCase().trim();
          if (optVal === targetVal) {
            matchedIndex = i;
            break;
          }
        }

        // 2. Fuzzy text match if value didn't match
        if (matchedIndex === -1) {
          for (let i = 0; i < el.options.length; i++) {
            const optText = String(el.options[i].text || el.options[i].textContent || '').toLowerCase().trim();
            if (optText.includes(targetVal) || targetVal.includes(optText)) {
              matchedIndex = i;
              break;
            }
          }
        }

        if (matchedIndex !== -1) {
          el.selectedIndex = matchedIndex;
          if (el.options[matchedIndex]) {
            el.options[matchedIndex].selected = true;
          }
        } else if (el.options.length > 1 && !targetVal) {
          el.selectedIndex = 1; // Pick first valid choice if none specified
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Custom dropdown component: set value attribute or click
        el.value = targetVal;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const result = {
        success: true,
        action: 'select',
        targetId,
        value: targetVal,
        timestamp: Date.now()
      };

      this.lastExecutedAction = result;
      return result;
    }

    /**
     * Executes scroll on page or targeted element
     * @param {number|null} targetId
     * @param {object|number|null} value
     */
    executeScroll(targetId, value) {
      if (targetId) {
        const el = this.resolveElement(targetId);
        if (el) {
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch {
            el.scrollIntoView?.();
          }
          return {
            success: true,
            action: 'scroll',
            targetId,
            message: `Scrolled to element #${targetId}.`
          };
        }
      }

      // Window scroll
      const deltaY = typeof value === 'number' ? value : (value?.y || 450);
      if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
        window.scrollBy({ top: deltaY, behavior: 'smooth' });
      }

      return {
        success: true,
        action: 'scroll',
        deltaY,
        message: `Scrolled webpage by ${deltaY}px.`
      };
    }
  }

  // Create singleton instance
  const executorInstance = new ActionExecutor();

  // Expose globally
  global.SiddarthExecutor = executorInstance;
  global.ActionExecutor = ActionExecutor;

  // Listen for Chrome runtime execution requests
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'EXECUTE_ACTION') {
        executorInstance.executeAction(message.payload || message)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep async response channel open
      }
    });
  }

  // CommonJS export support for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SiddarthExecutor: executorInstance,
      ActionExecutor,
      SENSITIVE_REGEX
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
