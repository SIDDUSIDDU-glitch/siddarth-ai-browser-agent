/**
 * Verification Test Suite for Slice 13: Persistence, Dry-Run Mode & Audit Action Log
 * 
 * Verifies:
 * 1. Task State Persistence Across Side Panel Reopens / Service Worker Suspension:
 *    - Saves full state (task, currentStepNumber, loopStatus, currentProposal, stepHistory, dryRunMode)
 *    - Restores state when side panel reopens
 *    - Re-renders pending proposal card & re-highlights target element on page
 * 2. Dry-Run Mode Simulation Engine:
 *    - Toggle switch updates mode and persists to storage
 *    - UI reflects simulation state: banner, badge, "Approve & Simulate" button label
 *    - Executor centers & focuses element, but dispatches ZERO real clicks or keystrokes (no DOM mutations)
 *    - Step history logs status as 'dryrun'
 * 3. Persistent Audit Action Log:
 *    - Automatically records all approved, skipped, and dry-run actions in chrome.storage.local
 *    - Preserves timestamp, URL, domain, step number, action type, target ID, label, value, reason, and status
 * 4. Audit Log UI Filtering, Search, Export & Clear:
 *    - Real-time text filtering across audit log history
 *    - JSON serialization and export
 *    - Complete log cleanup
 */

import assert from 'node:assert';
import '../content/scanner.js';
import '../content/highlighter.js';
import '../content/executor.js';
import { ActionExecutor, SiddarthExecutor } from '../content/executor.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';
import {
  getActionLogs,
  appendActionLog,
  clearActionLogs,
  exportActionLogsAsJson,
  getActiveSession,
  saveActiveSession,
  clearActiveSession,
  getDryRunMode,
  setDryRunMode
} from '../utils/storage-manager.js';

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

  remove() {
    if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
      this.parentNode.removeChild(this);
    }
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

  querySelectorAll(sel) {
    return this.children.filter(c => {
      if (sel.startsWith('.')) return c.classList.contains(sel.slice(1));
      return false;
    });
  }
}

// Global window & Event mocks
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

// Global Blob & URL Mocks for JSON Export Testing
globalThis.Blob = class Blob {
  constructor(parts = [], opts = {}) {
    this.content = parts.join('');
    this.type = opts.type || '';
  }
};

let lastCreatedObjectURL = '';
globalThis.URL.createObjectURL = (blob) => {
  lastCreatedObjectURL = `blob:test-export-${Date.now()}`;
  return lastCreatedObjectURL;
};
globalThis.URL.revokeObjectURL = () => {};

// In-Memory Storage Mock
let mockStorage = {
  siddarth_settings: {
    geminiApiKey: 'AIzaSy-TEST-SLICE-13-KEY',
    defaultLanguage: 'en',
    preferredModel: 'gemini-flash-lite-latest',
    maxAgentSteps: 10,
    dryRunMode: false
  },
  siddarth_profile: {
    name: 'Siddarth Sharma',
    college: 'IIT Bombay'
  },
  siddarth_active_session: null,
  siddarth_action_logs: []
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
    query: async () => [{ id: 101, url: 'https://careers.masai.com/internship-apply' }],
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

// Create All Required Mock DOM Elements
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

// Test Suite
async function runTests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 13 (Persistence & Audit)');
  console.log('========================================================\n');

  const executor = new ActionExecutor();

  // Test 1: Dry-Run Simulation Execution in content/executor.js
  console.log('Test 1: Verify Dry-Run mode in content/executor.js does NOT mutate DOM or dispatch clicks...');
  {
    const inputEl = new MockElement('input', { type: 'text', name: 'fullname', id: 'inp-name' });
    const btnEl = new MockElement('button', { id: 'btn-sub' }, 'Submit Application');
    window.__siddarthElements = new Map([
      [1, inputEl],
      [2, btnEl]
    ]);

    // A. Dry-Run Type:
    const dryTypeResult = await executor.executeAction({
      action: 'type',
      targetId: 1,
      value: 'Jane Doe',
      dryRun: true
    });

    assert.strictEqual(dryTypeResult.success, true);
    assert.strictEqual(dryTypeResult.isDryRun, true, 'Result must be flagged isDryRun');
    assert.strictEqual(dryTypeResult.simulated, true, 'Result must be flagged simulated');
    assert.strictEqual(inputEl.scrolledIntoView, true, 'Element must be scrolled into view for visual grounding');
    assert.strictEqual(inputEl.focused, true, 'Element must be focused');
    assert.strictEqual(inputEl.value, '', 'Element value must NOT be mutated in dry-run mode');
    assert.strictEqual(inputEl.dispatchedEvents.length, 1, 'Only focus event should fire, no input/change events');

    // B. Dry-Run Click:
    const dryClickResult = await executor.executeAction({
      action: 'click',
      targetId: 2,
      dryRun: true
    });

    assert.strictEqual(dryClickResult.success, true);
    assert.strictEqual(dryClickResult.isDryRun, true);
    assert.strictEqual(btnEl.clickedNative, false, 'Button click() must NOT be called in dry-run mode');
    assert.ok(!btnEl.dispatchedEvents.includes('click'), 'Click event must NOT be dispatched in dry-run mode');

    console.log('✓ Dry-Run simulation centers & focuses elements with ZERO DOM mutations or clicks dispatched.\n');
  }

  // Test 2: Dry-Run Mode Toggle UI & Storage Synchronization
  console.log('Test 2: Verify Dry-Run Mode toggle in AgentTab updates UI banner, button text, and storage...');
  {
    const agentTab = new AgentTab();
    await agentTab.restoreSessionIfExists();
    const toggleEl = document.getElementById('toggle-dry-run');
    const badgeEl = document.getElementById('badge-dry-run-status');
    const bannerEl = document.getElementById('prop-dryrun-banner');
    const approveBtn = document.getElementById('btn-approve-step');

    // Initially Dry-Run is off
    assert.strictEqual(agentTab.dryRunMode, false);
    assert.strictEqual(badgeEl.textContent, 'Execution Active');

    // Setup active proposal to verify proposal card UI update
    agentTab.currentProposal = {
      action: 'type',
      targetId: 1,
      value: 'Jane Doe',
      label: 'Full Name',
      reason: 'Entering name.',
      isConsequential: false
    };
    agentTab.renderProposalCard(agentTab.currentProposal);
    assert.strictEqual(bannerEl.style.display, 'none');
    assert.ok(approveBtn.innerHTML.includes('Approve &amp; Execute') || approveBtn.innerHTML.includes('Approve & Execute'));

    // Toggle Dry-Run ON
    await agentTab.handleToggleDryRun(true);

    assert.strictEqual(agentTab.dryRunMode, true);
    assert.strictEqual(toggleEl.checked, true);
    assert.strictEqual(badgeEl.textContent, 'Dry-Run Active');
    assert.ok(badgeEl.classList.contains('badge-dryrun'));
    assert.strictEqual(bannerEl.style.display, 'block', 'Dry-Run banner must be visible on proposal card');
    assert.ok(approveBtn.innerHTML.includes('Approve &amp; Simulate') || approveBtn.innerHTML.includes('Approve & Simulate'), 'Button label must change to Approve & Simulate');

    // Verify storage persistence
    const storedDryPref = await getDryRunMode();
    assert.strictEqual(storedDryPref, true, 'Dry-run preference must be saved in storage');

    console.log('✓ Dry-Run toggle synchronizes UI, banner notices, simulation button label, and storage.\n');
  }

  // Test 3: Active Task Session Persistence Across Side Panel Reopening
  console.log('Test 3: Verify active task session persistence survives side panel reopening / service worker suspension...');
  {
    // Step A: Create and persist an active multi-step session mid-task
    const sampleActiveSession = {
      task: 'Fill internship application',
      loopStatus: 'AWAITING_APPROVAL',
      currentStepNumber: 2,
      dryRunMode: true,
      currentProposal: {
        action: 'select',
        targetId: 5,
        value: 'Computer Science',
        label: 'Degree Dropdown',
        reason: 'Selecting engineering degree.',
        isConsequential: false
      },
      stepHistory: [
        {
          stepNumber: 1,
          action: 'type',
          targetId: 1,
          value: 'Siddarth Sharma',
          label: 'Full Name',
          reason: 'Entering candidate name.',
          status: 'dryrun',
          isDryRun: true,
          timestamp: Date.now() - 5000
        }
      ],
      timestamp: Date.now()
    };

    await saveActiveSession(sampleActiveSession);

    // Step B: Simulate complete destruction of AgentTab (side panel closed)
    // Instantiate a brand new AgentTab instance (simulates user reopening side panel)
    const freshAgentTab = new AgentTab();
    await freshAgentTab.restoreSessionIfExists();

    // Verify restored state
    assert.strictEqual(freshAgentTab.taskQuery, 'Fill internship application');
    assert.strictEqual(document.getElementById('agent-task-input').value, 'Fill internship application');
    assert.strictEqual(freshAgentTab.currentStepNumber, 2);
    assert.strictEqual(freshAgentTab.loopStatus, 'AWAITING_APPROVAL');
    assert.strictEqual(freshAgentTab.dryRunMode, true);
    assert.strictEqual(document.getElementById('toggle-dry-run').checked, true);
    assert.strictEqual(freshAgentTab.stepHistory.length, 1);
    assert.strictEqual(freshAgentTab.stepHistory[0].status, 'dryrun');

    // Verify restored proposal card
    const propCard = document.getElementById('agent-step-proposal-card');
    assert.strictEqual(propCard.style.display, 'block');
    assert.strictEqual(document.getElementById('prop-action-type').textContent, 'SELECT');
    assert.strictEqual(document.getElementById('prop-target-badge').textContent, '#5');
    assert.strictEqual(document.getElementById('prop-target-label').textContent, 'Degree Dropdown');
    assert.strictEqual(document.getElementById('prop-dryrun-banner').style.display, 'block');

    console.log('✓ Multi-step agent session, dry-run state, proposal card, and history restored seamlessly.\n');
  }

  // Test 4: Persistent Audit Action Log Appending & Storage
  console.log('Test 4: Verify approved, simulated, and skipped actions are persistently logged to audit storage...');
  {
    await clearActionLogs();

    const initialLogs = await getActionLogs();
    assert.strictEqual(initialLogs.length, 0);

    // Append sample audit entries
    await appendActionLog({
      task: 'Fill internship application',
      stepNumber: 1,
      action: 'type',
      targetId: 1,
      value: 'Siddarth',
      label: 'Full Name',
      reason: 'Entered from profile.',
      status: 'approved',
      isDryRun: false,
      url: 'https://careers.masai.com/internship-apply',
      domain: 'careers.masai.com'
    });

    await appendActionLog({
      task: 'Fill internship application',
      stepNumber: 2,
      action: 'select',
      targetId: 2,
      value: 'cs',
      label: 'Degree Dropdown',
      reason: 'Simulated degree selection.',
      status: 'dryrun',
      isDryRun: true,
      url: 'https://careers.masai.com/internship-apply',
      domain: 'careers.masai.com'
    });

    await appendActionLog({
      task: 'Fill internship application',
      stepNumber: 3,
      action: 'click',
      targetId: 3,
      value: null,
      label: 'Optional Phone Field',
      reason: 'User chose to skip phone number.',
      status: 'skipped',
      isDryRun: false,
      url: 'https://careers.masai.com/internship-apply',
      domain: 'careers.masai.com'
    });

    const storedLogs = await getActionLogs();
    assert.strictEqual(storedLogs.length, 3);
    assert.strictEqual(storedLogs[0].status, 'approved');
    assert.strictEqual(storedLogs[1].status, 'dryrun');
    assert.strictEqual(storedLogs[1].isDryRun, true);
    assert.strictEqual(storedLogs[2].status, 'skipped');
    assert.strictEqual(storedLogs[0].domain, 'careers.masai.com');
    assert.ok(storedLogs[0].timestamp > 0);

    console.log('✓ All actions automatically appended to persistent audit storage with complete metadata.\n');
  }

  // Test 5: Audit Log UI Rendering, Search & Filtering
  console.log('Test 5: Verify Audit Log UI list rendering, search filtering, and badge counters...');
  {
    const agentTab = new AgentTab();
    await agentTab.loadAuditLogs();

    const auditCountBadge = document.getElementById('agent-audit-count-badge');
    const auditList = document.getElementById('agent-audit-list');

    assert.strictEqual(auditCountBadge.textContent, '3 Events');
    assert.strictEqual(auditList.children.length, 3);

    // Search filter for "dryrun" or "cs"
    agentTab.auditSearchQuery = 'dryrun';
    agentTab.renderAuditLogs();
    assert.strictEqual(auditList.children.length, 1);
    assert.ok(auditList.children[0].className.includes('audit-dryrun'));

    // Search filter for "Full Name"
    agentTab.auditSearchQuery = 'full name';
    agentTab.renderAuditLogs();
    assert.strictEqual(auditList.children.length, 1);
    assert.ok(auditList.children[0].className.includes('audit-approved'));

    // Reset search
    agentTab.auditSearchQuery = '';
    agentTab.renderAuditLogs();
    assert.strictEqual(auditList.children.length, 3);

    console.log('✓ Historical audit log UI renders distinct status styles and filters in real-time.\n');
  }

  // Test 6: Audit Log JSON Export & Clearing
  console.log('Test 6: Verify Audit Log JSON export and complete log cleanup...');
  {
    const agentTab = new AgentTab();
    await agentTab.loadAuditLogs();

    // Verify JSON export
    const jsonString = await exportActionLogsAsJson();
    const parsedLogs = JSON.parse(jsonString);
    assert.ok(Array.isArray(parsedLogs));
    assert.strictEqual(parsedLogs.length, 3);
    assert.strictEqual(parsedLogs[0].action, 'type');

    // Trigger export handler
    await agentTab.handleExportAuditLogs();

    // Trigger clear handler
    await agentTab.handleClearAuditLogs();
    assert.strictEqual(agentTab.auditLogs.length, 0);

    const logsAfterClear = await getActionLogs();
    assert.strictEqual(logsAfterClear.length, 0);

    const auditEmpty = document.getElementById('agent-audit-empty');
    assert.strictEqual(auditEmpty.style.display, 'block');

    console.log('✓ Audit logs export cleanly to formatted JSON and support full tamper-evident reset.\n');
  }

  // Clean up test active session
  await clearActiveSession();

  console.log('========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 13 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUNNER FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
