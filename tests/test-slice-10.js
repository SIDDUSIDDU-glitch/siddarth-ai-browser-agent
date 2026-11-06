/**
 * Verification Test Suite for Slice 10: Interactive Element Scanner & Visual Badge Overlay
 * 
 * Verifies:
 * 1. Candidate Interactive Element Discovery (Buttons, Inputs, Links, Selects, Textareas, ARIA roles)
 * 2. Strict Visibility and Occlusion Filtering (display: none, visibility: hidden, opacity: 0, 0-size rejected)
 * 3. Natural Reading Order Sorting (Y top-to-bottom, X left-to-right with row clustering)
 * 4. Human-Readable Label Extraction (aria-label, <label for>, parent <label>, placeholder, button text)
 * 5. Functional Role Determination and Compact Metadata Serialization
 * 6. Consequential Action Detection (Submit, Pay, Buy, Delete, Remove -> warning badge)
 * 7. Non-Intrusive Badge Overlay Generation (#siddarth-badge-overlay with pointer-events: none)
 * 8. Dynamic Coordinate Placement with Window Scroll Offsets
 * 9. Element Highlighting & Viewport Scrolling (siddarth-highlight-active)
 * 10. Badge Overlay Cleanup (clearBadges)
 * 11. Content Script Message Dispatching (SCAN_PAGE_ELEMENTS, CLEAR_PAGE_BADGES, HIGHLIGHT_ELEMENT)
 * 12. AgentTab Side Panel Controller Integration (Scanning flow, breakdown counts, role filtering)
 */

import assert from 'node:assert';
import '../content/scanner.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';

// Setup Mock DOM Element Class for Node.js Testing
class MockElement {
  constructor(tagName = 'div', attributes = {}, text = '', rect = { top: 0, left: 0, width: 100, height: 30 }) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.id = attributes.id || '';
    this.type = attributes.type || '';
    this.name = attributes.name || '';
    this.value = attributes.value || '';
    this.placeholder = attributes.placeholder || '';
    this.title = attributes.title || '';
    this.textContent = text;
    this.innerText = text;
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.style = {
      display: attributes['data-display'] || 'block',
      visibility: attributes['data-visibility'] || 'visible',
      opacity: attributes['data-opacity'] || '1'
    };
    this._rect = { ...rect };
    const initialClasses = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      _classes: initialClasses,
      add: (cls) => initialClasses.add(cls),
      remove: (cls) => initialClasses.delete(cls),
      contains: (cls) => initialClasses.has(cls)
    };
  }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }

  set className(val) {
    this.classList._classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }

  get innerHTML() {
    return this.children.map(c => c.textContent).join('');
  }

  set innerHTML(val) {
    if (val === '') {
      this.children = [];
    }
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return Array.from(this.classList._classes).join(' ') || null;
    if (name === 'type') return this.type || null;
    if (name === 'name') return this.name || null;
    if (name === 'placeholder') return this.placeholder || null;
    if (name === 'title') return this.title || null;
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'class') {
      this.className = String(val);
      this.classList._classes = new Set(String(val).split(/\s+/).filter(Boolean));
    }
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'id') this.id = '';
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  get isConnected() {
    if (this._disconnected) return false;
    let curr = this;
    while (curr.parentNode) {
      curr = curr.parentNode;
    }
    return curr.tagName === 'BODY' || curr.tagName === 'HTML' || curr === globalThis.document || curr === this;
  }

  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
    }
    return child;
  }

  contains(other) {
    if (!other) return false;
    if (other === this) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector === 'label' && curr.tagName === 'LABEL') return curr;
      if (selector.includes('.form-group') && curr.classList.contains('form-group')) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(sel) {
    for (const child of this.children) {
      if (sel.includes('input') && child.tagName === 'INPUT') return child;
      if (sel.includes('label') && child.tagName === 'LABEL') return child;
      const sub = child.querySelector(sel);
      if (sub) return sub;
    }
    return null;
  }

  querySelectorAll(sel) {
    const list = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.matchesSelector(sel)) list.push(c);
        walk(c);
      }
    };
    walk(this);
    return list;
  }

  matchesSelector(sel) {
    const tag = this.tagName.toLowerCase();
    if (sel.includes('a[href]') && tag === 'a' && this.attributes.href) return true;
    if (sel.includes('button') && tag === 'button') {
      if (sel.includes(':not([disabled])') && this.attributes.disabled) return false;
      return true;
    }
    if (sel.includes('input') && tag === 'input') {
      if (this.type === 'hidden') return false;
      if (sel.includes(':not([disabled])') && this.attributes.disabled) return false;
      return true;
    }
    if (sel.includes('select') && tag === 'select') return true;
    if (sel.includes('textarea') && tag === 'textarea') return true;
    if (sel.includes('[role="button"]') && this.attributes.role === 'button') return true;
    if (sel.includes('[role="link"]') && this.attributes.role === 'link') return true;
    if (sel.includes('[role="checkbox"]') && this.attributes.role === 'checkbox') return true;
    if (sel.includes('[tabindex]') && this.attributes.tabindex && this.attributes.tabindex !== '-1') return true;
    if (sel.startsWith('.') && this.classList.contains(sel.slice(1))) return true;
    if (sel.includes('.siddarth-badge-overlay') && this.id === 'siddarth-badge-overlay') return true;
    if (sel.includes('.siddarth-element-badge') && this.classList.contains('siddarth-element-badge')) return true;
    if (sel.includes('.siddarth-highlight-active') && this.classList.contains('siddarth-highlight-active')) return true;
    return false;
  }

  cloneNode() {
    const clone = new MockElement(this.tagName, { ...this.attributes }, this.textContent, this._rect);
    this.children.forEach(c => clone.appendChild(c.cloneNode()));
    return clone;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  scrollIntoView() {
    this._scrolledIntoView = true;
  }

  addEventListener(type, listener) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    if (!this._listeners || !this._listeners[type]) return;
    const idx = this._listeners[type].indexOf(listener);
    if (idx !== -1) this._listeners[type].splice(idx, 1);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    if (this._listeners && this._listeners[type]) {
      this._listeners[type].forEach(fn => fn(event));
    }
  }
}

// Setup Document & Window Mocks
const mockBody = new MockElement('body');
const mockDoc = {
  body: mockBody,
  documentElement: new MockElement('html'),
  getElementById: (id) => {
    const walk = (node) => {
      if (node.id === id) return node;
      for (const c of node.children) {
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(mockDoc.body);
  },
  createElement: (tag) => new MockElement(tag),
  querySelector: (sel) => {
    if (sel.startsWith('label[for="')) {
      const match = sel.match(/label\[for="([^"]+)"\]/);
      if (match) {
        const forId = match[1];
        const walk = (node) => {
          if (node.tagName === 'LABEL' && node.attributes.for === forId) return node;
          for (const c of node.children) {
            const found = walk(c);
            if (found) return found;
          }
          return null;
        };
        return walk(mockDoc.body);
      }
    }
    return mockDoc.body.querySelector(sel);
  },
  querySelectorAll: (sel) => mockDoc.body.querySelectorAll(sel)
};

globalThis.document = mockDoc;
globalThis.window = {
  scrollX: 0,
  scrollY: 100,
  pageXOffset: 0,
  pageYOffset: 100,
  innerHeight: 800,
  innerWidth: 1200,
  getComputedStyle: (el) => el.style || { display: 'block', visibility: 'visible', opacity: '1' },
  addEventListener: () => {},
  removeEventListener: () => {}
};
globalThis.CSS = { escape: (s) => s };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

async function runTests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 10 (Scanner & Badging)');
  console.log('========================================================\n');

  const scanner = globalThis.SiddarthScanner;
  assert(scanner, 'SiddarthScanner must be defined on globalThis');

  // ----------------------------------------------------
  // TEST 1: Visibility & Occlusion Filters
  // ----------------------------------------------------
  console.log('Test 1: Verify strict visibility & occlusion filtering...');
  {
    // Visible input
    const visibleInput = new MockElement('input', { type: 'text' }, '', { top: 100, left: 50, width: 200, height: 35 });
    assert(scanner.isElementVisible(visibleInput), 'Standard rendered input should be visible');

    // Display: none
    const displayNone = new MockElement('button', { 'data-display': 'none' }, 'Click', { top: 100, left: 50, width: 100, height: 30 });
    assert(!scanner.isElementVisible(displayNone), 'display:none elements must be excluded');

    // Visibility: hidden
    const visHidden = new MockElement('button', { 'data-visibility': 'hidden' }, 'Click', { top: 100, left: 50, width: 100, height: 30 });
    assert(!scanner.isElementVisible(visHidden), 'visibility:hidden elements must be excluded');

    // Opacity: 0
    const opacityZero = new MockElement('button', { 'data-opacity': '0' }, 'Click', { top: 100, left: 50, width: 100, height: 30 });
    assert(!scanner.isElementVisible(opacityZero), 'Zero opacity elements must be excluded');

    // Zero width/height
    const zeroSize = new MockElement('button', {}, 'Click', { top: 100, left: 50, width: 0, height: 0 });
    assert(!scanner.isElementVisible(zeroSize), 'Zero width/height elements must be excluded');

    // Tiny 1px tracker
    const tinyPixel = new MockElement('a', { href: '#' }, 'Tracker', { top: 10, left: 10, width: 1, height: 1 });
    assert(!scanner.isElementVisible(tinyPixel), 'Sub-3px invisible tracker elements must be excluded');

    console.log('✓ Strict visibility filtering successfully eliminates non-rendered and zero-sized nodes.\n');
  }

  // ----------------------------------------------------
  // TEST 2: Candidate Interactive Elements & Natural Reading Order
  // ----------------------------------------------------
  console.log('Test 2: Verify candidate discovery & natural reading order sorting...');
  {
    mockDoc.body.children = [];

    // Create a mock page layout:
    // Header Row (top: 20px): Nav Link (left: 50), Nav Button (left: 200)
    // Form Row 1 (top: 100px): First Name (left: 50), Last Name (left: 300)
    // Form Row 2 (top: 160px): Email Input (left: 50)
    // Form Row 3 (top: 220px): Submit Button (left: 50)
    // Hidden Input: csrf_token (top: 0, left: 0)

    const csrf = new MockElement('input', { type: 'hidden', name: 'csrf', value: '123' }, '', { top: 0, left: 0, width: 0, height: 0 });
    mockDoc.body.appendChild(csrf);

    // Header elements (Y: ~20px)
    const navLink = new MockElement('a', { href: '#home', id: 'nav-home' }, 'Home', { top: 20, left: 50, width: 60, height: 20 });
    const navBtn = new MockElement('button', { id: 'nav-btn' }, 'Login', { top: 22, left: 200, width: 80, height: 25 });
    mockDoc.body.appendChild(navLink);
    mockDoc.body.appendChild(navBtn);

    // Row 1 (Y: ~100px) - Shuffled insertion order to test sorting
    const lastName = new MockElement('input', { type: 'text', id: 'last-name', placeholder: 'Last Name' }, '', { top: 100, left: 300, width: 180, height: 35 });
    const firstName = new MockElement('input', { type: 'text', id: 'first-name', placeholder: 'First Name' }, '', { top: 102, left: 50, width: 180, height: 35 });
    mockDoc.body.appendChild(lastName);
    mockDoc.body.appendChild(firstName);

    // Row 2 (Y: ~160px)
    const email = new MockElement('input', { type: 'email', id: 'email', placeholder: 'Email Address' }, '', { top: 160, left: 50, width: 400, height: 35 });
    mockDoc.body.appendChild(email);

    // Row 3 (Y: ~220px)
    const submitBtn = new MockElement('button', { type: 'submit', id: 'btn-submit' }, 'Submit Application', { top: 220, left: 50, width: 160, height: 40 });
    mockDoc.body.appendChild(submitBtn);

    // Scan
    const scanned = scanner.scanElements();
    assert.strictEqual(scanned.length, 6, 'Should find exactly 6 visible interactive elements (csrf excluded)');

    // Verify natural reading order
    assert.strictEqual(scanned[0].id, 1);
    assert.strictEqual(scanned[0].tag, 'a');
    assert.strictEqual(scanned[0].label, 'Home');

    assert.strictEqual(scanned[1].id, 2);
    assert.strictEqual(scanned[1].tag, 'button');
    assert.strictEqual(scanned[1].label, 'Login');

    // First name (left: 50) must precede last name (left: 300) in same horizontal band
    assert.strictEqual(scanned[2].id, 3);
    assert.strictEqual(scanned[2].placeholder, 'First Name');

    assert.strictEqual(scanned[3].id, 4);
    assert.strictEqual(scanned[3].placeholder, 'Last Name');

    assert.strictEqual(scanned[4].id, 5);
    assert.strictEqual(scanned[4].placeholder, 'Email Address');

    assert.strictEqual(scanned[5].id, 6);
    assert.strictEqual(scanned[5].tag, 'button');
    assert.strictEqual(scanned[5].label, 'Submit Application');

    console.log('✓ Discovered all candidate interactive elements and sorted in natural reading order.\n');
  }

  // ----------------------------------------------------
  // TEST 3: Label and Descriptor Extraction
  // ----------------------------------------------------
  console.log('Test 3: Verify diverse label extraction mechanisms...');
  {
    mockDoc.body.children = [];

    // Case A: <label for="phone-input">
    const labelForPhone = new MockElement('label', { for: 'phone-input' }, 'Mobile Phone Number');
    const phoneInput = new MockElement('input', { type: 'tel', id: 'phone-input' }, '', { top: 10, left: 10, width: 100, height: 30 });
    mockDoc.body.appendChild(labelForPhone);
    mockDoc.body.appendChild(phoneInput);

    // Case B: Wrapping <label>
    const wrappingLabel = new MockElement('label', {}, 'Agree to Terms');
    const checkInput = new MockElement('input', { type: 'checkbox', id: 'agree-check' }, '', { top: 50, left: 10, width: 20, height: 20 });
    wrappingLabel.appendChild(checkInput);
    mockDoc.body.appendChild(wrappingLabel);

    // Case C: aria-label
    const searchInput = new MockElement('input', { type: 'search', 'aria-label': 'Search Documentation' }, '', { top: 90, left: 10, width: 150, height: 30 });
    mockDoc.body.appendChild(searchInput);

    // Case D: Submit button value
    const inputSubmit = new MockElement('input', { type: 'submit', value: 'Pay Now ($49)' }, '', { top: 130, left: 10, width: 120, height: 35 });
    mockDoc.body.appendChild(inputSubmit);

    const scanned = scanner.scanElements();
    assert.strictEqual(scanned.length, 4);

    assert.strictEqual(scanned[0].label, 'Mobile Phone Number', 'Should extract label via for="id" association');
    assert.strictEqual(scanned[1].label, 'Agree to Terms', 'Should extract label via wrapping <label>');
    assert.strictEqual(scanned[2].label, 'Search Documentation', 'Should extract aria-label attribute');
    assert.strictEqual(scanned[3].label, 'Pay Now ($49)', 'Should extract value attribute for submit inputs');

    console.log('✓ Label extraction accurately parses for-labels, wrapping labels, aria-labels, and values.\n');
  }

  // ----------------------------------------------------
  // TEST 4: Consequential Action Detection
  // ----------------------------------------------------
  console.log('Test 4: Verify consequential action classification...');
  {
    mockDoc.body.children = [];

    const safeBtn = new MockElement('button', {}, 'Previous Page', { top: 10, left: 10, width: 100, height: 30 });
    const deleteBtn = new MockElement('button', { class: 'btn-danger' }, 'Delete Account', { top: 50, left: 10, width: 100, height: 30 });
    const orderBtn = new MockElement('button', {}, 'Place Order Now', { top: 90, left: 10, width: 100, height: 30 });
    const submitBtn = new MockElement('button', { type: 'submit' }, 'Send Application', { top: 130, left: 10, width: 100, height: 30 });

    mockDoc.body.appendChild(safeBtn);
    mockDoc.body.appendChild(deleteBtn);
    mockDoc.body.appendChild(orderBtn);
    mockDoc.body.appendChild(submitBtn);

    const scanned = scanner.scanElements();
    assert.strictEqual(scanned[0].isConsequential, false, '"Previous Page" should not be consequential');
    assert.strictEqual(scanned[1].isConsequential, true, '"Delete Account" must trigger consequential action warning');
    assert.strictEqual(scanned[2].isConsequential, true, '"Place Order Now" must trigger consequential action warning');
    assert.strictEqual(scanned[3].isConsequential, true, 'Submit button must trigger consequential action warning');

    console.log('✓ Consequential actions correctly detected for deletion, payments, and form submission.\n');
  }

  // ----------------------------------------------------
  // TEST 5: Non-Intrusive Badge Overlay DOM Injection
  // ----------------------------------------------------
  console.log('Test 5: Verify non-intrusive badge overlay creation and coordinate calculation...');
  {
    mockDoc.body.children = [];

    // window.scrollY is mocked at 100
    globalThis.window.scrollY = 100;
    globalThis.window.scrollX = 20;

    const btn1 = new MockElement('button', { id: 'btn-test-1' }, 'Search', { top: 50, left: 40, width: 80, height: 30 });
    const btn2 = new MockElement('button', { type: 'submit', id: 'btn-delete' }, 'Delete Item', { top: 120, left: 40, width: 100, height: 30 });

    mockDoc.body.appendChild(btn1);
    mockDoc.body.appendChild(btn2);

    const overlay = scanner.renderBadges(scanner.scanElements());
    assert(overlay, 'renderBadges must return overlay container');
    assert.strictEqual(overlay.id, 'siddarth-badge-overlay', 'Overlay container must have id #siddarth-badge-overlay');

    // Verify badges created inside overlay
    const badges = overlay.children;
    assert.strictEqual(badges.length, 2, 'Should create 2 badge elements');

    // Check Badge 1
    const b1 = badges[0];
    assert.strictEqual(b1.textContent, '1', 'Badge 1 must display sequential ID "1"');
    assert(b1.classList.contains('siddarth-element-badge'), 'Must have base badge class');
    assert.strictEqual(b1.getAttribute('data-siddarth-badge-id'), '1');
    // Top coordinate = rect.top (50) + scrollY (100) = 150px
    // Left coordinate = rect.left (40) + scrollX (20) = 60px
    assert.strictEqual(b1.style.top, '150px', 'Badge 1 top coordinate must sync with scroll position');
    assert.strictEqual(b1.style.left, '60px', 'Badge 1 left coordinate must sync with scroll position');

    // Check Badge 2 (Consequential)
    const b2 = badges[1];
    assert.strictEqual(b2.textContent, '2');
    assert(b2.classList.contains('siddarth-badge-consequential'), 'Delete badge must have consequential warning class');

    console.log('✓ Badge overlay properly rendered with scroll offsets and role warning styles.\n');
  }

  // ----------------------------------------------------
  // TEST 6: Element Highlighting and Scrolling
  // ----------------------------------------------------
  console.log('Test 6: Verify highlightElement adds pulsing outline and scrolls into view...');
  {
    const res = scanner.highlightElement(1);
    assert(res.success, 'highlightElement should succeed');

    const targetEl = scanner.elementMap.get(1);
    assert(targetEl.classList.contains('siddarth-highlight-active'), 'Highlighted element must receive active outline class');
    assert(targetEl._scrolledIntoView, 'Highlighted element must execute scrollIntoView');

    // Highlighting another element removes highlight from first
    scanner.highlightElement(2);
    assert(!targetEl.classList.contains('siddarth-highlight-active'), 'Previous highlight must be removed');
    const target2 = scanner.elementMap.get(2);
    assert(target2.classList.contains('siddarth-highlight-active'), 'New target must have active outline class');

    console.log('✓ Element highlighting applies pulsing focus and removes previous highlights cleanly.\n');
  }

  // ----------------------------------------------------
  // TEST 7: Overlay Cleanup (clearBadges)
  // ----------------------------------------------------
  console.log('Test 7: Verify clearBadges removes overlay and resets cached element references...');
  {
    const clearRes = scanner.clearBadges();
    assert(clearRes.success, 'clearBadges should return success');

    const existingOverlay = mockDoc.getElementById('siddarth-badge-overlay');
    assert(!existingOverlay, 'Overlay must be removed from document DOM');
    assert.strictEqual(scanner.elementMap.size, 0, 'Internal element map must be emptied');
    assert.strictEqual(scanner.getScannedElements().length, 0, 'Scanned metadata must be reset');

    console.log('✓ clearBadges successfully tears down overlay and resets all internal memory.\n');
  }

  // ----------------------------------------------------
  // TEST 8: Side Panel AgentTab Controller Integration
  // ----------------------------------------------------
  console.log('Test 8: Verify AgentTab controller scanning, UI metrics, and badge clearing...');
  {
    mockDoc.body.children = [];

    // Create mock webpage elements
    const textInput = new MockElement('input', { type: 'text', placeholder: 'Name' }, '', { top: 10, left: 10, width: 100, height: 30 });
    const actionBtn = new MockElement('button', {}, 'Next', { top: 50, left: 10, width: 80, height: 30 });
    const navLink = new MockElement('a', { href: '#' }, 'Docs', { top: 90, left: 10, width: 60, height: 20 });
    const selectEl = new MockElement('select', {}, '', { top: 130, left: 10, width: 100, height: 30 });
    const deleteBtn = new MockElement('button', {}, 'Delete Record', { top: 170, left: 10, width: 100, height: 30 });

    mockDoc.body.appendChild(textInput);
    mockDoc.body.appendChild(actionBtn);
    mockDoc.body.appendChild(navLink);
    mockDoc.body.appendChild(selectEl);
    mockDoc.body.appendChild(deleteBtn);

    // Mock Side Panel DOM elements
    const mockPanelElements = {
      'btn-scan-elements': new MockElement('button'),
      'btn-clear-badges': new MockElement('button'),
      'btn-refresh-scan': new MockElement('button'),
      'agent-scanner-summary-card': new MockElement('div', { 'data-display': 'none' }),
      'agent-scanned-count-badge': new MockElement('span'),
      'badge-count-inputs': new MockElement('span'),
      'badge-count-buttons': new MockElement('span'),
      'badge-count-links': new MockElement('span'),
      'badge-count-selects': new MockElement('span'),
      'badge-count-consequential': new MockElement('span'),
      'agent-element-search-input': new MockElement('input'),
      'agent-elements-list': new MockElement('div'),
      'agent-empty-elements-state': new MockElement('div'),
      'agent-toast': new MockElement('div'),
      'agent-error-box': new MockElement('div')
    };

    // Mock chrome API for AgentTab
    globalThis.chrome = {
      tabs: {
        query: () => Promise.resolve([{ id: 101, url: 'https://example.com/form' }]),
        sendMessage: (tabId, msg, cb) => {
          if (msg.type === 'SCAN_PAGE_ELEMENTS') {
            const scanRes = scanner.scanAndBadge();
            cb(scanRes);
          } else if (msg.type === 'CLEAR_PAGE_BADGES') {
            const clearRes = scanner.clearBadges();
            cb(clearRes);
          } else if (msg.type === 'HIGHLIGHT_ELEMENT') {
            const hlRes = scanner.highlightElement(msg.id);
            cb(hlRes);
          } else {
            cb({ success: true });
          }
        }
      },
      scripting: {
        insertCSS: () => Promise.resolve(),
        executeScript: () => Promise.resolve()
      },
      runtime: {
        lastError: null
      }
    };

    // Override getElementById for sidepanel controls
    const origGetById = mockDoc.getElementById;
    mockDoc.getElementById = (id) => mockPanelElements[id] || origGetById(id);

    const agentTab = new AgentTab();

    // Trigger Scan
    await agentTab.handleScanElements();

    assert.strictEqual(agentTab.scannedElements.length, 5, 'AgentTab should receive 5 scanned elements');
    assert.strictEqual(mockPanelElements['agent-scanned-count-badge'].textContent, '5 Elements Badged');
    assert.strictEqual(mockPanelElements['badge-count-inputs'].textContent, '1', '1 input breakdown');
    assert.strictEqual(mockPanelElements['badge-count-buttons'].textContent, '2', '2 buttons breakdown');
    assert.strictEqual(mockPanelElements['badge-count-links'].textContent, '1', '1 link breakdown');
    assert.strictEqual(mockPanelElements['badge-count-selects'].textContent, '1', '1 select breakdown');
    assert.strictEqual(mockPanelElements['badge-count-consequential'].textContent, '1', '1 consequential warning breakdown');

    // Verify elements list rendered in panel
    const listItems = mockPanelElements['agent-elements-list'].children;
    assert.strictEqual(listItems.length, 5, 'List container should have 5 element rows');

    // Trigger Highlight from panel
    await agentTab.highlightElement(1);
    const highlighted = scanner.elementMap.get(1);
    assert(highlighted.classList.contains('siddarth-highlight-active'), 'Element 1 should be highlighted via AgentTab');

    // Trigger Clear Badges from panel
    await agentTab.handleClearBadges();
    assert.strictEqual(agentTab.scannedElements.length, 0, 'AgentTab scannedElements should be empty after clear');
    assert.strictEqual(mockPanelElements['agent-elements-list'].children.length, 0, 'List should be cleared');

    // Restore getElementById
    mockDoc.getElementById = origGetById;

    console.log('✓ AgentTab controller coordinates scanning, category metrics, and badge cleanup seamlessly.\n');
  }

  console.log('========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 10 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('\n❌ Slice 10 Verification Test Failed:', err);
  process.exit(1);
});
