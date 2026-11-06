/**
 * Verification Test Suite for Slice 12: Human-in-the-Loop Approval-Based Agent Action Loop
 * 
 * Verifies:
 * 1. Synthetic Click Event Execution:
 *    - Standard buttons & links (pointerdown, pointerup, click cascade, scrollIntoView, focus)
 *    - Checkboxes (toggles checked state, dispatches input & change events)
 *    - Radio buttons (sets checked = true, dispatches input & change events)
 * 2. Synthetic Type Event Execution with Framework Prototype Setter Compatibility:
 *    - Uses native prototype setters (HTMLInputElement.prototype.value) so React, Vue & Angular detect mutations
 *    - Dispatches full event lifecycle: input, change, blur
 * 3. Deterministic Safety Guards: Sensitive Field Rejection:
 *    - Password fields (type="password")
 *    - PIN, OTP, CVV, Card fields (by name, placeholder, aria-label)
 *    - Strictly blocks automated typing with security exception
 * 4. File Input Programmatic Restriction Handling:
 *    - Catches input[type="file"] and triggers manual user file pick
 * 5. Synthetic Select Execution:
 *    - Exact value match & fuzzy text match
 *    - Dispatches input & change events
 * 6. Synthetic Scroll Execution:
 *    - Target element centering and window scrollBy
 * 7. AIClient planNextStep Generation & Strict JSON Schema:
 *    - Instructs LLM to return strictly 1 atomic action per iteration
 *    - Validates actions: click, type, select, scroll, done
 *    - Consequential action classification
 *    - Bilingual Roman Hinglish reasoning support
 * 8. Human-in-the-Loop Three-Button Gate & State Machine Lifecycle:
 *    - Step Proposal Card rendering
 *    - Approve -> Dispatches to executor -> Updates history -> Plans next step
 *    - Skip -> Bypasses execution -> Informs LLM in step history -> Plans next step
 *    - Stop -> Halts loop immediately -> Cleans up highlights and session
 */

import assert from 'node:assert';
import '../content/scanner.js';
import '../content/highlighter.js';
import '../content/executor.js';
import { ActionExecutor, SiddarthExecutor } from '../content/executor.js';
import { AIClient } from '../utils/ai-client.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';

// Setup Mock DOM Element for Node.js Testing
class MockElement {
  constructor(tagName = 'div', attributes = {}, text = '', rect = { top: 0, left: 0, width: 100, height: 30 }) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.id = attributes.id || '';
    this.type = attributes.type || '';
    this.name = attributes.name || '';
    this._value = attributes.value || '';
    this.placeholder = attributes.placeholder || '';
    this.title = attributes.title || '';
    this.checked = Boolean(attributes.checked);
    this.disabled = Boolean(attributes.disabled);
    this.textContent = text;
    this.innerText = text;
    this.children = [];
    this.options = [];
    this.selectedIndex = -1;
    this.parentNode = null;
    this.parentElement = null;
    this.dispatchedEvents = [];
    this.focused = false;
    this.scrolledIntoView = false;
    this.clickedNative = false;
    this.eventListeners = {};

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

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = String(val);
  }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }

  set className(val) {
    this.classList._classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }

  get innerHTML() {
    return this._innerHTML !== undefined ? this._innerHTML : this.children.map(c => c.textContent).join('');
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
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
    if (name === 'data-siddarth-id') return this.attributes['data-siddarth-id'] || null;
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'data-siddarth-id') this.attributes['data-siddarth-id'] = String(val);
    if (name === 'class') {
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
    return true;
  }

  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    if (child.tagName === 'OPTION') {
      this.options.push(child);
      if (this.selectedIndex === -1) {
        this.selectedIndex = 0;
      }
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
    }
    const optIdx = this.options.indexOf(child);
    if (optIdx !== -1) {
      this.options.splice(optIdx, 1);
    }
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    this.dispatchedEvents.push(type);
    const listeners = this.eventListeners[type] || [];
    listeners.forEach(fn => fn.call(this, event));
    return true;
  }

  focus() {
    this.focused = true;
    this.dispatchEvent({ type: 'focus' });
  }

  blur() {
    this.focused = false;
    this.dispatchEvent({ type: 'blur' });
  }

  click() {
    this.clickedNative = true;
    this.dispatchEvent({ type: 'click' });
  }

  scrollIntoView() {
    this.scrolledIntoView = true;
  }

  querySelector(sel) {
    return this.children.find(c => {
      if (sel.startsWith('#') && c.id === sel.slice(1)) return true;
      if (sel.startsWith('.') && c.classList.contains(sel.slice(1))) return true;
      return false;
    }) || null;
  }

  querySelectorAll() {
    return [];
  }
}

// Setup Global Browser & DOM Mocks
globalThis.window = globalThis;
globalThis.Event = class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles !== undefined ? opts.bubbles : true;
    this.cancelable = opts.cancelable !== undefined ? opts.cancelable : false;
  }
};

globalThis.MouseEvent = class MouseEvent extends globalThis.Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.view = opts.view;
  }
};

// Prototype Setter Mocks (emulating native HTMLInputElement prototype setter)
let inputSetterCallCount = 0;
globalThis.HTMLInputElement = function () {};
globalThis.HTMLInputElement.prototype = Object.create(MockElement.prototype);
Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
  get() {
    return this._value || '';
  },
  set(val) {
    inputSetterCallCount++;
    this._value = String(val);
  },
  configurable: true,
  enumerable: true
});

globalThis.HTMLTextAreaElement = function () {};
globalThis.HTMLTextAreaElement.prototype = Object.create(MockElement.prototype);
Object.defineProperty(globalThis.HTMLTextAreaElement.prototype, 'value', {
  get() {
    return this._value || '';
  },
  set(val) {
    this._value = String(val);
  },
  configurable: true,
  enumerable: true
});

let scrolledWindowY = 0;
globalThis.scrollBy = function (opts) {
  scrolledWindowY += (opts?.top || 0);
};

// Global Element Registry for Sidepanel Mocks
const sidepanelElements = new Map();
function createMockUiElement(id, tag = 'div', text = '') {
  const el = new MockElement(tag, { id }, text);
  sidepanelElements.set(id, el);
  return el;
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => sidepanelElements.get(id) || null,
  querySelector: (sel) => {
    if (sel.startsWith('#')) return sidepanelElements.get(sel.slice(1)) || null;
    return null;
  },
  querySelectorAll: (sel) => {
    return Array.from(sidepanelElements.values()).filter(el => {
      if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
      return false;
    });
  },
  body: new MockElement('body'),
  documentElement: new MockElement('html')
};

// In-Memory Storage Mock
const mockStorage = {
  siddarth_settings: {
    geminiApiKey: 'AIzaSy-TEST-SLICE-12-KEY',
    defaultLanguage: 'en',
    preferredModel: 'gemini-flash-lite-latest',
    maxAgentSteps: 8
  },
  siddarth_profile: {
    name: 'Siddarth Sharma',
    college: 'IIT Bombay',
    skills: 'Full Stack, AI Agents, React',
    links: 'https://github.com/siddarth'
  },
  siddarth_active_session: null
};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
        });
        callback(result);
      },
      set: (items, callback) => {
        Object.assign(mockStorage, items);
        callback?.();
      },
      remove: (keys, callback) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete mockStorage[k]);
        callback?.();
      }
    }
  },
  tabs: {
    query: async () => [{ id: 42, url: 'https://careers.masai.com/internship' }],
    sendMessage: (tabId, msg, cb) => {
      if (msg.type === 'EXECUTE_ACTION') {
        SiddarthExecutor.executeAction(msg.payload || msg)
          .then(res => cb?.(res))
          .catch(err => cb?.({ success: false, error: err.message }));
      } else if (msg.type === 'SCAN_PAGE_ELEMENTS') {
        cb?.({ success: true, count: window.__testElements?.length || 0, elements: window.__testElements || [] });
      } else if (msg.type === 'HIGHLIGHT_ELEMENT') {
        cb?.({ success: true, highlighted: true });
      } else if (msg.type === 'CLEAR_HIGHLIGHT') {
        cb?.({ success: true });
      } else {
        cb?.({ success: true });
      }
    }
  },
  scripting: {
    executeScript: async () => [{ result: true }],
    insertCSS: async () => [{ result: true }]
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener: () => {}
    }
  }
};

// Populate Side Panel Mock DOM UI elements
createMockUiElement('agent-task-input', 'input');
createMockUiElement('btn-start-task', 'button');
createMockUiElement('agent-loop-status-card', 'div');
createMockUiElement('agent-loop-status-title', 'div');
createMockUiElement('agent-loop-status-sub', 'div');
createMockUiElement('agent-step-proposal-card', 'div');
createMockUiElement('agent-step-counter', 'span');
createMockUiElement('agent-proposal-state-pill', 'span');
createMockUiElement('prop-action-type', 'span');
createMockUiElement('prop-target-badge', 'span');
createMockUiElement('prop-target-label', 'span');
createMockUiElement('prop-value-row', 'div');
createMockUiElement('prop-value-text', 'div');
createMockUiElement('prop-reason-text', 'p');
createMockUiElement('prop-consequential-alert', 'div');
createMockUiElement('btn-approve-step', 'button');
createMockUiElement('btn-skip-step', 'button');
createMockUiElement('btn-stop-loop', 'button');
createMockUiElement('agent-task-done-box', 'div');
createMockUiElement('agent-task-done-message', 'div');
createMockUiElement('agent-history-card', 'div');
createMockUiElement('agent-history-count', 'span');
createMockUiElement('agent-step-history-list', 'div');
createMockUiElement('btn-clear-history', 'button');
createMockUiElement('btn-scan-elements', 'button');
createMockUiElement('btn-clear-badges', 'button');
createMockUiElement('agent-toast', 'div');
createMockUiElement('agent-error-box', 'div');
createMockUiElement('agent-scanner-summary-card', 'div');
createMockUiElement('agent-elements-list', 'div');
createMockUiElement('agent-empty-elements-state', 'div');

// Test Runner
async function runTests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 12 (Action Loop)');
  console.log('========================================================\n');

  const executor = new ActionExecutor();

  // Test 1: Synthetic Click Event Execution
  console.log('Test 1: Verify synthetic click execution on button, checkbox, and radio...');
  {
    // Normal button
    const btnEl = new MockElement('button', { id: 'btn-submit' }, 'Submit Application');
    window.__siddarthElements = new Map([[1, btnEl]]);

    const clickRes = await executor.executeAction({ action: 'click', targetId: 1 });
    assert.strictEqual(clickRes.success, true);
    assert.strictEqual(clickRes.action, 'click');
    assert.strictEqual(btnEl.scrolledIntoView, true);
    assert.strictEqual(btnEl.focused, true);
    assert.strictEqual(btnEl.clickedNative, true);
    assert.ok(btnEl.dispatchedEvents.includes('mousedown'));
    assert.ok(btnEl.dispatchedEvents.includes('mouseup'));
    assert.ok(btnEl.dispatchedEvents.includes('click'));

    // Checkbox toggle
    const chkEl = new MockElement('input', { type: 'checkbox', id: 'chk-agree' });
    chkEl.checked = false;
    window.__siddarthElements.set(2, chkEl);

    await executor.executeAction({ action: 'click', targetId: 2 });
    assert.strictEqual(chkEl.checked, true, 'Checkbox checked state must be toggled to true');
    assert.ok(chkEl.dispatchedEvents.includes('change'), 'Checkbox must dispatch change event');

    // Radio toggle
    const radioEl = new MockElement('input', { type: 'radio', name: 'gender', id: 'rad-male' });
    radioEl.checked = false;
    window.__siddarthElements.set(3, radioEl);

    await executor.executeAction({ action: 'click', targetId: 3 });
    assert.strictEqual(radioEl.checked, true, 'Radio button checked state must be set to true');
    assert.ok(radioEl.dispatchedEvents.includes('change'), 'Radio button must dispatch change event');

    console.log('✓ Synthetic click dispatches pointer cascades, handles checkboxes/radios, and focuses correctly.\n');
  }

  // Test 2: Synthetic Type Execution & Prototype Setter Compatibility
  console.log('Test 2: Verify synthetic typing with framework native prototype setter compatibility...');
  {
    inputSetterCallCount = 0;
    const inputEl = new MockElement('input', { type: 'text', name: 'fullname', id: 'inp-name' });
    Object.setPrototypeOf(inputEl, globalThis.HTMLInputElement.prototype);
    window.__siddarthElements.set(4, inputEl);

    const typeRes = await executor.executeAction({
      action: 'type',
      targetId: 4,
      value: 'Siddarth Sharma'
    });

    assert.strictEqual(typeRes.success, true);
    assert.strictEqual(typeRes.action, 'type');
    assert.strictEqual(inputEl.value, 'Siddarth Sharma');
    assert.ok(inputSetterCallCount > 0, 'HTMLInputElement prototype native setter must be invoked for React compatibility');
    assert.ok(inputEl.dispatchedEvents.includes('input'), 'Must dispatch input event');
    assert.ok(inputEl.dispatchedEvents.includes('change'), 'Must dispatch change event');
    assert.ok(inputEl.dispatchedEvents.includes('blur'), 'Must dispatch blur event');

    // Textarea typing
    const textareaEl = new MockElement('textarea', { name: 'bio', id: 'txt-bio' });
    Object.setPrototypeOf(textareaEl, globalThis.HTMLTextAreaElement.prototype);
    window.__siddarthElements.set(5, textareaEl);

    await executor.executeAction({
      action: 'type',
      targetId: 5,
      value: 'Passionate software engineer.'
    });

    assert.strictEqual(textareaEl.value, 'Passionate software engineer.');
    assert.ok(textareaEl.dispatchedEvents.includes('input'));

    console.log('✓ Native prototype setter called, full event lifecycle triggered for React/Vue frameworks.\n');
  }

  // Test 3: Deterministic Sensitive Field Rejection
  console.log('Test 3: Verify sensitive field protection blocks passwords, cards, and OTPs...');
  {
    // Password input
    const passEl = new MockElement('input', { type: 'password', id: 'inp-pass' });
    window.__siddarthElements.set(6, passEl);

    let passBlocked = false;
    try {
      await executor.executeAction({ action: 'type', targetId: 6, value: 'SuperSecret123' });
    } catch (err) {
      passBlocked = true;
      assert.ok(err.message.includes('Security Guard'), 'Must mention Security Guard');
    }
    assert.strictEqual(passBlocked, true, 'Typing into password fields must throw security exception');

    // OTP / PIN input
    const otpEl = new MockElement('input', { type: 'text', name: 'user-otp-code', id: 'inp-otp' });
    window.__siddarthElements.set(7, otpEl);

    let otpBlocked = false;
    try {
      await executor.executeAction({ action: 'type', targetId: 7, value: '458921' });
    } catch (err) {
      otpBlocked = true;
      assert.ok(err.message.includes('Security Guard'));
    }
    assert.strictEqual(otpBlocked, true, 'Typing into OTP fields must throw security exception');

    // Credit card / CVV
    const cvvEl = new MockElement('input', { type: 'text', placeholder: 'Enter CVV', id: 'inp-cvv' });
    window.__siddarthElements.set(8, cvvEl);

    let cvvBlocked = false;
    try {
      await executor.executeAction({ action: 'type', targetId: 8, value: '789' });
    } catch (err) {
      cvvBlocked = true;
      assert.ok(err.message.includes('Security Guard'));
    }
    assert.strictEqual(cvvBlocked, true, 'Typing into CVV fields must throw security exception');

    console.log('✓ Deterministic security guard strictly blocks passwords, OTPs, and credit card fields.\n');
  }

  // Test 4: File Input Safe Interception
  console.log('Test 4: Verify file inputs trigger safe manual user dialog interception...');
  {
    const fileEl = new MockElement('input', { type: 'file', name: 'resume', id: 'inp-resume' });
    window.__siddarthElements.set(9, fileEl);

    const fileRes = await executor.executeAction({
      action: 'type',
      targetId: 9,
      value: 'C:\\docs\\resume.pdf'
    });

    assert.strictEqual(fileRes.success, true);
    assert.strictEqual(fileRes.requiresManualUpload, true, 'File inputs must be flagged with requiresManualUpload');
    assert.ok(fileEl.clickedNative, 'File input click() must be invoked to open system picker');

    console.log('✓ File inputs safely prompt user upload dialog without violating browser sandbox.\n');
  }

  // Test 5: Synthetic Select Dropdown Option Selection
  console.log('Test 5: Verify dropdown select matching (exact & fuzzy text match)...');
  {
    const selectEl = new MockElement('select', { name: 'department', id: 'sel-dept' });
    const opt1 = new MockElement('option', { value: '' }, '-- Select Dept --');
    const opt2 = new MockElement('option', { value: 'cs' }, 'Computer Science & Engineering');
    const opt3 = new MockElement('option', { value: 'ee' }, 'Electrical Engineering');
    selectEl.appendChild(opt1);
    selectEl.appendChild(opt2);
    selectEl.appendChild(opt3);

    window.__siddarthElements.set(10, selectEl);

    // Exact value match
    await executor.executeAction({ action: 'select', targetId: 10, value: 'ee' });
    assert.strictEqual(selectEl.selectedIndex, 2);
    assert.ok(selectEl.dispatchedEvents.includes('change'));

    // Fuzzy text match: "Computer Science"
    await executor.executeAction({ action: 'select', targetId: 10, value: 'Computer Science' });
    assert.strictEqual(selectEl.selectedIndex, 1);

    console.log('✓ Select dropdown handles exact values, fuzzy text matches, and fires change events.\n');
  }

  // Test 6: Synthetic Scroll Execution
  console.log('Test 6: Verify element centering and window scrollBy actions...');
  {
    // Target element scroll
    const targetEl = new MockElement('div', { id: 'footer-terms' });
    window.__siddarthElements.set(11, targetEl);

    const scrollElemRes = await executor.executeAction({ action: 'scroll', targetId: 11 });
    assert.strictEqual(scrollElemRes.success, true);
    assert.strictEqual(targetEl.scrolledIntoView, true);

    // Window scrollBy
    scrolledWindowY = 0;
    const scrollWinRes = await executor.executeAction({ action: 'scroll', value: 500 });
    assert.strictEqual(scrollWinRes.success, true);
    assert.strictEqual(scrolledWindowY, 500);

    console.log('✓ Synthetic scroll centers target elements and performs viewport scrollBy smoothly.\n');
  }

  // Test 7: AIClient planNextStep Generation & Strict JSON Schema
  console.log('Test 7: Verify AIClient.planNextStep prompt construction, strict JSON, and consequential detection...');
  {
    const client = new AIClient();

    const sampleElements = [
      { id: 1, tag: 'input', role: 'input_text', label: 'Full Name', placeholder: 'Enter your name' },
      { id: 2, tag: 'input', role: 'input_email', label: 'Email Address', placeholder: 'name@example.com' },
      { id: 3, tag: 'select', role: 'select', label: 'Degree / Major' },
      { id: 4, tag: 'button', role: 'submit_button', label: 'Submit Application', isConsequential: true }
    ];

    // Mock API response for Step 1
    client.generateText = async ({ prompt }) => {
      assert.ok(prompt.includes('USER TASK: "Fill out internship form"'));
      assert.ok(prompt.includes('Siddarth Sharma'), 'Profile memory must be injected into planner prompt');

      return JSON.stringify({
        action: 'type',
        targetId: 1,
        value: 'Siddarth Sharma',
        label: 'Full Name',
        reason: 'Entering candidate full name from profile memory.',
        isConsequential: false
      });
    };

    const step1 = await client.planNextStep({
      task: 'Fill out internship form',
      elements: sampleElements,
      stepHistory: [],
      profile: mockStorage.siddarth_profile
    });

    assert.strictEqual(step1.action, 'type');
    assert.strictEqual(step1.targetId, 1);
    assert.strictEqual(step1.value, 'Siddarth Sharma');
    assert.strictEqual(step1.isConsequential, false);

    // Mock API response for Step 4 (Consequential Submit Button)
    client.generateText = async () => {
      // Simulate response wrapped in markdown fences
      return '```json\n' + JSON.stringify({
        action: 'click',
        targetId: 4,
        value: null,
        label: 'Submit Application',
        reason: 'Submitting completed application form.',
        isConsequential: true
      }) + '\n```';
    };

    const stepSubmit = await client.planNextStep({
      task: 'Fill out internship form',
      elements: sampleElements,
      stepHistory: [
        { stepNumber: 1, action: 'type', targetId: 1, value: 'Siddarth Sharma', status: 'approved' },
        { stepNumber: 2, action: 'type', targetId: 2, value: 'siddarth@iitb.ac.in', status: 'approved' }
      ]
    });

    assert.strictEqual(stepSubmit.action, 'click');
    assert.strictEqual(stepSubmit.targetId, 4);
    assert.strictEqual(stepSubmit.isConsequential, true, 'Submit button must be marked consequential');

    // Mock API response for Task Done
    client.generateText = async () => {
      return JSON.stringify({
        action: 'done',
        targetId: null,
        value: null,
        label: null,
        reason: 'Application submitted successfully. All steps finished.',
        isConsequential: false
      });
    };

    const stepDone = await client.planNextStep({
      task: 'Fill out internship form',
      elements: sampleElements,
      stepHistory: [
        { stepNumber: 1, action: 'type', targetId: 1, status: 'approved' },
        { stepNumber: 2, action: 'click', targetId: 4, status: 'approved' }
      ]
    });

    assert.strictEqual(stepDone.action, 'done');
    assert.strictEqual(stepDone.targetId, null);

    // Roman Hinglish reason conditioning
    client.generateText = async ({ language }) => {
      assert.strictEqual(language, 'hi-en');
      return JSON.stringify({
        action: 'type',
        targetId: 1,
        value: 'Siddarth Sharma',
        label: 'Full Name',
        reason: 'Form mein full name enter kiya ja raha hai.',
        isConsequential: false
      });
    };

    const hinglishStep = await client.planNextStep({
      task: 'Form fill karo',
      elements: sampleElements,
      language: 'hi-en'
    });

    assert.strictEqual(hinglishStep.action, 'type');
    assert.ok(hinglishStep.reason.includes('enter kiya ja raha hai'));

    console.log('✓ AI planner generates atomic steps, detects consequential actions, strips markdown fences, and supports Roman Hinglish.\n');
  }

  // Test 8: Human-in-the-Loop Three-Button Gate & Action Loop Lifecycle
  console.log('Test 8: Verify Human-in-the-Loop Three-Button Gate (Approve / Skip / Stop) and state machine...');
  {
    const agentTab = new AgentTab();

    // Prepare mock webpage elements
    const inpName = new MockElement('input', { type: 'text', name: 'fullname', id: 'name-field' });
    const inpEmail = new MockElement('input', { type: 'email', name: 'email', id: 'email-field' });
    const btnSub = new MockElement('button', { type: 'submit', id: 'submit-btn' }, 'Submit Application');

    window.__testElements = [
      { id: 1, tag: 'input', role: 'input_text', label: 'Full Name', el: inpName },
      { id: 2, tag: 'input', role: 'input_email', label: 'Email', el: inpEmail },
      { id: 3, tag: 'button', role: 'submit_button', label: 'Submit Application', isConsequential: true, el: btnSub }
    ];

    window.__siddarthElements = new Map([
      [1, inpName],
      [2, inpEmail],
      [3, btnSub]
    ]);

    // Setup AIClient for controlled step planning sequence
    let currentAiStep = 1;
    agentTab.planStep = async function () {
      if (currentAiStep === 1) {
        this.currentProposal = {
          action: 'type',
          targetId: 1,
          value: 'Siddarth Sharma',
          label: 'Full Name',
          reason: 'Entering name into input field.',
          isConsequential: false
        };
      } else if (currentAiStep === 2) {
        this.currentProposal = {
          action: 'type',
          targetId: 2,
          value: 'sid@example.com',
          label: 'Email Address',
          reason: 'Entering email into second field.',
          isConsequential: false
        };
      } else if (currentAiStep === 3) {
        this.currentProposal = {
          action: 'click',
          targetId: 3,
          value: null,
          label: 'Submit Application',
          reason: 'Submitting form.',
          isConsequential: true
        };
      } else {
        await this.handleTaskDone('All steps completed.');
        return;
      }

      this.setLoopStatus('AWAITING_APPROVAL');
      this.renderProposalCard(this.currentProposal);
    };

    // Step A: Start Task -> Transitions to AWAITING_APPROVAL with Step 1
    currentAiStep = 1;
    await agentTab.handleStartTask('Fill application form');

    assert.strictEqual(agentTab.loopStatus, 'AWAITING_APPROVAL', 'Must wait for user approval');
    assert.strictEqual(agentTab.currentStepNumber, 1);
    assert.strictEqual(agentTab.currentProposal.action, 'type');
    assert.strictEqual(agentTab.currentProposal.targetId, 1);

    // Verify UI Proposal Card rendered
    const propCard = document.getElementById('agent-step-proposal-card');
    assert.strictEqual(propCard.style.display, 'block', 'Step proposal card must be visible');
    const actionPill = document.getElementById('prop-action-type');
    assert.strictEqual(actionPill.textContent, 'TYPE');
    const targetBadge = document.getElementById('prop-target-badge');
    assert.strictEqual(targetBadge.textContent, '#1');

    // Verify webpage has NOT been modified autonomously before user clicks Approve
    assert.strictEqual(inpName.value, '', 'Field must not be filled before user clicks Approve');

    // Step B: User clicks "Approve & Execute" on Step 1
    currentAiStep = 2; // Next step to plan
    await agentTab.handleApproveStep();

    assert.strictEqual(inpName.value, 'Siddarth Sharma', 'Field #1 must now be populated on webpage');
    assert.strictEqual(agentTab.stepHistory.length, 1);
    assert.strictEqual(agentTab.stepHistory[0].status, 'approved');
    assert.strictEqual(agentTab.currentStepNumber, 2);

    // Now proposal card shows Step 2 (Email)
    assert.strictEqual(agentTab.currentProposal.targetId, 2);
    assert.strictEqual(targetBadge.textContent, '#2');

    // Step C: User clicks "Skip" on Step 2
    currentAiStep = 3; // Submit step to plan
    await agentTab.handleSkipStep();

    assert.strictEqual(inpEmail.value, '', 'Skipped field must NOT be filled');
    assert.strictEqual(agentTab.stepHistory.length, 2);
    assert.strictEqual(agentTab.stepHistory[1].status, 'skipped', 'Step 2 must be recorded as skipped');
    assert.strictEqual(agentTab.currentStepNumber, 3);

    // Step D: Step 3 is Consequential Submit
    assert.strictEqual(agentTab.currentProposal.isConsequential, true);
    const consequentialAlert = document.getElementById('prop-consequential-alert');
    assert.strictEqual(consequentialAlert.style.display, 'flex', 'Consequential alert must be shown');

    // Step E: User clicks "Stop"
    await agentTab.handleStopLoop();
    assert.strictEqual(agentTab.loopStatus, 'STOPPED', 'Loop status must be STOPPED');
    assert.strictEqual(propCard.style.display, 'none', 'Proposal card must be hidden upon Stop');

    // Verify active session persistence
    assert.ok(!mockStorage.siddarth_active_session, 'Stopping loop clears active session');

    console.log('✓ Human-in-the-Loop approval loop enforces 0 autonomous actions, coordinates Approve/Skip/Stop, and updates audit history.\n');
  }

  console.log('========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 12 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUNNER FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
