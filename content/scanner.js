/**
 * Siddarth Interactive DOM Element Scanner & Badging Subsystem
 * Slice 10: Non-intrusive DOM Scanner & Visual Badge Overlay
 * 
 * - Traverses DOM for visible interactive elements (buttons, inputs, links, selects, textareas).
 * - Filters out non-rendered/invisible nodes using computed styles & getBoundingClientRect.
 * - Sorts elements into natural reading order (Y top-to-bottom, then X left-to-right).
 * - Assigns sequential 1-based IDs (#1 to #N).
 * - Injects a non-intrusive absolute badge overlay with pointer-events: none.
 * - Dynamically synchronizes badge coordinates on window scroll and resize.
 * - Supports highlighting, querying, and clearing badges.
 */

(function (global) {
  'use strict';

  const OVERLAY_ID = 'siddarth-badge-overlay';
  const BADGE_CLASS = 'siddarth-element-badge';
  const HIGHLIGHT_CLASS = 'siddarth-highlight-active';

  // Candidate interactive selectors (Architecture Section 6.1)
  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]:not([aria-disabled="true"])',
    '[role="checkbox"]:not([aria-disabled="true"])',
    '[role="radio"]:not([aria-disabled="true"])',
    '[role="combobox"]:not([aria-disabled="true"])',
    '[role="listbox"]:not([aria-disabled="true"])',
    '[role="menuitem"]:not([aria-disabled="true"])',
    '[role="tab"]:not([aria-disabled="true"])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(',');

  // Consequential action keywords requiring high-visibility warning badges
  const CONSEQUENTIAL_REGEX = /submit|buy|order|pay|transfer|delete|remove|send|confirm|checkout|purchase/i;

  class DOMScanner {
    constructor() {
      this.overlayElement = null;
      this.elementMap = new Map(); // Map<number, HTMLElement>
      this.scannedMetadata = [];   // Array<ElementMetadata>
      this.scrollListenerBound = false;
      this.rafId = null;
      this.boundSync = this.syncBadgePositions.bind(this);
    }

    /**
     * Checks if an element is strictly visible and actionable on the webpage
     * (Architecture Section 6.2 & Edge Cases Section 4)
     * @param {Element} el
     * @returns {boolean}
     */
    isElementVisible(el) {
      if (!el) return false;
      if (typeof el.isConnected === 'boolean' && !el.isConnected) return false;

      // Filter non-visual tags
      const tagName = el.tagName ? el.tagName.toLowerCase() : '';
      if (['script', 'style', 'noscript', 'template', 'svg', 'path', 'meta', 'link'].includes(tagName)) {
        return false;
      }

      // Computed style check
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try {
          const style = window.getComputedStyle(el);
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
          if (parseFloat(style.opacity || '1') <= 0.05) return false;
        } catch {
          // If style computation fails, proceed with geometry check
        }
      }

      // Check geometry bounds
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.width < 3 || rect.height < 3) return false;

        // Skip nodes positioned extremely off-canvas (e.g. -9999px)
        if (rect.bottom < -1000 || rect.right < -1000) return false;
      }

      return true;
    }

    /**
     * Extracts an informative, human-readable label or description for the element
     * @param {Element} el
     * @param {string} role
     * @returns {string}
     */
    extractLabel(el, role = '') {
      if (!el) return '';

      // 1. Explicit ARIA label
      const ariaLabel = el.getAttribute?.('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      // 2. ARIA labelledby reference
      const labelledBy = el.getAttribute?.('aria-labelledby');
      if (labelledBy && typeof document !== 'undefined') {
        const refEl = document.getElementById(labelledBy.trim());
        if (refEl && (refEl.innerText || refEl.textContent)) {
          const refText = (refEl.innerText || refEl.textContent).trim();
          if (refText) return refText;
        }
      }

      // 3. Associated HTML <label for="element-id">
      if (el.id && typeof document !== 'undefined') {
        try {
          const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (forLabel && (forLabel.innerText || forLabel.textContent)) {
            const labelText = (forLabel.innerText || forLabel.textContent).trim();
            if (labelText) return labelText;
          }
        } catch {}
      }

      // 4. Wrapping <label> parent
      if (typeof el.closest === 'function') {
        const parentLabel = el.closest('label');
        if (parentLabel && (parentLabel.innerText || parentLabel.textContent)) {
          const clone = parentLabel.cloneNode(true);
          // Remove the input itself from the clone to avoid duplicated text
          const innerInput = clone.querySelector('input, select, textarea');
          if (innerInput) innerInput.remove();
          const cleanText = (clone.innerText || clone.textContent || '').trim();
          if (cleanText) return cleanText;
        }
      }

      // 5. Placeholder
      const placeholder = el.getAttribute?.('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      // 6. Title attribute
      const title = el.getAttribute?.('title');
      if (title && title.trim()) return title.trim();

      // 7. Value attribute for buttons/submit inputs
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type?.toLowerCase())) {
        if (el.value && el.value.trim()) return el.value.trim();
      }

      // 8. Inner text / textContent for buttons, links, tabs
      if (['button', 'a'].includes(tag) || role.includes('button') || role.includes('link') || role.includes('tab')) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) {
          // Collapse multiple whitespaces and truncate
          return text.replace(/\s+/g, ' ').slice(0, 70);
        }
      }

      // 9. Input name attribute as clean fallback
      const name = el.getAttribute?.('name');
      if (name && name.trim()) {
        return name.replace(/[-_]/g, ' ').trim();
      }

      // 10. Heading or label preceding the element in a form-group container
      if (typeof el.closest === 'function') {
        const formGroup = el.closest('.form-group, .form-row, .field, .input-group, div');
        if (formGroup) {
          const prevLabel = formGroup.querySelector('label, .label, span.title');
          if (prevLabel && (prevLabel.innerText || prevLabel.textContent)) {
            const text = (prevLabel.innerText || prevLabel.textContent).trim();
            if (text && text.length < 50) return text;
          }
        }
      }

      return '';
    }

    /**
     * Determines the functional role of the interactive element
     * @param {Element} el
     * @returns {string}
     */
    determineRole(el) {
      const tag = (el.tagName || '').toLowerCase();
      const explicitRole = el.getAttribute?.('role');

      if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (type === 'submit') return 'submit_button';
        if (type === 'button') return 'button';
        return `input_${type}`;
      }

      if (tag === 'button') {
        return (el.type === 'submit') ? 'submit_button' : 'button';
      }

      if (tag === 'select') return 'select';
      if (tag === 'textarea') return 'textarea';
      if (tag === 'a') return 'link';

      if (explicitRole) {
        return explicitRole.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }

      if (el.getAttribute?.('contenteditable') === 'true') {
        return 'contenteditable';
      }

      return tag || 'element';
    }

    /**
     * Detects if an element triggers a consequential action
     * (Architecture Section 5.3 & 6.4)
     * @param {Element} el
     * @param {string} role
     * @param {string} text
     * @returns {boolean}
     */
    isConsequential(el, role = '', text = '') {
      if (role === 'submit_button') return true;
      if (el.type === 'submit') return true;

      const combined = [
        text,
        el.id || '',
        el.getAttribute?.('name') || '',
        el.className || '',
        el.getAttribute?.('aria-label') || ''
      ].join(' ');

      return CONSEQUENTIAL_REGEX.test(combined);
    }

    /**
     * Generates a stable CSS selector path for the element
     * @param {Element} el
     * @returns {string}
     */
    generateSelector(el) {
      if (!el || !el.tagName) return '';
      if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
        return `#${el.id}`;
      }

      const tag = el.tagName.toLowerCase();
      if (el.name) {
        return `${tag}[name="${el.name}"]`;
      }

      const parent = el.parentElement;
      if (!parent) return tag;

      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return `${tag}:nth-of-type(${index})`;
      }

      return tag;
    }

    /**
     * Scans the DOM, extracts interactive elements, and sorts them in natural reading order
     * @returns {Array<object>}
     */
    scanElements() {
      if (typeof document === 'undefined') return [];

      this.elementMap.clear();
      this.scannedMetadata = [];

      // Query candidate nodes
      const allCandidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS));

      // Filter visible elements
      const visibleCandidates = allCandidates.filter(el => this.isElementVisible(el));

      // Deduplicate nested interactive elements (prefer outermost container, e.g. <button> over inner <span role="button">)
      const filteredElements = [];
      for (const el of visibleCandidates) {
        const hasInteractiveParent = filteredElements.some(parent => parent.contains(el));
        if (!hasInteractiveParent) {
          filteredElements.push(el);
        }
      }

      // Collect bounding client rects and compute reading coordinates
      const elementItems = filteredElements.map(el => {
        const rect = el.getBoundingClientRect();
        const scrollX = typeof window !== 'undefined' ? (window.scrollX || window.pageXOffset || 0) : 0;
        const scrollY = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;

        return {
          el,
          rect: {
            top: rect.top,
            left: rect.left,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            docTop: Math.round(rect.top + scrollY),
            docLeft: Math.round(rect.left + scrollX)
          }
        };
      });

      // Natural reading order sorting:
      // Group elements into horizontal rows within ~12px vertical threshold, sort rows top-to-bottom, then left-to-right
      elementItems.sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 12) {
          return yDiff;
        }
        return a.rect.left - b.rect.left;
      });

      // Assign sequential 1-based IDs (#1 to #N) and compile metadata
      const results = [];
      elementItems.forEach((item, index) => {
        const id = index + 1;
        const el = item.el;
        const tag = (el.tagName || '').toLowerCase();
        const role = this.determineRole(el);
        const label = this.extractLabel(el, role);
        const consequential = this.isConsequential(el, role, label);
        const selector = this.generateSelector(el);

        // Tag DOM element with data attribute for fast lookup
        el.setAttribute?.('data-siddarth-id', String(id));

        // Cache reference
        this.elementMap.set(id, el);

        const meta = {
          id,
          tag,
          role,
          label: label || `[${role}]`,
          placeholder: el.getAttribute?.('placeholder') || '',
          name: el.getAttribute?.('name') || '',
          value: typeof el.value === 'string' ? el.value.trim() : '',
          type: el.type || '',
          isConsequential: consequential,
          selector,
          rect: item.rect
        };

        results.push(meta);
      });

      this.scannedMetadata = results;

      // Expose to window for global runtime access
      if (typeof window !== 'undefined') {
        window.__siddarthElements = this.elementMap;
        window.__siddarthScannedMetadata = results;
      }

      return results;
    }

    /**
     * Renders floating numbered badges on the top-level overlay
     * @param {Array<object>} elements
     * @returns {HTMLElement}
     */
    renderBadges(elements = null) {
      if (typeof document === 'undefined') return null;

      const items = elements || this.scannedMetadata;
      if (!items || items.length === 0) {
        this.clearBadges();
        return null;
      }

      // Remove existing overlay if any
      this.removeOverlayElement();

      // Create new top-level non-intrusive overlay container
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');

      // Set document height coverage
      const docHeight = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        typeof window !== 'undefined' ? window.innerHeight : 0
      );
      overlay.style.height = `${docHeight}px`;

      // Keep track of placed badge positions to apply staggered micro-offsets for dense layouts
      const placedBadges = [];

      items.forEach(item => {
        const el = this.elementMap.get(item.id);
        if (!el || !this.isElementVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const scrollX = typeof window !== 'undefined' ? (window.scrollX || window.pageXOffset || 0) : 0;
        const scrollY = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;

        let badgeTop = Math.round(rect.top + scrollY);
        let badgeLeft = Math.round(rect.left + scrollX);

        // Micro-offset for dense clusters (Edge Cases Section 4)
        for (const prev of placedBadges) {
          const distY = Math.abs(badgeTop - prev.top);
          const distX = Math.abs(badgeLeft - prev.left);
          if (distY < 14 && distX < 18) {
            badgeTop -= 4;
            badgeLeft += 10;
          }
        }
        placedBadges.push({ top: badgeTop, left: badgeLeft });

        // Create individual badge element
        const badge = document.createElement('div');
        badge.className = `${BADGE_CLASS} siddarth-badge-${item.role}`;
        if (item.isConsequential) {
          badge.classList.add('siddarth-badge-consequential');
        }

        badge.setAttribute('data-siddarth-badge-id', String(item.id));
        badge.textContent = String(item.id);
        badge.style.top = `${badgeTop}px`;
        badge.style.left = `${badgeLeft}px`;

        overlay.appendChild(badge);
      });

      // Append overlay to body (or documentElement)
      if (document.body) {
        document.body.appendChild(overlay);
      } else if (document.documentElement) {
        document.documentElement.appendChild(overlay);
      }

      this.overlayElement = overlay;

      // Bind dynamic repositioning on scroll and resize
      this.bindPositionListeners();

      return overlay;
    }

    /**
     * Executes both DOM scanning and badge rendering in one step
     * @returns {{success: boolean, count: number, elements: Array<object>}}
     */
    scanAndBadge() {
      const elements = this.scanElements();
      this.renderBadges(elements);
      return {
        success: true,
        count: elements.length,
        elements
      };
    }

    /**
     * Dynamically synchronizes badge coordinates on window scroll / resize
     */
    syncBadgePositions() {
      if (!this.overlayElement || typeof document === 'undefined') return;

      const scrollX = typeof window !== 'undefined' ? (window.scrollX || window.pageXOffset || 0) : 0;
      const scrollY = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;

      const badges = this.overlayElement.querySelectorAll(`.${BADGE_CLASS}`);
      badges.forEach(badge => {
        const idStr = badge.getAttribute('data-siddarth-badge-id');
        const id = parseInt(idStr, 10);
        const el = this.elementMap.get(id);

        if (!el || !this.isElementVisible(el)) {
          badge.style.display = 'none';
          return;
        }

        const rect = el.getBoundingClientRect();
        badge.style.display = 'inline-flex';
        badge.style.top = `${Math.round(rect.top + scrollY)}px`;
        badge.style.left = `${Math.round(rect.left + scrollX)}px`;
      });
    }

    /**
     * Binds scroll & resize listeners with requestAnimationFrame throttling
     */
    bindPositionListeners() {
      if (this.scrollListenerBound || typeof window === 'undefined') return;

      const onScrollOrResize = () => {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
          this.syncBadgePositions();
          this.rafId = null;
        });
      };

      window.addEventListener('scroll', onScrollOrResize, { passive: true });
      window.addEventListener('resize', onScrollOrResize, { passive: true });

      this.scrollListenerBound = true;
      this.unbindPositionListeners = () => {
        window.removeEventListener('scroll', onScrollOrResize);
        window.removeEventListener('resize', onScrollOrResize);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.scrollListenerBound = false;
      };
    }

    /**
     * Clears all rendered badges, highlights, and overlays from the page
     * @returns {{success: boolean}}
     */
    clearBadges() {
      this.removeOverlayElement();
      this.clearHighlights();

      if (this.unbindPositionListeners) {
        this.unbindPositionListeners();
      }

      this.elementMap.clear();
      this.scannedMetadata = [];

      if (typeof window !== 'undefined') {
        window.__siddarthElements = null;
        window.__siddarthScannedMetadata = [];
      }

      return { success: true };
    }

    /**
     * Removes the badge overlay container from the DOM
     */
    removeOverlayElement() {
      if (this.overlayElement && this.overlayElement.parentNode) {
        this.overlayElement.parentNode.removeChild(this.overlayElement);
      }
      if (typeof document !== 'undefined') {
        const existing = document.getElementById(OVERLAY_ID);
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      }
      this.overlayElement = null;
    }

    /**
     * Highlights a specific element by ID with a pulsing outline and scrolls to it
     * @param {number} id
     * @returns {{success: boolean, element?: object, error?: string}}
     */
    highlightElement(id) {
      this.clearHighlights();

      const el = this.elementMap.get(id);
      if (!el) {
        return { success: false, error: `Element #${id} not found in active element map.` };
      }

      el.classList.add(HIGHLIGHT_CLASS);
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView?.();
      }

      const meta = this.scannedMetadata.find(m => m.id === id);
      return { success: true, element: meta };
    }

    /**
     * Removes all active highlight rings from page elements
     */
    clearHighlights() {
      if (typeof document === 'undefined') return;
      const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
      highlighted.forEach(el => el.classList.remove(HIGHLIGHT_CLASS));
    }

    /**
     * Retrieves currently cached scanned elements
     * @returns {Array<object>}
     */
    getScannedElements() {
      return this.scannedMetadata;
    }

    /**
     * Produces a compact, token-efficient JSON serialization for LLM element selection
     * (Slice 11: Structured Element Selection / Architecture Section 6.4)
     * @returns {Array<object>}
     */
    getCompactElementMap() {
      if (!this.scannedMetadata || this.scannedMetadata.length === 0) {
        this.scanElements();
      }

      return this.scannedMetadata.map(item => {
        const compact = {
          id: item.id,
          tag: item.tag,
          role: item.role,
          label: item.label
        };

        if (item.placeholder) compact.placeholder = item.placeholder;
        if (item.name) compact.name = item.name;
        if (item.value) compact.value = item.value;
        if (item.type && item.type !== 'text') compact.type = item.type;
        if (item.isConsequential) compact.isConsequential = true;

        return compact;
      });
    }
  }

  // Create singleton scanner instance
  const scannerInstance = new DOMScanner();

  // Expose on global window object
  global.SiddarthScanner = scannerInstance;
  global.DOMScanner = DOMScanner;

  // Listen for runtime messages from Extension Side Panel & Service Worker
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SCAN_PAGE_ELEMENTS') {
        const result = scannerInstance.scanAndBadge();
        sendResponse(result);
        return true;
      }

      if (message.type === 'CLEAR_PAGE_BADGES') {
        const result = scannerInstance.clearBadges();
        sendResponse(result);
        return true;
      }

      if (message.type === 'HIGHLIGHT_ELEMENT') {
        const result = scannerInstance.highlightElement(message.id);
        sendResponse(result);
        return true;
      }

      if (message.type === 'GET_SCANNED_ELEMENTS') {
        sendResponse({
          success: true,
          count: scannerInstance.getScannedElements().length,
          elements: scannerInstance.getScannedElements()
        });
        return true;
      }

      if (message.type === 'GET_COMPACT_ELEMENT_MAP') {
        const compact = scannerInstance.getCompactElementMap();
        sendResponse({
          success: true,
          count: compact.length,
          elements: compact
        });
        return true;
      }
    });
  }

  // CommonJS export support for tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SiddarthScanner: scannerInstance,
      DOMScanner,
      INTERACTIVE_SELECTORS,
      CONSEQUENTIAL_REGEX
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);

