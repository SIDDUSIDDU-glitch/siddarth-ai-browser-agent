/**
 * Verification Test Suite for Slice 16: Deterministic Safety Rails
 * 
 * Verifies:
 * 1. Deterministic Banking & Financial URL Guards:
 *    - Strict regex checking over banking, payments, UPI, and fintech URLs/subdomains.
 *    - Rejection of financial domains with exact required message:
 *      "Automated actions are disabled on banking/financial domains."
 * 2. Sensitive Input Field Protection:
 *    - type="password", autocomplete cc-*, current-password, one-time-code.
 *    - Multi-attribute heuristics: name, id, placeholder, aria-label matching password, pin, otp, cvv, card.
 *    - assertFieldSafeForAction throws deterministic security exception.
 * 3. Consequential Action Classification:
 *    - Keyword detection for submit, pay, delete, buy, order, transfer, confirm, remove.
 * 4. Secondary Confirmation Modal Flow in AgentTab:
 *    - Consequential proposal requires double-confirmation modal.
 *    - Cancel retains state without executing; Confirm dispatches execution.
 * 5. End-to-End Safety Halting:
 *    - Automated actions on banking URLs halt immediately with safety alert.
 *    - Targeting sensitive credential fields halts and terminates action loop safely.
 */

import assert from 'node:assert';
import '../content/scanner.js';
import '../content/highlighter.js';
import '../content/executor.js';
import { ActionExecutor, SiddarthExecutor } from '../content/executor.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';
import { aiClient } from '../utils/ai-client.js';
import {
  SafetyGuard,
  BANKING_URL_REGEX,
  INTERNAL_URL_REGEX,
  SENSITIVE_FIELD_REGEX,
  CONSEQUENTIAL_REGEX
} from '../utils/safety-guard.js';

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
    this.autocomplete = attributes.autocomplete || '';
    this.checked = Boolean(attributes.checked);
    this.disabled = Boolean(attributes.disabled);
    this.textContent = text;
    this.innerText = text;
    this.children = [];
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
    return this._rawInnerHTML !== undefined ? this._rawInnerHTML : this.children.map(c => c.textContent).join('');
  }

  set innerHTML(val) {
    this._rawInnerHTML = String(val);
    if (val === '') this.children = [];
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return Array.from(this.classList._classes).join(' ') || null;
    if (name === 'type') return this.type || null;
    if (name === 'name') return this.name || null;
    if (name === 'placeholder') return this.placeholder || null;
    if (name === 'title') return this.title || null;
    if (name === 'autocomplete') return this.autocomplete || null;
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
}

// Global window & Event mocks
globalThis.window = globalThis;
window.__siddarthElements = new Map();

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

// Prototype Setter Mocks
globalThis.HTMLInputElement = function () {};
globalThis.HTMLInputElement.prototype = Object.create(MockElement.prototype);
Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
  get() { return this._value || ''; },
  set(val) { this._value = String(val); },
  configurable: true,
  enumerable: true
});

globalThis.HTMLTextAreaElement = function () {};
globalThis.HTMLTextAreaElement.prototype = Object.create(MockElement.prototype);
Object.defineProperty(globalThis.HTMLTextAreaElement.prototype, 'value', {
  get() { return this._value || ''; },
  set(val) { this._value = String(val); },
  configurable: true,
  enumerable: true
});

// UI Element Registry
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
let mockStorage = {
  siddarth_settings: {
    geminiApiKey: 'AIzaSy-MOCK-SLICE-16',
    defaultLanguage: 'en',
    maxAgentSteps: 10,
    dryRunMode: false
  },
  siddarth_profile: { name: 'Test User' },
  siddarth_action_logs: [],
  siddarth_active_session: null
};

let mockActiveTab = { id: 101, url: 'https://careers.masai.com/internship' };

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
    query: async () => [mockActiveTab],
    sendMessage: (tabId, msg, cb) => {
      if (msg.type === 'EXECUTE_ACTION') {
        SiddarthExecutor.executeAction(msg.payload || msg)
          .then(res => cb?.(res))
          .catch(err => cb?.({ success: false, error: err.message }));
      } else if (msg.type === 'SCAN_PAGE_ELEMENTS') {
        cb?.({ success: true, count: window.__testElements?.length || 0, elements: window.__testElements || [] });
      } else if (msg.type === 'HIGHLIGHT_ELEMENT') {
        cb?.({ success: true });
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

function initAgentUiDom() {
  sidepanelElements.clear();

  // Action Loop UI
  createMockUiElement('agent-task-input', 'input');
  createMockUiElement('btn-start-task', 'button');
  createMockUiElement('toggle-dry-run', 'input');
  createMockUiElement('badge-dry-run-status', 'span', 'Execution Active');
  createMockUiElement('agent-loop-status-card', 'div');
  createMockUiElement('agent-loop-status-title', 'div');
  createMockUiElement('agent-loop-status-sub', 'div');
  createMockUiElement('agent-step-proposal-card', 'div');
  createMockUiElement('prop-dryrun-banner', 'div');
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
  createMockUiElement('agent-audit-card', 'div');
  createMockUiElement('agent-audit-count-badge', 'span');
  createMockUiElement('agent-audit-search-input', 'input');
  createMockUiElement('btn-export-audit-logs', 'button');
  createMockUiElement('btn-clear-audit-logs', 'button');
  createMockUiElement('agent-audit-list', 'div');
  createMockUiElement('agent-audit-empty', 'div');
  createMockUiElement('btn-scan-elements', 'button');
  createMockUiElement('btn-clear-badges', 'button');
  createMockUiElement('agent-toast', 'div');
  createMockUiElement('agent-error-box', 'div');

  // Slice 16: Consequential Modal Elements
  createMockUiElement('consequential-confirm-modal', 'div');
  createMockUiElement('conseq-modal-action-name', 'strong');
  createMockUiElement('conseq-modal-target-label', 'span');
  createMockUiElement('conseq-modal-value-row', 'div');
  createMockUiElement('conseq-modal-value', 'span');
  createMockUiElement('conseq-modal-reason', 'span');
  createMockUiElement('btn-confirm-consequential', 'button');
  createMockUiElement('btn-cancel-consequential', 'button');
}

// -------------------------------------------------------------
// Test Runner
// -------------------------------------------------------------
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Slice 16: Deterministic Safety Rails Tests');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function run(title, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${title}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  async function runAsync(title, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${title}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  // -------------------------------------------------------------
  // Group 1: Deterministic Banking & Financial URL Guards
  // -------------------------------------------------------------
  console.log('--- Group 1: Deterministic Banking & Financial URL Guards ---');

  run('SafetyGuard.isFinancialUrl() accurately identifies financial, banking, and UPI domains', () => {
    const bankingUrls = [
      'https://netbanking.hdfcbank.com/netbanking/',
      'https://retail.onlinesbi.sbi/retail/login.htm',
      'https://www.icicibank.com/personal-banking',
      'https://www.axisbank.com/',
      'https://www.kotak.com/en/home.html',
      'https://www.paypal.com/signin',
      'https://checkout.stripe.com/pay/cs_live_123',
      'https://dashboard.razorpay.com/',
      'https://paytm.com/recharge',
      'https://phonepe.com/',
      'https://pay.google.com/',
      'https://secure.payment-gateway.example.com/upi',
      'https://billdesk.com/pg',
      'http://localhost/sample-banking.html'
    ];

    bankingUrls.forEach(url => {
      assert.strictEqual(
        SafetyGuard.isFinancialUrl(url),
        true,
        `Expected ${url} to be classified as financial domain`
      );
    });
  });

  run('SafetyGuard.isFinancialUrl() permits standard non-financial web domains', () => {
    const safeUrls = [
      'https://en.wikipedia.org/wiki/Artificial_intelligence',
      'https://news.ycombinator.com/',
      'https://github.com/masai-school',
      'https://careers.masai.com/internship',
      'https://developer.mozilla.org/en-US/docs/Web/API',
      'https://medium.com/@author/tech-story'
    ];

    safeUrls.forEach(url => {
      assert.strictEqual(
        SafetyGuard.isFinancialUrl(url),
        false,
        `Expected safe domain ${url} not to be flagged as financial`
      );
    });
  });

  run('SafetyGuard.checkUrlSafety() yields exact required DoD safety warning on banking URLs', () => {
    const check = SafetyGuard.checkUrlSafety('https://netbanking.hdfcbank.com/login');
    assert.strictEqual(check.safe, false);
    assert.strictEqual(check.type, 'financial');
    assert.strictEqual(check.error, 'Automated actions are disabled on banking/financial domains.');
  });

  // -------------------------------------------------------------
  // Group 2: Sensitive Input Field Protection
  // -------------------------------------------------------------
  console.log('\n--- Group 2: Sensitive Input Field Protection ---');

  run('SafetyGuard.isSensitiveField() flags native password and credit card autocomplete fields', () => {
    const pwdInput = new MockElement('input', { type: 'password', id: 'user-pass' });
    assert.strictEqual(SafetyGuard.isSensitiveField(pwdInput), true);

    const ccInput = new MockElement('input', { type: 'text', autocomplete: 'cc-number' });
    assert.strictEqual(SafetyGuard.isSensitiveField(ccInput), true);

    const otpInput = new MockElement('input', { type: 'text', autocomplete: 'one-time-code' });
    assert.strictEqual(SafetyGuard.isSensitiveField(otpInput), true);
  });

  run('SafetyGuard.isSensitiveField() catches masqueraded text inputs via multi-attribute heuristics', () => {
    const masqueradedInputs = [
      new MockElement('input', { type: 'text', name: 'user_pin' }),
      new MockElement('input', { type: 'text', id: 'cvv-number' }),
      new MockElement('input', { type: 'text', placeholder: 'Enter 6-digit OTP' }),
      new MockElement('input', { type: 'text', 'aria-label': 'Debit Card Number' }),
      new MockElement('input', { type: 'text', name: 'auth_token' }),
      new MockElement('input', { type: 'text', title: 'Enter CVV code' })
    ];

    masqueradedInputs.forEach((el, idx) => {
      assert.strictEqual(
        SafetyGuard.isSensitiveField(el),
        true,
        `Expected masqueraded sensitive field at index ${idx} to be protected`
      );
    });
  });

  run('SafetyGuard.isSensitiveField() does NOT block regular non-sensitive fields', () => {
    const normalInputs = [
      new MockElement('input', { type: 'text', name: 'full_name', placeholder: 'Enter full name' }),
      new MockElement('input', { type: 'email', name: 'email', placeholder: 'you@example.com' }),
      new MockElement('input', { type: 'text', name: 'college', placeholder: 'IIT Bombay' }),
      new MockElement('textarea', { name: 'skills', placeholder: 'Python, React' }),
      new MockElement('input', { type: 'text', name: 'degree', placeholder: 'Computer Science' })
    ];

    normalInputs.forEach(el => {
      assert.strictEqual(SafetyGuard.isSensitiveField(el), false);
    });
  });

  run('SafetyGuard.assertFieldSafeForAction() throws security exception on sensitive fields', () => {
    const otpEl = new MockElement('input', { type: 'text', name: 'user_otp' });

    let thrown = false;
    try {
      SafetyGuard.assertFieldSafeForAction('type', otpEl, 7);
    } catch (err) {
      thrown = true;
      assert.ok(err.message.includes('Security Guard: Automated actions on password, PIN, OTP, or credit card field #7'));
    }
    assert.strictEqual(thrown, true);
  });

  // -------------------------------------------------------------
  // Group 3: Consequential Action Detection & Word Classification
  // -------------------------------------------------------------
  console.log('\n--- Group 3: Consequential Action Detection & Word Classification ---');

  run('SafetyGuard.isConsequentialAction() detects high-impact action keywords', () => {
    const consequentialProposals = [
      { action: 'click', label: 'Submit Application', reason: 'Submitting candidate application' },
      { action: 'click', label: 'Pay Now', reason: 'Processing INR 5000 payment' },
      { action: 'click', label: 'Delete Account', reason: 'Deleting user profile from system' },
      { action: 'click', label: 'Confirm Order', reason: 'Finalizing checkout transaction' },
      { action: 'click', label: 'Transfer Funds', reason: 'Initiating IMPS transfer' },
      { action: 'click', label: 'Remove Item', reason: 'Removing record from database' }
    ];

    consequentialProposals.forEach(prop => {
      assert.strictEqual(
        SafetyGuard.isConsequentialAction(prop),
        true,
        `Expected action "${prop.label}" to be detected as consequential`
      );
    });
  });

  run('SafetyGuard.isConsequentialAction() returns false for routine non-consequential steps', () => {
    const routineProposals = [
      { action: 'type', label: 'Full Name', value: 'Siddarth Sharma', reason: 'Entering candidate name' },
      { action: 'select', label: 'Degree Dropdown', value: 'B.Tech', reason: 'Choosing degree' },
      { action: 'click', label: 'Next Section', reason: 'Expanding accordion section' },
      { action: 'scroll', value: 400, reason: 'Scrolling down page to view more fields' }
    ];

    routineProposals.forEach(prop => {
      assert.strictEqual(
        SafetyGuard.isConsequentialAction(prop),
        false,
        `Expected routine step "${prop.label || prop.action}" not to be flagged consequential`
      );
    });
  });

  // -------------------------------------------------------------
  // Group 4: Secondary Confirmation Modal Flow in AgentTab
  // -------------------------------------------------------------
  console.log('\n--- Group 4: Secondary Confirmation Modal Flow in AgentTab ---');

  await runAsync('Consequential proposal click Approve opens Secondary Confirmation Modal', async () => {
    initAgentUiDom();
    mockActiveTab = { id: 101, url: 'https://careers.masai.com/internship' };

    const agentTab = new AgentTab();
    agentTab.loopStatus = 'AWAITING_APPROVAL';
    agentTab.currentProposal = {
      action: 'click',
      targetId: 6,
      label: 'Submit Application',
      reason: 'Submitting final application form.',
      isConsequential: true
    };

    // User clicks Approve Step
    await agentTab.handleApproveStep();

    // Verify modal is displayed and action was NOT sent to executor yet
    assert.strictEqual(agentTab.consequentialModal.style.display, 'flex');
    assert.strictEqual(agentTab.conseqModalActionName.textContent, 'CLICK (Submit Application)');
    assert.strictEqual(agentTab.conseqModalTargetLabel.textContent, 'Submit Application');
    assert.ok(agentTab.conseqModalReason.textContent.includes('Submitting final application'));
    assert.strictEqual(agentTab.loopStatus, 'AWAITING_APPROVAL');
  });

  await runAsync('Modal Cancel closes modal without executing action', async () => {
    initAgentUiDom();
    const agentTab = new AgentTab();
    agentTab.loopStatus = 'AWAITING_APPROVAL';
    agentTab.currentProposal = {
      action: 'click',
      targetId: 6,
      label: 'Submit Application',
      isConsequential: true
    };

    await agentTab.handleApproveStep();
    assert.strictEqual(agentTab.consequentialModal.style.display, 'flex');

    // User clicks Cancel
    agentTab.handleCancelConsequential();
    assert.strictEqual(agentTab.consequentialModal.style.display, 'none');
    assert.strictEqual(agentTab.loopStatus, 'AWAITING_APPROVAL');
  });

  await runAsync('Modal Confirm dispatches consequential action and updates state', async () => {
    initAgentUiDom();

    const submitBtn = new MockElement('button', { id: 'btn-submit', 'data-siddarth-id': '6' }, 'Submit Application');
    window.__siddarthElements.set(6, submitBtn);

    const agentTab = new AgentTab();
    agentTab.loopStatus = 'AWAITING_APPROVAL';
    agentTab.currentProposal = {
      action: 'click',
      targetId: 6,
      label: 'Submit Application',
      reason: 'Submitting application form.',
      isConsequential: true
    };

    // Trigger modal
    await agentTab.handleApproveStep();
    assert.strictEqual(agentTab.consequentialModal.style.display, 'flex');

    // Mock planner to finish loop after submit
    agentTab.planStep = async function () {
      this.setLoopStatus('DONE');
    };

    // User confirms in secondary modal
    await agentTab.handleConfirmConsequential();

    // Verify modal was closed and action was executed on webpage button
    assert.strictEqual(agentTab.consequentialModal.style.display, 'none');
    assert.strictEqual(submitBtn.clickedNative, true);
  });

  // -------------------------------------------------------------
  // Group 5: End-to-End Safety Halting on Banking Domain & Sensitive Target
  // -------------------------------------------------------------
  console.log('\n--- Group 5: End-to-End Safety Halting on Banking & Sensitive Fields ---');

  await runAsync('AgentTab.handleStartTask() strictly halts with safety error on banking URLs', async () => {
    initAgentUiDom();

    // Mock active tab on banking domain
    mockActiveTab = {
      id: 202,
      url: 'https://netbanking.hdfcbank.com/netbanking/entry.jsp'
    };

    const agentTab = new AgentTab();
    document.getElementById('agent-task-input').value = 'Transfer 5000 INR to friend';

    // Start task
    await agentTab.handleStartTask();

    // Verify error banner is shown with exact DoD specification text
    assert.strictEqual(agentTab.agentError.style.display, 'block');
    assert.ok(
      agentTab.agentError.textContent.includes('Automated actions are disabled on banking/financial domains.')
    );
    assert.strictEqual(agentTab.loopStatus, 'IDLE');
  });

  await runAsync('AgentTab.planStep() strictly halts when planner proposes targeting password/OTP field', async () => {
    initAgentUiDom();
    mockActiveTab = { id: 101, url: 'https://careers.masai.com/internship' };

    const agentTab = new AgentTab();
    agentTab.taskQuery = 'Enter account login';

    // Register scanned elements containing a sensitive password field
    window.__testElements = [
      { id: 1, tag: 'input', type: 'text', label: 'User ID' },
      { id: 2, tag: 'input', type: 'password', label: 'Account Password' }
    ];

    // Mock planner proposing to type into sensitive field #2
    aiClient.planNextStep = async () => ({
      action: 'type',
      targetId: 2,
      value: 'Secret123!',
      label: 'Account Password',
      reason: 'Typing password into account field'
    });

    await agentTab.planStep();

    // Verify security guard halted execution and displayed security alert
    assert.strictEqual(agentTab.agentError.style.display, 'block');
    assert.ok(agentTab.agentError.textContent.includes('Security Guard: Automated actions on password, PIN, OTP, or credit card fields are strictly prohibited.'));
    assert.strictEqual(agentTab.loopStatus, 'STOPPED');
  });

  await runAsync('ActionExecutor.executeAction() in content script enforces defense-in-depth on passwords', async () => {
    const executor = new ActionExecutor();
    const pwdEl = new MockElement('input', { type: 'password', id: 'pwd' });
    window.__siddarthElements.set(99, pwdEl);

    let blocked = false;
    try {
      await executor.executeAction({ action: 'type', targetId: 99, value: 'hackpass' });
    } catch (err) {
      blocked = true;
      assert.ok(err.message.includes('Security Guard: Automated typing into sensitive credential/card field #99 is strictly blocked.'));
    }

    assert.strictEqual(blocked, true, 'Executor must throw security error');
    assert.strictEqual(pwdEl.value, '', 'Sensitive field value must not be modified');
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 Test Summary: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
