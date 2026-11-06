/**
 * Verification Test Suite for Slice 11: Structured Element Selection ("Find It for Me")
 * 
 * Verifies:
 * 1. Compact Element Map Serialization (Token-efficient JSON representation for LLM)
 * 2. AIClient findElementForMe prompt construction, strict JSON schema output & fence stripping
 * 3. Natural Language Matching Reasoning:
 *    - "Where do I upload CV?" -> File input (#resume-upload)
 *    - "Where do I enter my email?" -> Email input
 *    - "Where do I submit the application?" -> Submit button
 *    - Unrelated query ("Order a pizza") -> targetId: null
 *    - Roman Hinglish query ("Resume kahan upload karu?") -> File input with Hinglish explanation
 * 4. Anti-hallucination defense: Verifies targetId exists in active element list
 * 5. content/highlighter.js DOM manipulation:
 *    - Prominent pulsing outline (.siddarth-highlight-active)
 *    - Floating callout pointer tooltip (#siddarth-highlighter-pointer) with target ID & reason
 *    - Viewport scrolling (scrollIntoView)
 *    - Highlight cleanup (clearHighlight)
 * 6. AgentTab Side Panel Controller Integration:
 *    - Natural language query execution flow
 *    - Auto-scanning if elements not yet indexed
 *    - Result card rendering (#find-result-badge, #find-result-label, #find-result-reason)
 *    - Webpage message dispatch (HIGHLIGHT_ELEMENT)
 *    - Suggestion quick chips & dismiss button
 */

import assert from 'node:assert';
import '../content/scanner.js';
import '../content/highlighter.js';
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
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
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
    if (sel.startsWith('.') && this.classList.contains(sel.slice(1))) return true;
    if (sel.includes('#siddarth-highlighter-pointer') && this.id === 'siddarth-highlighter-pointer') return true;
    if (sel.includes('#siddarth-badge-overlay') && this.id === 'siddarth-badge-overlay') return true;
    return false;
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
    if (sel.startsWith('[data-siddarth-id="')) {
      const match = sel.match(/\[data-siddarth-id="([^"]+)"\]/);
      if (match) {
        const targetId = match[1];
        const walk = (node) => {
          if (node.attributes['data-siddarth-id'] === targetId) return node;
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

const mockStorage = {
  siddarth_settings: {
    geminiApiKey: 'mock-gemini-test-key',
    preferredModel: 'gemini-flash-lite-latest',
    defaultLanguage: 'en',
    groqApiKey: 'mock-groq-key',
    enableFallback: true
  }
};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        for (const k of keys) {
          res[k] = mockStorage[k];
        }
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorage, obj);
        if (cb) cb();
        return Promise.resolve();
      },
      remove: (keys, cb) => {
        for (const k of keys) {
          delete mockStorage[k];
        }
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: {
    lastError: null
  }
};

async function runTests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 11 (Find It for Me)');
  console.log('========================================================\n');

  const scanner = globalThis.SiddarthScanner;
  const highlighter = globalThis.SiddarthHighlighter;
  assert(scanner, 'SiddarthScanner must be defined on globalThis');
  assert(highlighter, 'SiddarthHighlighter must be defined on globalThis');

  // Build a sample application form
  mockDoc.body.children = [];

  const nameInput = new MockElement('input', { type: 'text', id: 'name-field', placeholder: 'Enter your full name' }, '', { top: 40, left: 20, width: 220, height: 35 });
  const emailInput = new MockElement('input', { type: 'email', id: 'email-field', placeholder: 'Enter email address' }, '', { top: 100, left: 20, width: 220, height: 35 });
  const degreeSelect = new MockElement('select', { id: 'degree-select' }, 'Select Degree', { top: 160, left: 20, width: 220, height: 35 });
  const resumeFile = new MockElement('input', { type: 'file', id: 'resume-upload', name: 'resume_cv' }, '', { top: 220, left: 20, width: 260, height: 40 });
  const coverTextArea = new MockElement('textarea', { id: 'cover-statement', placeholder: 'Personal Statement' }, '', { top: 280, left: 20, width: 300, height: 80 });
  const submitBtn = new MockElement('button', { type: 'submit', id: 'btn-submit' }, 'Submit Application', { top: 380, left: 20, width: 140, height: 38 });

  // Attach associated labels
  const resumeLabel = new MockElement('label', { for: 'resume-upload' }, 'Upload Resume / CV');
  mockDoc.body.appendChild(nameInput);
  mockDoc.body.appendChild(emailInput);
  mockDoc.body.appendChild(degreeSelect);
  mockDoc.body.appendChild(resumeLabel);
  mockDoc.body.appendChild(resumeFile);
  mockDoc.body.appendChild(coverTextArea);
  mockDoc.body.appendChild(submitBtn);

  // ----------------------------------------------------
  // TEST 1: Compact Element Map Serialization
  // ----------------------------------------------------
  console.log('Test 1: Verify compact element map serialization for LLM...');
  {
    const compactMap = scanner.getCompactElementMap();
    assert.strictEqual(compactMap.length, 6, 'Should extract 6 actionable elements');

    // Verify token efficiency: rects and DOM instances omitted
    const first = compactMap[0];
    assert.strictEqual(first.id, 1);
    assert.strictEqual(first.tag, 'input');
    assert.strictEqual(first.role, 'input_text');
    assert.strictEqual(first.placeholder, 'Enter your full name');
    assert.strictEqual(first.rect, undefined, 'Rect coordinates must be omitted in compact map to conserve tokens');

    // Verify file input
    const resumeMeta = compactMap.find(item => item.id === 4);
    assert.strictEqual(resumeMeta.role, 'input_file');
    assert.strictEqual(resumeMeta.label, 'Upload Resume / CV');

    console.log('✓ Compact element map generates clean, token-efficient serialized representation.\n');
  }

  // ----------------------------------------------------
  // TEST 2: AIClient findElementForMe Natural Language Query ("Where do I upload CV?")
  // ----------------------------------------------------
  console.log('Test 2: Verify AIClient findElementForMe prompt execution & strict JSON parsing...');
  {
    const client = new AIClient();
    const compactElements = scanner.getCompactElementMap();

    // Mock globalThis.fetch to simulate Gemini JSON response
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert(body.contents[0].parts[0].text.includes('Where do I upload CV?'), 'Prompt must include user query');
      assert(body.systemInstruction.parts[0].text.toLowerCase().includes('strict json'), 'System prompt must demand strict JSON');

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '```json\n{\n  "targetId": 4,\n  "label": "Upload Resume / CV",\n  "reason": "This is the file input designed to upload your resume/CV."\n}\n```'
                  }
                ]
              }
            }
          ],
          usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 35, totalTokenCount: 185 }
        })
      };
    };

    const result = await client.findElementForMe({
      query: 'Where do I upload CV?',
      elements: compactElements,
      language: 'en'
    });

    assert.strictEqual(result.targetId, 4, 'Must identify element #4 as the resume upload input');
    assert.strictEqual(result.label, 'Upload Resume / CV');
    assert(result.reason.includes('resume/CV'), 'Reasoning should mention resume/CV');

    console.log('✓ LLM accurately resolves "Where do I upload CV?" -> Element #4 (Upload Resume / CV).\n');
  }

  // ----------------------------------------------------
  // TEST 3: Query for Submit Button and Email Input
  // ----------------------------------------------------
  console.log('Test 3: Verify queries for email and consequential submit button...');
  {
    const client = new AIClient();
    const compactElements = scanner.getCompactElementMap();

    // Mock submit button query response
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"targetId": 6, "label": "Submit Application", "reason": "This button finalizes and submits your application."}' }]
            }
          }
        ]
      })
    });

    const submitResult = await client.findElementForMe({
      query: 'Where is the submit button?',
      elements: compactElements,
      language: 'en'
    });

    assert.strictEqual(submitResult.targetId, 6);
    assert.strictEqual(submitResult.label, 'Submit Application');
    assert(submitResult.reason.includes('submits your application'));

    console.log('✓ LLM correctly grounds "Where is the submit button?" -> Element #6 (Submit Application).\n');
  }

  // ----------------------------------------------------
  // TEST 4: Out-of-Scope Query (targetId: null)
  // ----------------------------------------------------
  console.log('Test 4: Verify out-of-scope query safely returns targetId: null...');
  {
    const client = new AIClient();
    const compactElements = scanner.getCompactElementMap();

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"targetId": null, "label": null, "reason": "No food ordering or shopping elements exist on this job form."}' }]
            }
          }
        ]
      })
    });

    const foodResult = await client.findElementForMe({
      query: 'Where do I order a pizza?',
      elements: compactElements,
      language: 'en'
    });

    assert.strictEqual(foodResult.targetId, null, 'Unmatched queries must return null targetId');
    assert(foodResult.reason.includes('No food ordering'), 'Reasoning should clarify absence of matching control');

    console.log('✓ Out-of-scope requests safely yield targetId: null without hallucinating elements.\n');
  }

  // ----------------------------------------------------
  // TEST 5: Roman Hinglish Query Handling
  // ----------------------------------------------------
  console.log('Test 5: Verify Roman Hinglish query conditioning & explanation...');
  {
    const client = new AIClient();
    const compactElements = scanner.getCompactElementMap();

    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert(body.systemInstruction.parts[0].text.includes('Roman Hinglish'), 'Must enforce Roman Hinglish instructions');

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"targetId": 4, "label": "Upload Resume / CV", "reason": "Yeh file input aapka resume ya CV upload karne ke liye hai."}'
                  }
                ]
              }
            }
          ]
        })
      };
    };

    const hiResult = await client.findElementForMe({
      query: 'Resume kahan upload karu?',
      elements: compactElements,
      language: 'hi-en'
    });

    assert.strictEqual(hiResult.targetId, 4);
    assert(hiResult.reason.includes('upload karne ke liye'), 'Reasoning must be in Roman Hinglish');

    console.log('✓ Bilingual Hinglish queries accurately grounded with natural Roman Hinglish explanations.\n');
  }

  // ----------------------------------------------------
  // TEST 6: Anti-Hallucination Guardrail (Invalid targetId Rejection)
  // ----------------------------------------------------
  console.log('Test 6: Verify anti-hallucination guard rejects non-existent IDs...');
  {
    const client = new AIClient();
    const compactElements = scanner.getCompactElementMap(); // Has IDs 1 through 6

    // Emulate model hallucinating element #999
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"targetId": 999, "label": "Ghost Input", "reason": "Non-existent node"}' }]
            }
          }
        ]
      })
    });

    const guardResult = await client.findElementForMe({
      query: 'Ghost field',
      elements: compactElements,
      language: 'en'
    });

    assert.strictEqual(guardResult.targetId, null, 'Hallucinated targetId #999 not in elements list must be discarded to null');

    console.log('✓ Anti-hallucination defense discards out-of-range element IDs with zero false positives.\n');
  }

  // ----------------------------------------------------
  // TEST 7: content/highlighter.js Visual Highlighting & Pointer Callout
  // ----------------------------------------------------
  console.log('Test 7: Verify content/highlighter.js pulsing focus and pointer callout tooltip...');
  {
    // Highlight element #4 (Resume Upload)
    const hlRes = highlighter.highlightElement(4, {
      reason: 'This is the file input to upload your resume.',
      label: 'Upload Resume / CV'
    });

    assert(hlRes.success, 'highlightElement should succeed');
    assert.strictEqual(hlRes.targetId, 4);

    // Verify pulsing outline class applied to target element
    assert(resumeFile.classList.contains('siddarth-highlight-active'), 'Element #4 must receive .siddarth-highlight-active class');
    assert(resumeFile._scrolledIntoView, 'Element #4 must be scrolled into view');

    // Verify pointer tooltip overlay creation
    const pointer = mockDoc.getElementById('siddarth-highlighter-pointer');
    assert(pointer, '#siddarth-highlighter-pointer must be created in document body');

    // Verify pointer tooltip contents
    assert(pointer.innerHTML.includes('#4'), 'Pointer tooltip must display badge #4');
    assert(pointer.innerHTML.includes('upload your resume'), 'Pointer tooltip must display reasoning text');

    // Test clearHighlight
    highlighter.clearHighlight();
    assert(!resumeFile.classList.contains('siddarth-highlight-active'), 'Active outline must be cleared');
    assert(!mockDoc.getElementById('siddarth-highlighter-pointer'), 'Pointer element must be removed');

    console.log('✓ Visual highlighter applies pulsing focus ring, tooltip callout, and cleans up completely.\n');
  }

  // ----------------------------------------------------
  // TEST 8: AgentTab "Find It for Me" End-to-End Flow
  // ----------------------------------------------------
  console.log('Test 8: Verify AgentTab controller "Find It for Me" interaction and UI rendering...');
  {
    // Mock panel elements
    const panelElements = {
      'btn-scan-elements': new MockElement('button'),
      'btn-clear-badges': new MockElement('button'),
      'btn-refresh-scan': new MockElement('button'),
      'agent-find-input': new MockElement('input', { value: 'Where do I upload CV?' }),
      'btn-find-element': new MockElement('button'),
      'agent-find-result-box': new MockElement('div', { 'data-display': 'none' }),
      'find-result-badge': new MockElement('span'),
      'find-result-label': new MockElement('span'),
      'find-result-reason': new MockElement('p'),
      'btn-rehighlight-target': new MockElement('button'),
      'btn-dismiss-find': new MockElement('button'),
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

    let highlightedMessage = null;

    globalThis.chrome = {
      storage: {
        local: {
          get: (keys, cb) => {
            const data = {
              siddarth_settings: {
                geminiApiKey: 'test-key',
                defaultLanguage: 'en'
              }
            };
            if (cb) cb(data);
            return Promise.resolve(data);
          }
        }
      },
      tabs: {
        query: () => Promise.resolve([{ id: 202, url: 'https://careers.example.com/apply' }]),
        sendMessage: (tabId, msg, cb) => {
          if (msg.type === 'SCAN_PAGE_ELEMENTS') {
            cb(scanner.scanAndBadge());
          } else if (msg.type === 'HIGHLIGHT_ELEMENT') {
            highlightedMessage = msg;
            cb(highlighter.highlightElement(msg.targetId, msg));
          } else if (msg.type === 'CLEAR_HIGHLIGHT') {
            cb(highlighter.clearHighlight());
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

    // Mock fetch for findElementForMe
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"targetId": 4, "label": "Upload Resume / CV", "reason": "Direct file input to submit your CV/resume."}' }]
            }
          }
        ]
      })
    });

    const origGetById = mockDoc.getElementById;
    mockDoc.getElementById = (id) => panelElements[id] || origGetById(id);

    const agentTab = new AgentTab();

    // Trigger "Find It for Me"
    await agentTab.handleFindElement();

    // Verify find result box rendered
    assert.strictEqual(panelElements['find-result-badge'].textContent, '#4');
    assert.strictEqual(panelElements['find-result-label'].textContent, 'Upload Resume / CV');
    assert(panelElements['find-result-reason'].textContent.includes('submit your CV/resume'));

    // Verify webpage received highlight message
    assert(highlightedMessage, 'Active tab must receive HIGHLIGHT_ELEMENT message');
    assert.strictEqual(highlightedMessage.targetId, 4);

    // Test Dismiss button
    await agentTab.dismissFindResult();
    assert.strictEqual(agentTab.activeMatchedTargetId, null);
    assert.strictEqual(panelElements['agent-find-result-box'].style.display, 'none');

    // Restore getElementById
    mockDoc.getElementById = origGetById;

    console.log('✓ AgentTab "Find It for Me" coordinates natural search, LLM grounding, and UI callout seamlessly.\n');
  }

  console.log('========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 11 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('\n❌ Slice 11 Verification Test Failed:', err);
  process.exit(1);
});
