/**
 * Verification Test Suite for Slice 14: Local Profile Memory & Auto-Form Filling
 * 
 * Verifies:
 * 1. Local Profile Memory CRUD & Default Schema:
 *    - Validates DEFAULT_PROFILE contains all expected fields (name, email, phone, college, degree, skills, links, bio, preferredTone).
 *    - getProfile(), saveProfile(), clearProfile() in utils/storage-manager.js.
 *    - Enforces zero-cloud local storage privacy (chrome.storage.local only).
 * 2. Dynamic Profile Completeness Calculation:
 *    - 0 fields filled = 0%.
 *    - 4 fields filled out of 8 = 50%.
 *    - 8 fields filled out of 8 = 100%.
 *    - Input event listeners dynamically update progress bar style & label.
 * 3. ProfileTab UI Controller:
 *    - loadProfile() populates form inputs from storage.
 *    - handleSaveProfile() captures form inputs, saves to storage, and renders success notification.
 *    - handleClearProfile() clears form inputs, resets storage, and updates completeness.
 * 4. AIClient Profile Grounding Prompt Injection:
 *    - AIClient.planNextStep() injects all 9 profile properties into LLM reasoning prompt.
 *    - Grounding instructions direct agent to map profile memory into form fields.
 * 5. End-to-End Auto-Form Fill Integration:
 *    - ProfileTab "Fill Active Webpage Form from Profile" button invokes agent workflow.
 *    - Passes profile context to Agent action loop.
 *    - Agent proposes step with profile data; approval dispatches synthetic typing into target DOM element.
 */

import assert from 'node:assert';
import '../content/scanner.js';
import '../content/highlighter.js';
import '../content/executor.js';
import { ActionExecutor, SiddarthExecutor } from '../content/executor.js';
import { ProfileTab } from '../sidepanel/tabs/profile.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';
import { AIClient, aiClient } from '../utils/ai-client.js';
import {
  getProfile,
  saveProfile,
  clearProfile,
  DEFAULT_PROFILE
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
      opacity: attributes['data-opacity'] || '1',
      width: '0%'
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
let mockStorage = {};

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

// Helper to initialize sidepanel profile and agent elements
function initAllUiDom() {
  sidepanelElements.clear();

  // Profile Inputs
  createMockUiElement('profile-name', 'input');
  createMockUiElement('profile-email', 'input');
  createMockUiElement('profile-phone', 'input');
  createMockUiElement('profile-college', 'input');
  createMockUiElement('profile-degree', 'input');
  createMockUiElement('profile-skills', 'textarea');
  createMockUiElement('profile-links', 'textarea');
  createMockUiElement('profile-bio', 'textarea');
  createMockUiElement('profile-tone', 'select');

  // Profile Actions & Status
  createMockUiElement('btn-save-profile', 'button');
  createMockUiElement('btn-clear-profile', 'button');
  createMockUiElement('btn-fill-form-profile', 'button');
  createMockUiElement('profile-status-box', 'div');
  createMockUiElement('profile-completeness-bar', 'div');
  createMockUiElement('profile-completeness-text', 'span');

  // Agent Elements
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
}

// -------------------------------------------------------------
// Test Runner
// -------------------------------------------------------------
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Slice 14: Local Profile Memory & Auto-Fill Tests');
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
  // Group 1: Storage Manager Profile CRUD & Default Schema
  // -------------------------------------------------------------
  console.log('--- Group 1: Storage Manager Profile CRUD & Default Schema ---');

  run('DEFAULT_PROFILE contains all expected fields with clean defaults', () => {
    assert.strictEqual(DEFAULT_PROFILE.name, '');
    assert.strictEqual(DEFAULT_PROFILE.email, '');
    assert.strictEqual(DEFAULT_PROFILE.phone, '');
    assert.strictEqual(DEFAULT_PROFILE.college, '');
    assert.strictEqual(DEFAULT_PROFILE.degree, '');
    assert.strictEqual(DEFAULT_PROFILE.skills, '');
    assert.strictEqual(DEFAULT_PROFILE.links, '');
    assert.strictEqual(DEFAULT_PROFILE.bio, '');
    assert.strictEqual(DEFAULT_PROFILE.preferredTone, 'Professional and concise');
  });

  await runAsync('getProfile() returns default profile when storage is empty', async () => {
    mockStorage = {};
    const profile = await getProfile();
    assert.deepStrictEqual(profile, DEFAULT_PROFILE);
  });

  await runAsync('saveProfile() merges partial updates and persists to chrome.storage.local', async () => {
    mockStorage = {};
    const updated = await saveProfile({
      name: 'Aarav Patel',
      college: 'IIT Delhi',
      skills: 'Python, TypeScript, React, Docker'
    });

    assert.strictEqual(updated.name, 'Aarav Patel');
    assert.strictEqual(updated.college, 'IIT Delhi');
    assert.strictEqual(updated.skills, 'Python, TypeScript, React, Docker');
    assert.strictEqual(updated.degree, ''); // Preserved default
    assert.strictEqual(updated.preferredTone, 'Professional and concise');

    // Check direct storage content
    assert.strictEqual(mockStorage.siddarth_profile.name, 'Aarav Patel');
    assert.strictEqual(mockStorage.siddarth_profile.college, 'IIT Delhi');
  });

  await runAsync('clearProfile() completely resets profile storage back to DEFAULT_PROFILE', async () => {
    mockStorage = {
      siddarth_profile: {
        name: 'Should Be Cleared',
        email: 'clear@example.com'
      }
    };
    const cleared = await clearProfile();
    assert.deepStrictEqual(cleared, DEFAULT_PROFILE);
    assert.deepStrictEqual(mockStorage.siddarth_profile, DEFAULT_PROFILE);
  });

  // -------------------------------------------------------------
  // Group 2: ProfileTab Completeness Calculation
  // -------------------------------------------------------------
  console.log('\n--- Group 2: Dynamic Profile Completeness Calculation ---');

  await runAsync('updateCompleteness calculates 0% when all 8 fields are empty', async () => {
    initAllUiDom();
    mockStorage = {};
    const profileTab = new ProfileTab();
    await profileTab.loadProfile();

    assert.strictEqual(profileTab.completenessBar.style.width, '0%');
    assert.strictEqual(profileTab.completenessText.textContent, '0%');
  });

  await runAsync('updateCompleteness calculates 50% when 4 of 8 fields are filled', async () => {
    initAllUiDom();
    mockStorage = {
      siddarth_profile: {
        name: 'Siddarth S',
        email: 'siddarth@masai.school',
        phone: '+91 9876543210',
        college: 'Masai School'
      }
    };
    const profileTab = new ProfileTab();
    await profileTab.loadProfile();

    assert.strictEqual(profileTab.completenessBar.style.width, '50%');
    assert.strictEqual(profileTab.completenessText.textContent, '50%');
  });

  await runAsync('updateCompleteness calculates 100% when all 8 fields are filled', async () => {
    initAllUiDom();
    mockStorage = {
      siddarth_profile: {
        name: 'Siddarth S',
        email: 'siddarth@masai.school',
        phone: '+91 9876543210',
        college: 'Masai School',
        degree: 'Full Stack Web Development',
        skills: 'JavaScript, Node.js, React, Chrome Extensions',
        links: 'https://github.com/siddarth, https://linkedin.com/in/siddarth',
        bio: 'Passionate developer building agentic AI tools for the web.',
        preferredTone: 'Enthusiastic and clear'
      }
    };
    const profileTab = new ProfileTab();
    await profileTab.loadProfile();

    assert.strictEqual(profileTab.completenessBar.style.width, '100%');
    assert.strictEqual(profileTab.completenessText.textContent, '100%');
  });

  await runAsync('Dynamic typing fires input events and updates completeness bar live', async () => {
    initAllUiDom();
    mockStorage = {};
    const profileTab = new ProfileTab();
    await profileTab.loadProfile();

    assert.strictEqual(profileTab.completenessText.textContent, '0%');

    // Simulate user typing into 2 fields
    profileTab.inputName.value = 'Vikram Malhotra';
    profileTab.inputName.dispatchEvent({ type: 'input' });
    profileTab.inputEmail.value = 'vikram@example.com';
    profileTab.inputEmail.dispatchEvent({ type: 'input' });

    // 2 / 8 = 25%
    assert.strictEqual(profileTab.completenessBar.style.width, '25%');
    assert.strictEqual(profileTab.completenessText.textContent, '25%');
  });

  // -------------------------------------------------------------
  // Group 3: ProfileTab UI Actions (Save, Clear, Alerts)
  // -------------------------------------------------------------
  console.log('\n--- Group 3: ProfileTab UI Actions (Save, Clear, Alerts) ---');

  await runAsync('handleSaveProfile() extracts input values, saves to storage, and shows success alert', async () => {
    initAllUiDom();
    mockStorage = {};
    const profileTab = new ProfileTab();

    profileTab.inputName.value = 'Ananya Roy';
    profileTab.inputEmail.value = 'ananya@example.com';
    profileTab.inputPhone.value = '+91 9999888877';
    profileTab.inputCollege.value = 'BITS Pilani';
    profileTab.inputDegree.value = 'Computer Science';
    profileTab.inputSkills.value = 'Go, Kubernetes, Python';
    profileTab.inputLinks.value = 'https://ananya.dev';
    profileTab.inputBio.value = 'Systems engineer and open source contributor.';
    profileTab.selectTone.value = 'Professional and concise';

    await profileTab.handleSaveProfile();

    // Verify storage saved
    assert.strictEqual(mockStorage.siddarth_profile.name, 'Ananya Roy');
    assert.strictEqual(mockStorage.siddarth_profile.college, 'BITS Pilani');
    assert.strictEqual(mockStorage.siddarth_profile.skills, 'Go, Kubernetes, Python');

    // Verify alert message and class
    assert.strictEqual(profileTab.statusBox.style.display, 'block');
    assert.ok(profileTab.statusBox.textContent.includes('saved successfully'));
    assert.ok(profileTab.statusBox.classList.contains('alert-success'));
  });

  await runAsync('handleClearProfile() resets form fields, clears storage, and resets completeness', async () => {
    initAllUiDom();
    mockStorage = {
      siddarth_profile: {
        name: 'To Be Cleared',
        email: 'tbc@example.com'
      }
    };
    const profileTab = new ProfileTab();
    await profileTab.loadProfile();

    assert.strictEqual(profileTab.inputName.value, 'To Be Cleared');

    // Trigger clear
    await profileTab.handleClearProfile();

    // Form inputs must be empty
    assert.strictEqual(profileTab.inputName.value, '');
    assert.strictEqual(profileTab.inputEmail.value, '');
    assert.strictEqual(profileTab.completenessBar.style.width, '0%');
    assert.strictEqual(profileTab.completenessText.textContent, '0%');

    // Status alert reflects clear
    assert.strictEqual(profileTab.statusBox.style.display, 'block');
    assert.ok(profileTab.statusBox.textContent.includes('cleared'));
    assert.ok(profileTab.statusBox.classList.contains('alert-info'));
  });

  // -------------------------------------------------------------
  // Group 4: AIClient Profile Grounding Prompt Injection
  // -------------------------------------------------------------
  console.log('\n--- Group 4: AIClient Profile Grounding Prompt Injection ---');

  await runAsync('AIClient.planNextStep() injects all profile facts into LLM prompt', async () => {
    const customAiClient = new AIClient({ apiKey: 'AIzaSy-MOCK-TEST-KEY' });

    let capturedPrompt = '';
    customAiClient.generateText = async (options) => {
      capturedPrompt = typeof options === 'string' ? options : (options?.prompt || '');
      return JSON.stringify({
        action: 'type',
        targetId: 1,
        value: 'Aarav Sharma',
        label: 'Full Name',
        reason: 'Filled Full Name using profile memory',
        isConsequential: false
      });
    };

    const mockProfile = {
      name: 'Aarav Sharma',
      email: 'aarav.sharma@example.com',
      phone: '+91 9123456789',
      college: 'IIT Bombay',
      degree: 'B.Tech Computer Science',
      skills: 'React, Node.js, AI, System Design',
      links: 'https://aarav.io, https://github.com/aarav',
      bio: 'Aspiring AI engineer eager to contribute.',
      preferredTone: 'Professional and concise'
    };

    const stepResult = await customAiClient.planNextStep({
      task: 'Fill out this job application form',
      elements: [{ id: 1, tag: 'input', type: 'text', label: 'Full Name' }],
      stepHistory: [],
      profile: mockProfile
    });

    assert.strictEqual(stepResult.action, 'type');
    assert.strictEqual(stepResult.targetId, 1);
    assert.strictEqual(stepResult.value, 'Aarav Sharma');

    // Assert profile section header and facts in injected prompt
    assert.ok(capturedPrompt.includes('USER PROFILE MEMORY (use these personal facts when filling relevant fields)'), 'Must contain profile section header');
    assert.ok(capturedPrompt.includes('Full Name: Aarav Sharma'), 'Must contain Full Name');
    assert.ok(capturedPrompt.includes('Email Address: aarav.sharma@example.com'), 'Must contain Email');
    assert.ok(capturedPrompt.includes('Phone Number: +91 9123456789'), 'Must contain Phone');
    assert.ok(capturedPrompt.includes('College / University: IIT Bombay'), 'Must contain College');
    assert.ok(capturedPrompt.includes('Degree Program / Major: B.Tech Computer Science'), 'Must contain Degree');
    assert.ok(capturedPrompt.includes('Technical Skills: React, Node.js, AI, System Design'), 'Must contain Skills');
    assert.ok(capturedPrompt.includes('Portfolio / GitHub / LinkedIn: https://aarav.io, https://github.com/aarav'), 'Must contain Links');
    assert.ok(capturedPrompt.includes('Bio / Statement: Aspiring AI engineer eager to contribute.'), 'Must contain Bio');
    assert.ok(capturedPrompt.includes('Preferred Tone: Professional and concise'), 'Must contain Tone');
  });

  // -------------------------------------------------------------
  // Group 5: End-to-End Auto-Form Fill via Agent Action Loop
  // -------------------------------------------------------------
  console.log('\n--- Group 5: End-to-End Auto-Form Fill via Agent Loop ---');

  await runAsync('Clicking Fill Form from Profile validates non-empty profile and invokes delegate', async () => {
    initAllUiDom();
    mockStorage = {};
    const profileTab = new ProfileTab();

    // With empty inputs, warning is shown
    await profileTab.handleFillFormFromProfile();
    assert.strictEqual(profileTab.statusBox.style.display, 'block');
    assert.ok(profileTab.statusBox.textContent.includes('Please enter at least'));
    assert.ok(profileTab.statusBox.classList.contains('alert-warning'));

    // Populate profile and test delegate call
    let delegatedProfile = null;
    let navigatedTab = null;

    profileTab.onFillFormFromProfile = (prof) => {
      delegatedProfile = prof;
    };
    profileTab.onNavigateTab = (tab) => {
      navigatedTab = tab;
    };

    profileTab.inputName.value = 'Rohan Gupta';
    profileTab.inputCollege.value = 'Masai School';

    await profileTab.handleFillFormFromProfile();
    assert.ok(delegatedProfile, 'Delegate must receive saved profile');
    assert.strictEqual(delegatedProfile.name, 'Rohan Gupta');
    assert.strictEqual(delegatedProfile.college, 'Masai School');
  });

  await runAsync('Auto-Form Fill triggers Agent Action Loop and fills DOM input field upon step approval', async () => {
    initAllUiDom();

    // 1. Setup mock DOM element on webpage
    const nameInputElement = new MockElement('input', {
      id: 'applicant-name',
      type: 'text',
      placeholder: 'Enter your full name',
      'data-siddarth-id': '1'
    });
    Object.setPrototypeOf(nameInputElement, globalThis.HTMLInputElement.prototype);

    // Register with scanner and executor
    window.__siddarthElements.set(1, nameInputElement);
    window.__testElements = [{
      id: 1,
      tag: 'input',
      type: 'text',
      label: 'Enter your full name',
      placeholder: 'Enter your full name',
      rect: { top: 10, left: 10, width: 250, height: 35 }
    }];

    ActionExecutor.prototype.findElement = function (targetId) {
      if (Number(targetId) === 1) return nameInputElement;
      return null;
    };

    // 2. Setup mock storage with full profile
    mockStorage = {
      siddarth_settings: {
        geminiApiKey: 'AIzaSy-MOCK-SLICE-14',
        defaultLanguage: 'en',
        preferredModel: 'gemini-flash-lite-latest',
        maxAgentSteps: 5,
        dryRunMode: false
      },
      siddarth_profile: {
        name: 'Rohan Gupta',
        email: 'rohan.gupta@masai.school',
        college: 'Masai School',
        preferredTone: 'Professional and concise'
      },
      siddarth_action_logs: [],
      siddarth_active_session: null
    };

    // 3. Mock the singleton aiClient used by AgentTab
    let planStepCount = 0;
    aiClient.planNextStep = async ({ profile, task }) => {
      planStepCount++;
      assert.strictEqual(profile.name, 'Rohan Gupta');
      assert.ok(task.toLowerCase().includes('profile memory'));

      if (planStepCount === 1) {
        return {
          action: 'type',
          targetId: 1,
          value: profile.name,
          label: 'Enter your full name',
          reason: 'Fill applicant name using local profile memory',
          isConsequential: false
        };
      } else {
        return {
          action: 'done',
          targetId: null,
          value: null,
          label: null,
          reason: 'All matching form fields filled from profile',
          isConsequential: false
        };
      }
    };

    // 4. Initialize AgentTab
    const agentTab = new AgentTab();

    // 5. Wire sidepanel-like integration: Fill from profile invokes agent task
    let activeTabId = 'profile';
    const profileTab = new ProfileTab({
      onNavigateTab: (tab) => { activeTabId = tab; },
      onFillFormFromProfile: () => {
        activeTabId = 'agent';
        agentTab.handleStartTask('Fill out this form using my local profile memory');
      }
    });

    await profileTab.loadProfile();

    // Trigger auto-form fill
    await profileTab.handleFillFormFromProfile();

    // Verify switched to agent tab and loop started
    assert.strictEqual(activeTabId, 'agent');

    // Wait a tick for async agent loop to execute first step proposal
    await new Promise(r => setTimeout(r, 60));

    // Proposal card should be populated with Step 1
    assert.strictEqual(agentTab.propActionType.textContent, 'TYPE');
    assert.strictEqual(agentTab.propTargetBadge.textContent, '#1');
    assert.strictEqual(agentTab.propValueText.textContent, '"Rohan Gupta"');
    assert.ok(agentTab.propReasonText.textContent.includes('Fill applicant name using local profile memory'));

    // Verify webpage input is not modified BEFORE user approval (Human-in-the-loop guarantee!)
    assert.strictEqual(nameInputElement.value, '');

    // 6. User clicks "Approve Step"
    await agentTab.handleApproveStep();

    // 7. Verify synthetic executor typed the profile name into the webpage DOM element!
    assert.strictEqual(nameInputElement.value, 'Rohan Gupta');
    assert.ok(nameInputElement.dispatchedEvents.includes('input'));
    assert.ok(nameInputElement.dispatchedEvents.includes('change'));

    // Verify task completed successfully
    assert.strictEqual(agentTab.loopStatus, 'DONE');
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
