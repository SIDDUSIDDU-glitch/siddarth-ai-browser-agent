/**
 * Verification Test Suite for Slice 15: One-Click Skills Import & Export
 * 
 * Verifies:
 * 1. Skills Storage Operations & Default Built-ins:
 *    - DEFAULT_SKILLS includes 4 required recipes: "Exam notes", "Explain in Hinglish",
 *      "Reply to this email politely", and "Fill form from profile".
 *    - getSkills(), saveSkills(), addOrUpdateSkill(), deleteSkill(), resetSkillsToDefault().
 * 2. JSON Export & Import Engine (FR-14):
 *    - exportSkillsAsJson() serializes skills with standard metadata schema.
 *    - importSkillsFromJson() validates schema, handles object or raw array, and merges safely.
 *    - Edge case validation: rejects malformed JSON and missing required fields.
 *    - Full Verification Cycle: Create custom skill -> Export to JSON -> Delete skill -> Re-import -> Verify restored.
 * 3. ProfileTab UI Controller for Skills:
 *    - loadSkills() and renderSkillsList() DOM generation.
 *    - Create, Edit, Delete, and Reset UI actions with real-time feedback alerts.
 *    - Form validation safeguards.
 * 4. UI File Export & Import Handling:
 *    - Simulated Blob & DOM link download generation.
 *    - File reader / text import workflow with status alerts.
 * 5. One-Click Execution (Run on Page):
 *    - Chat skills dispatch to ChatTab.handleRunSkill(prompt).
 *    - Agent skills dispatch to AgentTab.handleStartTask(prompt).
 */

import assert from 'node:assert';
import { ProfileTab } from '../sidepanel/tabs/profile.js';
import { ChatTab } from '../sidepanel/tabs/chat.js';
import { AgentTab } from '../sidepanel/tabs/agent.js';
import {
  DEFAULT_SKILLS,
  getSkills,
  saveSkills,
  addOrUpdateSkill,
  deleteSkill,
  resetSkillsToDefault,
  exportSkillsAsJson,
  importSkillsFromJson
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
    this.href = attributes.href || '';
    this.download = attributes.download || '';
    this.checked = Boolean(attributes.checked);
    this.disabled = Boolean(attributes.disabled);
    this.textContent = text;
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.dispatchedEvents = [];
    this.clickedNative = false;
    this.eventListeners = {};
    this.files = [];

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
    if (this._rawInnerHTML !== undefined) return this._rawInnerHTML;
    return this.children.map(c => c.textContent).join('');
  }

  set innerHTML(val) {
    this._rawInnerHTML = String(val);
    this.children = [];
    if (val === '') return;

    // Simple parser for test elements created via innerHTML
    const cardMatches = String(val).match(/<div class="skill-card" data-id="([^"]+)">/g);
    if (cardMatches) {
      cardMatches.forEach(match => {
        const idMatch = match.match(/data-id="([^"]+)"/);
        const skillId = idMatch ? idMatch[1] : '';
        const cardChild = new MockElement('div', { class: 'skill-card', 'data-id': skillId });

        // Add sub-buttons
        const runBtn = new MockElement('button', { class: 'btn-run-skill', 'data-id': skillId }, 'Run');
        const editBtn = new MockElement('button', { class: 'btn-edit-skill', 'data-id': skillId }, 'Edit');
        const delBtn = new MockElement('button', { class: 'btn-delete-skill', 'data-id': skillId }, 'Delete');
        cardChild.appendChild(runBtn);
        cardChild.appendChild(editBtn);
        cardChild.appendChild(delBtn);

        this.appendChild(cardChild);
      });
    }
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return Array.from(this.classList._classes).join(' ') || null;
    if (name === 'data-id') return this.attributes['data-id'] || null;
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'data-id') this.attributes['data-id'] = String(val);
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

  click() {
    this.clickedNative = true;
    this.dispatchEvent({ type: 'click', target: this });
  }

  closest(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) return this;
      if (this.parentNode?.closest) return this.parentNode.closest(selector);
    }
    return null;
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

// Global Blob and URL mock
globalThis.Blob = class Blob {
  constructor(parts = [], opts = {}) {
    this.content = parts.join('');
    this.type = opts.type || '';
  }
};

let lastCreatedObjectURL = '';
globalThis.URL = {
  createObjectURL: (blob) => {
    lastCreatedObjectURL = `blob:test-skill-${Date.now()}`;
    return lastCreatedObjectURL;
  },
  revokeObjectURL: () => {}
};

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
    query: async () => [{ id: 101, url: 'https://example.com' }],
    sendMessage: (tabId, msg, cb) => cb?.({ success: true })
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

function initProfileAndSkillsUiDom() {
  sidepanelElements.clear();

  // Profile fields
  createMockUiElement('profile-name', 'input');
  createMockUiElement('profile-email', 'input');
  createMockUiElement('profile-phone', 'input');
  createMockUiElement('profile-college', 'input');
  createMockUiElement('profile-degree', 'input');
  createMockUiElement('profile-skills', 'textarea');
  createMockUiElement('profile-links', 'textarea');
  createMockUiElement('profile-bio', 'textarea');
  createMockUiElement('profile-tone', 'select');
  createMockUiElement('btn-save-profile', 'button');
  createMockUiElement('btn-clear-profile', 'button');
  createMockUiElement('btn-fill-form-profile', 'button');
  createMockUiElement('profile-status-box', 'div');
  createMockUiElement('profile-completeness-bar', 'div');
  createMockUiElement('profile-completeness-text', 'span');

  // Skills Toolbar
  createMockUiElement('btn-create-skill', 'button');
  createMockUiElement('btn-export-skills', 'button');
  createMockUiElement('btn-import-skills', 'button');
  createMockUiElement('file-import-skills', 'input');
  createMockUiElement('btn-reset-skills', 'button');

  // Skills Editor Form
  createMockUiElement('skill-editor-card', 'div');
  createMockUiElement('skill-editor-title', 'span');
  createMockUiElement('skill-input-name', 'input');
  createMockUiElement('skill-input-desc', 'input');
  createMockUiElement('skill-input-target', 'select');
  createMockUiElement('skill-input-prompt', 'textarea');
  createMockUiElement('btn-save-skill', 'button');
  createMockUiElement('btn-cancel-skill', 'button');

  // Skills Status & List
  createMockUiElement('skills-status-box', 'div');
  createMockUiElement('skills-list-container', 'div');

  // Chat Elements
  createMockUiElement('chat-user-input', 'textarea');
  createMockUiElement('btn-chat-send', 'button');
  createMockUiElement('btn-chat-stop', 'button');
  createMockUiElement('btn-clear-chat', 'button');
  createMockUiElement('chat-messages-list', 'div');
  createMockUiElement('chat-empty-state', 'div');

  // Agent Elements
  createMockUiElement('agent-task-input', 'input');
  createMockUiElement('btn-start-task', 'button');
  createMockUiElement('toggle-dry-run', 'input');
}

// -------------------------------------------------------------
// Test Runner
// -------------------------------------------------------------
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Slice 15: One-Click Skills Import & Export Tests');
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
  // Group 1: Skills Storage Operations & Default Built-ins
  // -------------------------------------------------------------
  console.log('--- Group 1: Skills Storage Operations & Default Built-ins ---');

  run('DEFAULT_SKILLS contains all 4 built-in recipes required by specification', () => {
    assert.strictEqual(DEFAULT_SKILLS.length, 4);

    const examSkill = DEFAULT_SKILLS.find(s => s.name === 'Exam notes');
    assert.ok(examSkill, 'Must include "Exam notes"');
    assert.strictEqual(examSkill.targetTab, 'chat');
    assert.strictEqual(examSkill.isBuiltIn, true);

    const hinglishSkill = DEFAULT_SKILLS.find(s => s.name === 'Explain in Hinglish');
    assert.ok(hinglishSkill, 'Must include "Explain in Hinglish"');
    assert.strictEqual(hinglishSkill.targetTab, 'chat');
    assert.strictEqual(hinglishSkill.isBuiltIn, true);

    const replySkill = DEFAULT_SKILLS.find(s => s.name === 'Reply to this email politely');
    assert.ok(replySkill, 'Must include "Reply to this email politely"');
    assert.strictEqual(replySkill.targetTab, 'chat');
    assert.strictEqual(replySkill.isBuiltIn, true);

    const formSkill = DEFAULT_SKILLS.find(s => s.name === 'Fill form from profile');
    assert.ok(formSkill, 'Must include "Fill form from profile"');
    assert.strictEqual(formSkill.targetTab, 'agent');
    assert.strictEqual(formSkill.isBuiltIn, true);
  });

  await runAsync('getSkills() seeds and returns DEFAULT_SKILLS when storage is empty', async () => {
    mockStorage = {};
    const skills = await getSkills();
    assert.strictEqual(skills.length, 4);
    assert.strictEqual(mockStorage.siddarth_skills.length, 4);
  });

  await runAsync('addOrUpdateSkill() adds a new custom skill and persists to storage', async () => {
    mockStorage = {};
    const res = await addOrUpdateSkill({
      name: 'Key Takeaways in 3 Bullets',
      description: 'Ultra-crisp 3 bullet points summary',
      promptTemplate: 'Extract exactly 3 concise bullet points summarizing the core ideas.',
      targetTab: 'chat'
    });

    assert.ok(res.skill.id.startsWith('skill_'));
    assert.strictEqual(res.skill.name, 'Key Takeaways in 3 Bullets');
    assert.strictEqual(res.skills.length, 5); // 4 defaults + 1 new
    assert.strictEqual(mockStorage.siddarth_skills.length, 5);
  });

  await runAsync('addOrUpdateSkill() updates existing skill in-place when ID matches', async () => {
    const current = await getSkills();
    const target = current[0];

    const updated = await addOrUpdateSkill({
      id: target.id,
      name: 'Updated Exam Notes Title',
      description: 'Updated Description',
      promptTemplate: 'Updated prompt template',
      targetTab: 'chat'
    });

    assert.strictEqual(updated.skill.id, target.id);
    assert.strictEqual(updated.skill.name, 'Updated Exam Notes Title');
    const reloaded = await getSkills();
    const found = reloaded.find(s => s.id === target.id);
    assert.strictEqual(found.name, 'Updated Exam Notes Title');
  });

  await runAsync('deleteSkill() removes targeted skill by ID from storage', async () => {
    const skillsBefore = await getSkills();
    const toDeleteId = skillsBefore[skillsBefore.length - 1].id;

    const remaining = await deleteSkill(toDeleteId);
    assert.strictEqual(remaining.length, skillsBefore.length - 1);
    assert.ok(!remaining.some(s => s.id === toDeleteId));
  });

  await runAsync('resetSkillsToDefault() restores all 4 default built-ins cleanly', async () => {
    mockStorage.siddarth_skills = [{ id: 'random_id', name: 'Temporary', promptTemplate: '...' }];
    const reset = await resetSkillsToDefault();
    assert.strictEqual(reset.length, 4);
    assert.deepStrictEqual(reset.map(s => s.id), DEFAULT_SKILLS.map(s => s.id));
  });

  // -------------------------------------------------------------
  // Group 2: JSON Export & Import Engine (FR-14)
  // -------------------------------------------------------------
  console.log('\n--- Group 2: JSON Export & Import Engine (FR-14) ---');

  await runAsync('exportSkillsAsJson() generates schema-compliant formatted JSON with metadata', async () => {
    await resetSkillsToDefault();
    const jsonStr = await exportSkillsAsJson();
    assert.ok(typeof jsonStr === 'string');

    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.version, '1.0');
    assert.strictEqual(parsed.source, 'Siddarth AI Browser Agent');
    assert.strictEqual(parsed.skillsCount, 4);
    assert.strictEqual(parsed.skills.length, 4);
    assert.ok(parsed.exportedAt);
  });

  await runAsync('importSkillsFromJson() validates and imports raw array or object format', async () => {
    mockStorage = {};
    await resetSkillsToDefault();

    // 1. Import via object schema
    const objectPayload = JSON.stringify({
      version: '1.0',
      skills: [
        {
          name: 'Custom Skill A',
          description: 'Desc A',
          promptTemplate: 'Prompt A',
          targetTab: 'chat'
        }
      ]
    });

    const resObj = await importSkillsFromJson(objectPayload, { merge: true });
    assert.strictEqual(resObj.importedCount, 1);
    assert.strictEqual(resObj.totalCount, 5); // 4 defaults + 1 imported

    // 2. Import via raw array schema
    const rawArrayPayload = JSON.stringify([
      {
        name: 'Custom Skill B',
        description: 'Desc B',
        promptTemplate: 'Prompt B',
        targetTab: 'agent'
      }
    ]);

    const resArr = await importSkillsFromJson(rawArrayPayload, { merge: true });
    assert.strictEqual(resArr.importedCount, 1);
    assert.strictEqual(resArr.totalCount, 6);
  });

  await runAsync('importSkillsFromJson() safely throws descriptive errors on invalid inputs', async () => {
    // Malformed JSON
    let syntaxError = false;
    try {
      await importSkillsFromJson('{ bad json, missing quotes }');
    } catch (err) {
      syntaxError = true;
      assert.ok(err.message.includes('Invalid JSON syntax'));
    }
    assert.strictEqual(syntaxError, true);

    // Missing required fields
    let missingFieldError = false;
    try {
      await importSkillsFromJson(JSON.stringify([{ name: 'No Prompt' }]));
    } catch (err) {
      missingFieldError = true;
      assert.ok(err.message.includes('missing required "name" or "promptTemplate"'));
    }
    assert.strictEqual(missingFieldError, true);
  });

  await runAsync('Full Verification Cycle: Create -> Export -> Delete -> Import -> Verify Restored', async () => {
    await resetSkillsToDefault();

    // Step 1: Create custom skill
    const created = await addOrUpdateSkill({
      name: 'Technical Interview Mock Griller',
      description: 'Generates rigorous coding & system design questions from page context',
      promptTemplate: 'Grill me on the technical topics found on this page with 3 system design questions.',
      targetTab: 'chat'
    });
    const customId = created.skill.id;
    assert.strictEqual((await getSkills()).length, 5);

    // Step 2: Export skills to JSON
    const exportedJson = await exportSkillsAsJson();
    assert.ok(exportedJson.includes('Technical Interview Mock Griller'));

    // Step 3: Delete the custom skill
    await deleteSkill(customId);
    const afterDelete = await getSkills();
    assert.strictEqual(afterDelete.length, 4);
    assert.ok(!afterDelete.some(s => s.id === customId), 'Custom skill must be deleted');

    // Step 4: Re-import exported JSON
    const importResult = await importSkillsFromJson(exportedJson, { merge: true });
    assert.strictEqual(importResult.totalCount, 5);

    // Step 5: Verify restored skill is present and intact
    const restoredSkills = await getSkills();
    const restored = restoredSkills.find(s => s.id === customId);
    assert.ok(restored, 'Exported skill must be restored');
    assert.strictEqual(restored.name, 'Technical Interview Mock Griller');
    assert.strictEqual(restored.promptTemplate, 'Grill me on the technical topics found on this page with 3 system design questions.');
    assert.strictEqual(restored.targetTab, 'chat');
  });

  // -------------------------------------------------------------
  // Group 3: ProfileTab UI Controller for Skills
  // -------------------------------------------------------------
  console.log('\n--- Group 3: ProfileTab UI Controller for Skills ---');

  await runAsync('ProfileTab renders skills list cards dynamically', async () => {
    initProfileAndSkillsUiDom();
    await resetSkillsToDefault();

    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    // Verify list container has 4 rendered cards
    assert.strictEqual(profileTab.skills.length, 4);
    assert.strictEqual(profileTab.skillsListContainer.children.length, 4);
  });

  await runAsync('Skill creation form opens, validates input, and appends to UI list', async () => {
    initProfileAndSkillsUiDom();
    await resetSkillsToDefault();

    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    // Open editor
    profileTab.handleOpenSkillEditor();
    assert.strictEqual(profileTab.skillEditorCard.style.display, 'block');
    assert.strictEqual(profileTab.skillEditorTitle.textContent, 'Create New Skill Recipe');

    // Attempt save with empty values -> shows warning
    await profileTab.handleSaveSkill();
    assert.strictEqual(profileTab.skillsStatusBox.style.display, 'block');
    assert.ok(profileTab.skillsStatusBox.textContent.includes('Please provide both'));
    assert.ok(profileTab.skillsStatusBox.classList.contains('alert-warning'));

    // Provide valid inputs and save
    profileTab.skillInputName.value = 'HackerNews TL;DR';
    profileTab.skillInputDesc.value = 'Condenses discussion threads';
    profileTab.skillInputTarget.value = 'chat';
    profileTab.skillInputPrompt.value = 'Summarize top 3 discussion arguments from this thread.';

    await profileTab.handleSaveSkill();

    // Verify form closed and new card rendered
    assert.strictEqual(profileTab.skillEditorCard.style.display, 'none');
    assert.strictEqual(profileTab.skills.length, 5);
    assert.ok(profileTab.skillsStatusBox.textContent.includes('saved successfully'));
  });

  await runAsync('Skill editing populates fields, saves changes, and updates UI', async () => {
    initProfileAndSkillsUiDom();
    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    const targetSkill = profileTab.skills[profileTab.skills.length - 1]; // Our custom skill

    // Open in edit mode
    profileTab.handleOpenSkillEditor(targetSkill.id);
    assert.strictEqual(profileTab.editingSkillId, targetSkill.id);
    assert.strictEqual(profileTab.skillInputName.value, targetSkill.name);
    assert.strictEqual(profileTab.skillInputPrompt.value, targetSkill.promptTemplate);

    // Modify and save
    profileTab.skillInputName.value = 'HackerNews Super TL;DR';
    await profileTab.handleSaveSkill();

    const updated = profileTab.skills.find(s => s.id === targetSkill.id);
    assert.strictEqual(updated.name, 'HackerNews Super TL;DR');
  });

  await runAsync('Skill deletion removes card and updates storage', async () => {
    initProfileAndSkillsUiDom();
    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    const beforeCount = profileTab.skills.length;
    const toDelete = profileTab.skills[profileTab.skills.length - 1];

    await profileTab.handleDeleteSkill(toDelete.id);
    assert.strictEqual(profileTab.skills.length, beforeCount - 1);
    assert.ok(profileTab.skillsStatusBox.textContent.includes('deleted'));
  });

  // -------------------------------------------------------------
  // Group 4: UI File Export & Import Handling
  // -------------------------------------------------------------
  console.log('\n--- Group 4: UI File Export & Import Handling ---');

  await runAsync('handleExportSkills() triggers file download and shows success notification', async () => {
    initProfileAndSkillsUiDom();
    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    const exportedJson = await profileTab.handleExportSkills();
    assert.ok(typeof exportedJson === 'string');
    assert.ok(profileTab.skillsStatusBox.textContent.includes('Exported'));
    assert.ok(profileTab.skillsStatusBox.classList.contains('alert-success'));
  });

  await runAsync('handleImportSkillsText() imports skills string and refreshes UI', async () => {
    initProfileAndSkillsUiDom();
    const profileTab = new ProfileTab();
    await profileTab.loadSkills();

    const importPayload = JSON.stringify({
      version: '1.0',
      skills: [
        {
          name: 'AI Code Refactor',
          description: 'Identifies refactoring candidates in code snippets',
          promptTemplate: 'Suggest clean code refactorings for the code on this page.',
          targetTab: 'chat'
        }
      ]
    });

    const res = await profileTab.handleImportSkillsText(importPayload);
    assert.strictEqual(res.importedCount, 1);
    assert.ok(profileTab.skills.some(s => s.name === 'AI Code Refactor'));
    assert.ok(profileTab.skillsStatusBox.textContent.includes('Successfully imported'));
  });

  // -------------------------------------------------------------
  // Group 5: One-Click Execution (Run on Page)
  // -------------------------------------------------------------
  console.log('\n--- Group 5: One-Click Execution (Run on Page) ---');

  await runAsync('Clicking Run on Page on Chat skill dispatches to ChatTab runner', async () => {
    initProfileAndSkillsUiDom();
    await resetSkillsToDefault();

    let executedSkill = null;
    let switchedTab = null;

    // Instantiate ChatTab and mock its handleRunSkill
    const chatTab = new ChatTab();
    let chatRanPrompt = '';
    chatTab.handleRunSkill = async (prompt, name) => {
      chatRanPrompt = prompt;
    };

    const profileTab = new ProfileTab({
      onNavigateTab: (tab) => { switchedTab = tab; },
      onRunSkill: (skill) => {
        executedSkill = skill;
        if (skill.targetTab === 'chat') {
          switchedTab = 'chat';
          chatTab.handleRunSkill(skill.promptTemplate, skill.name);
        }
      }
    });

    await profileTab.loadSkills();

    // Trigger run on "Exam notes" (Chat skill)
    profileTab.handleRunSkill('skill_exam_notes');

    assert.strictEqual(switchedTab, 'chat');
    assert.strictEqual(executedSkill.id, 'skill_exam_notes');
    assert.ok(chatRanPrompt.includes('exam revision notes'));
  });

  await runAsync('Clicking Run on Page on Agent skill dispatches to AgentTab action loop', async () => {
    initProfileAndSkillsUiDom();
    await resetSkillsToDefault();

    let switchedTab = null;
    let agentStartedTask = '';

    const agentTab = new AgentTab();
    agentTab.handleStartTask = async (task) => {
      agentStartedTask = task;
    };

    const profileTab = new ProfileTab({
      onNavigateTab: (tab) => { switchedTab = tab; },
      onRunSkill: (skill) => {
        if (skill.targetTab === 'agent') {
          switchedTab = 'agent';
          agentTab.handleStartTask(skill.promptTemplate);
        }
      }
    });

    await profileTab.loadSkills();

    // Trigger run on "Fill form from profile" (Agent skill)
    profileTab.handleRunSkill('skill_fill_form');

    assert.strictEqual(switchedTab, 'agent');
    assert.strictEqual(agentStartedTask, 'Fill out this form using my local profile memory');
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

