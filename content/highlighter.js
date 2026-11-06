/**
 * Siddarth Element Visual Highlighter Subsystem
 * Slice 11: Structured Element Selection ("Find It for Me")
 * 
 * - Draws prominent pulsing focus rings around targeted elements (.siddarth-highlight-active).
 * - Projects floating callout pointer tooltip (#siddarth-highlighter-pointer) with target #ID and reasoning.
 * - Smoothly scrolls the target element into the center of the viewport.
 * - Dynamically synchronizes pointer coordinates on window scroll and resize.
 * - Non-intrusive: pointer-events: none ensures page controls remain fully clickable.
 */

(function (global) {
  'use strict';

  const HIGHLIGHT_CLASS = 'siddarth-highlight-active';
  const POINTER_ID = 'siddarth-highlighter-pointer';

  class ElementHighlighter {
    constructor() {
      this.activeElement = null;
      this.pointerElement = null;
      this.activeTargetId = null;
      this.rafId = null;
      this.boundSync = this.syncPointerPosition.bind(this);
      this.listenersBound = false;
    }

    /**
     * Resolves DOM element reference by target ID
     * Checks internal map (window.__siddarthElements), then data attribute fallback
     * @param {number|string} targetId
     * @returns {HTMLElement|null}
     */
    resolveElement(targetId) {
      if (!targetId) return null;
      const numId = parseInt(targetId, 10);

      // Check global elements map
      if (typeof window !== 'undefined' && window.__siddarthElements instanceof Map) {
        const fromMap = window.__siddarthElements.get(numId);
        if (fromMap && fromMap.isConnected) return fromMap;
      }

      // Check scanner instance
      if (typeof globalThis.SiddarthScanner?.elementMap?.get === 'function') {
        const fromScanner = globalThis.SiddarthScanner.elementMap.get(numId);
        if (fromScanner && fromScanner.isConnected) return fromScanner;
      }

      // Fallback: search DOM by data-siddarth-id attribute
      if (typeof document !== 'undefined') {
        const byAttr = document.querySelector(`[data-siddarth-id="${numId}"]`);
        if (byAttr) return byAttr;
      }

      return null;
    }

    /**
     * Visually highlights target element, creates floating callout pointer, and scrolls into view
     * @param {number|string} targetId
     * @param {object} options
     * @returns {{success: boolean, targetId: number, element?: HTMLElement, error?: string}}
     */
    highlightElement(targetId, options = {}) {
      this.clearHighlight();

      const numId = parseInt(targetId, 10);
      const el = this.resolveElement(numId);

      if (!el) {
        return {
          success: false,
          targetId: numId,
          error: `Element #${numId} could not be found in active page DOM.`
        };
      }

      this.activeElement = el;
      this.activeTargetId = numId;

      // Add prominent pulsing outline class
      el.classList.add(HIGHLIGHT_CLASS);

      // Scroll smoothly to center of viewport
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView?.();
      }

      // Create floating callout pointer tooltip
      const reason = options.reason || options.label || 'Target match';
      this.renderPointerTooltip(el, numId, reason);

      // Bind dynamic repositioning on scroll/resize
      this.bindPositionListeners();

      return {
        success: true,
        targetId: numId,
        element: el
      };
    }

    /**
     * Creates or updates the floating pointer tooltip above the target element
     * @param {HTMLElement} el
     * @param {number} targetId
     * @param {string} reason
     */
    renderPointerTooltip(el, targetId, reason = '') {
      if (typeof document === 'undefined') return;

      this.removePointerElement();

      const pointer = document.createElement('div');
      pointer.id = POINTER_ID;
      pointer.setAttribute('aria-hidden', 'true');

      // Truncate reasoning text cleanly
      const displayText = reason.length > 55 ? reason.slice(0, 52) + '...' : reason;

      pointer.innerHTML = `
        <span class="pointer-target-icon">🎯</span>
        <span class="pointer-target-id">#${targetId}</span>
        <span class="pointer-target-reason">${this.escapeHtml(displayText)}</span>
      `;

      if (document.body) {
        document.body.appendChild(pointer);
      } else if (document.documentElement) {
        document.documentElement.appendChild(pointer);
      }

      this.pointerElement = pointer;
      this.syncPointerPosition();
    }

    /**
     * Synchronizes pointer tooltip coordinates with element bounding client rect
     */
    syncPointerPosition() {
      if (!this.pointerElement || !this.activeElement || !this.activeElement.isConnected) {
        return;
      }

      const rect = this.activeElement.getBoundingClientRect();
      const scrollX = typeof window !== 'undefined' ? (window.scrollX || window.pageXOffset || 0) : 0;
      const scrollY = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;

      // Position pointer right above the element
      const top = Math.round(rect.top + scrollY - 38);
      const left = Math.round(rect.left + scrollX);

      this.pointerElement.style.top = `${Math.max(0, top)}px`;
      this.pointerElement.style.left = `${Math.max(0, left)}px`;
    }

    /**
     * Clears active visual highlights and removes floating pointer tooltip
     */
    clearHighlight() {
      // Remove outline class from all elements
      if (typeof document !== 'undefined') {
        const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
        highlighted.forEach(el => el.classList.remove(HIGHLIGHT_CLASS));
      }

      this.removePointerElement();
      if (typeof this.unbindPositionListeners === 'function') {
        this.unbindPositionListeners();
      }

      this.activeElement = null;
      this.activeTargetId = null;

      return { success: true };
    }

    /**
     * Removes the pointer tooltip element from DOM
     */
    removePointerElement() {
      if (this.pointerElement && this.pointerElement.parentNode) {
        this.pointerElement.parentNode.removeChild(this.pointerElement);
      }
      if (typeof document !== 'undefined') {
        const existing = document.getElementById(POINTER_ID);
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      }
      this.pointerElement = null;
    }

    bindPositionListeners() {
      if (this.listenersBound || typeof window === 'undefined') return;

      const onScrollOrResize = () => {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
          this.syncPointerPosition();
          this.rafId = null;
        });
      };

      window.addEventListener('scroll', onScrollOrResize, { passive: true });
      window.addEventListener('resize', onScrollOrResize, { passive: true });

      this.listenersBound = true;
      this.unbindPositionListeners = () => {
        window.removeEventListener('scroll', onScrollOrResize);
        window.removeEventListener('resize', onScrollOrResize);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.listenersBound = false;
      };
    }

    escapeHtml(str = '') {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  // Create singleton instance
  const highlighterInstance = new ElementHighlighter();

  // Expose globally
  global.SiddarthHighlighter = highlighterInstance;
  global.ElementHighlighter = ElementHighlighter;

  // Listen for Chrome runtime messages
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'HIGHLIGHT_ELEMENT') {
        const result = highlighterInstance.highlightElement(message.targetId || message.id, {
          reason: message.reason,
          label: message.label
        });
        sendResponse(result);
        return true;
      }

      if (message.type === 'CLEAR_HIGHLIGHT') {
        const result = highlighterInstance.clearHighlight();
        sendResponse(result);
        return true;
      }
    });
  }

  // CommonJS export support for tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SiddarthHighlighter: highlighterInstance,
      ElementHighlighter
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
