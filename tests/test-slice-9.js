/**
 * Verification Test Suite for Slice 9: Free-Tier Resilience & Fallback Engine
 * Tests:
 * 1. 3-stage exponential backoff delay calculation and randomized jitter
 * 2. Transient HTTP 429 recovery (succeeds on retry within 3 attempts)
 * 3. Persistent HTTP 429 auto-fallback to Groq API (llama-3.3-70b-versatile)
 * 4. Transient HTTP 503 (Service Unavailable) retry and Groq fallback
 * 5. Streaming SSE resilience (Gemini 429 -> Groq SSE streaming fallback)
 * 6. Fallback disabled behavior (clear error indicating retries exhausted)
 * 7. Groq missing key behavior (actionable guidance to add key in Settings)
 * 8. Multimodal vision protection (no text-only Groq dispatch for images)
 * 9. SettingsTab Groq configuration, model selection, and status badge updates
 */

import assert from 'node:assert';
import { AIClient, SUPPORTED_MODELS } from '../utils/ai-client.js';
import { SettingsTab } from '../sidepanel/tabs/settings.js';
import { saveSettings } from '../utils/storage-manager.js';

// Setup mock chrome storage
const mockStorage = {
  siddarth_settings: {
    geminiApiKey: 'mock-gemini-key',
    preferredModel: 'gemini-flash-lite-latest',
    groqApiKey: 'mock-groq-key',
    groqModel: 'llama-3.3-70b-versatile',
    enableFallback: true,
    defaultLanguage: 'en'
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
  console.log('Starting Verification Tests: Slice 9 (Resilience & Fallback)');
  console.log('========================================================\n');

  // ----------------------------------------------------
  // TEST 1: Exponential Backoff & Jitter Math
  // ----------------------------------------------------
  console.log('Test 1: Verify exponential backoff delay calculation and jitter...');
  {
    const client = new AIClient();

    // Test with explicit base 1000ms
    const d0 = client.calculateBackoffDelay(0, 1000, 400); // 1000 + (0..400)
    const d1 = client.calculateBackoffDelay(1, 1000, 400); // 2000 + (0..400)
    const d2 = client.calculateBackoffDelay(2, 1000, 400); // 4000 + (0..400)

    // Verify progression in test mode (or custom base)
    assert(d1 > d0, `Stage 2 delay (${d1}ms) must exceed Stage 1 (${d0}ms)`);
    assert(d2 > d1, `Stage 3 delay (${d2}ms) must exceed Stage 2 (${d1}ms)`);

    // Verify jitter randomization (two calls for same attempt should vary)
    const samples = [];
    for (let i = 0; i < 5; i++) {
      samples.push(client.calculateBackoffDelay(1, 1000, 500));
    }
    const hasVariation = samples.some(s => s !== samples[0]);
    assert(hasVariation, 'Jitter must introduce randomization into backoff intervals');

    console.log(`✓ 3-stage exponential delays verified (Stage 0: ${d0}ms, Stage 1: ${d1}ms, Stage 2: ${d2}ms).\n`);
  }

  // ----------------------------------------------------
  // TEST 2: Transient 429 Recovery with Retry
  // ----------------------------------------------------
  console.log('Test 2: Verify transient HTTP 429 recovery (succeeds on retry attempt 2)...');
  {
    const client = new AIClient();
    let geminiAttempts = 0;
    let groqAttempted = false;

    globalThis.fetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiAttempts++;
        if (geminiAttempts < 2) {
          // Attempt 1 fails with 429
          return {
            status: 429,
            ok: false,
            json: async () => ({ error: { message: 'Resource temporarily rate-limited.' } })
          };
        }
        // Attempt 2 succeeds
        return {
          status: 200,
          ok: true,
          json: async () => ({
            candidates: [
              { content: { parts: [{ text: 'Gemini recovered after transient rate limit.' }] } }
            ]
          })
        };
      }
      if (url.includes('api.groq.com')) {
        groqAttempted = true;
        return { ok: false };
      }
      return { ok: false };
    };

    const reply = await client.generateText({ prompt: 'Hello transient rate limit' });
    assert.strictEqual(geminiAttempts, 2, 'Should succeed on retry attempt 2');
    assert(!groqAttempted, 'Should NOT fall back to Groq when Gemini recovers within retry threshold');
    assert.strictEqual(reply, 'Gemini recovered after transient rate limit.');

    console.log('✓ Transient rate limit absorbed by backoff retry without unnecessary fallback.\n');
  }

  // ----------------------------------------------------
  // TEST 3: Persistent 429 Auto-Fallback to Groq
  // ----------------------------------------------------
  console.log('Test 3: Verify persistent HTTP 429 auto-fallback to Groq API (llama-3.3-70b-versatile)...');
  {
    const client = new AIClient();
    let geminiAttempts = 0;
    let groqAttempts = 0;
    let fallbackNotified = null;

    globalThis.fetch = async (url, options) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiAttempts++;
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: { message: 'Quota exhausted for model.' } })
        };
      }
      if (url.includes('api.groq.com')) {
        groqAttempts++;
        const body = JSON.parse(options.body);
        assert.strictEqual(body.messages[1].content, 'Persistent limit prompt');
        return {
          status: 200,
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Seamless response from Groq Cloud fallback.' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
          })
        };
      }
      return { ok: false };
    };

    const reply = await client.generateText({
      prompt: 'Persistent limit prompt',
      onFallback: (info) => {
        fallbackNotified = info;
      }
    });

    assert.strictEqual(geminiAttempts, 3, 'Should attempt 3 stages on Gemini before falling back');
    assert.strictEqual(groqAttempts, 1, 'Should call Groq fallback once');
    assert.strictEqual(reply, 'Seamless response from Groq Cloud fallback.');
    assert(fallbackNotified, 'Should notify onFallback callback');
    assert.strictEqual(fallbackNotified.provider, 'groq');

    console.log('✓ 3-stage retry exhausted -> seamless secondary dispatch to Groq with zero UI crash.\n');
  }

  // ----------------------------------------------------
  // TEST 4: Transient 503 (Service Unavailable) Recovery & Fallback
  // ----------------------------------------------------
  console.log('Test 4: Verify transient HTTP 503 (Service Unavailable) retry & Groq fallback...');
  {
    const client = new AIClient();
    let geminiCalls = 0;
    let groqCalled = false;

    globalThis.fetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCalls++;
        return {
          status: 503,
          ok: false,
          json: async () => ({ error: { message: 'The model is overloaded. Please try again later.' } })
        };
      }
      if (url.includes('api.groq.com')) {
        groqCalled = true;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Saved by Groq during Gemini 503 outage.' } }],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
          })
        };
      }
      return { ok: false };
    };

    const reply = await client.generateText({ prompt: 'Overloaded test' });
    assert.strictEqual(geminiCalls, 3, 'Should retry 503 across 3 backoff stages');
    assert.strictEqual(groqCalled, true, 'Should fall back to Groq during service outage');
    assert.strictEqual(reply, 'Saved by Groq during Gemini 503 outage.');

    console.log('✓ HTTP 503 transient errors retried and successfully rescued by Groq fallback.\n');
  }

  // ----------------------------------------------------
  // TEST 5: Streaming SSE Resilience (streamText with Groq SSE Fallback)
  // ----------------------------------------------------
  console.log('Test 5: Verify streamText real-time SSE streaming fallback to Groq...');
  {
    const client = new AIClient();
    const chunks = [];
    let completedText = '';
    let fallbackInfo = null;

    globalThis.fetch = async (url, options) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        // Return 429 on stream endpoint
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: { message: 'Stream rate limit exceeded.' } })
        };
      }
      if (url.includes('api.groq.com')) {
        const body = JSON.parse(options.body);
        assert(body.stream, 'Must request SSE stream from Groq');

        // Emulate Groq SSE stream
        const groqSse = [
          'data: {"choices":[{"delta":{"content":"Groq "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"streaming "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"fallback working."}}]}\n\n',
          'data: [DONE]\n\n'
        ].join('');

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(groqSse));
            controller.close();
          }
        });

        return {
          status: 200,
          ok: true,
          body: stream
        };
      }
      return { ok: false };
    };

    await client.streamText({
      prompt: 'Test streaming rate limit',
      onFallback: (info) => {
        fallbackInfo = info;
      },
      onChunk: (chunk, acc) => {
        chunks.push(chunk);
      },
      onDone: (final) => {
        completedText = final;
      }
    });

    assert(fallbackInfo, 'Must trigger onFallback in streamText');
    assert.strictEqual(chunks.length, 3, 'Must stream 3 real-time chunks from Groq');
    assert.strictEqual(completedText, 'Groq streaming fallback working.');

    console.log('✓ streamText seamlessly transitions to real-time Groq SSE stream on 429.\n');
  }

  // ----------------------------------------------------
  // TEST 6: Fallback Disabled Behavior
  // ----------------------------------------------------
  console.log('Test 6: Verify behavior when fallback is disabled...');
  {
    const client = new AIClient();
    await saveSettings({ enableFallback: false, groqApiKey: 'mock-key' });

    globalThis.fetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: { message: 'Rate limit exceeded' } })
        };
      }
      return { ok: false };
    };

    let errorThrown = null;
    try {
      await client.generateText({ prompt: 'No fallback test' });
    } catch (err) {
      errorThrown = err;
    }

    assert(errorThrown, 'Should throw error when fallback is disabled');
    assert(errorThrown.message.includes('429'), 'Error must mention HTTP 429');
    assert(errorThrown.message.includes('retry attempts exhausted'), 'Error must note retries exhausted');

    // Restore fallback
    await saveSettings({ enableFallback: true, groqApiKey: 'mock-groq-key' });
    console.log('✓ Graceful error message presented when fallback is intentionally disabled.\n');
  }

  // ----------------------------------------------------
  // TEST 7: Missing Groq Key Handling
  // ----------------------------------------------------
  console.log('Test 7: Verify behavior when Groq key is not configured...');
  {
    const client = new AIClient();
    await saveSettings({ enableFallback: true, groqApiKey: '' });

    globalThis.fetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: { message: 'Rate limit exceeded' } })
        };
      }
      return { ok: false };
    };

    let errorThrown = null;
    try {
      await client.generateText({ prompt: 'Missing groq key test' });
    } catch (err) {
      errorThrown = err;
    }

    assert(errorThrown, 'Should throw error when Groq key is empty');
    assert(errorThrown.message.includes('Groq fallback in Settings'), 'Should prompt user to add Groq key');

    // Restore
    await saveSettings({ groqApiKey: 'mock-groq-key' });
    console.log('✓ Actionable user guidance provided when fallback key is missing.\n');
  }

  // ----------------------------------------------------
  // TEST 8: Multimodal Vision Protection
  // ----------------------------------------------------
  console.log('Test 8: Verify vision tasks never dispatch to text-only Groq...');
  {
    const client = new AIClient();
    let groqInvoked = false;

    globalThis.fetch = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: { message: 'Vision quota exceeded.' } })
        };
      }
      if (url.includes('api.groq.com')) {
        groqInvoked = true;
        return { ok: false };
      }
      return { ok: false };
    };

    let caughtError = null;
    await client.streamScreenshot({
      prompt: 'Check this image',
      imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      onError: (err) => {
        caughtError = err;
      }
    });

    assert(!groqInvoked, 'Must NOT invoke text-only Groq for image/multimodal input');
    assert(caughtError, 'Must report error to caller');

    console.log('✓ Multimodal requests safely guarded against text-only Groq fallback.\n');
  }

  // ----------------------------------------------------
  // TEST 9: SettingsTab Fallback Engine Configuration & Status Badge
  // ----------------------------------------------------
  console.log('Test 9: Verify SettingsTab configuration, model selection, and status badge...');
  {
    const mockElements = {
      'setting-gemini-key': { value: 'test-gemini-key', type: 'password', addEventListener: () => {} },
      'setting-groq-key': { value: 'gsk_test_key', type: 'password', addEventListener: () => {} },
      'setting-model-select': { value: 'gemini-flash-lite-latest', addEventListener: () => {} },
      'setting-groq-model-select': { value: 'llama-3.3-70b-versatile', addEventListener: () => {} },
      'setting-fallback-toggle': { checked: true, addEventListener: () => {} },
      'fallback-status-badge': { className: '', textContent: '' },
      'setting-max-steps': { value: '10', addEventListener: () => {} },
      'setting-dry-run-toggle': { checked: false, addEventListener: () => {} },
      'btn-save-settings': { addEventListener: () => {} },
      'btn-test-gemini': { addEventListener: () => {} },
      'btn-test-groq': { addEventListener: () => {} },
      'test-result-box': { style: {}, textContent: '' },
      'test-groq-result-box': { style: {}, textContent: '' }
    };

    globalThis.document = {
      getElementById: (id) => mockElements[id] || null,
      querySelectorAll: () => []
    };

    const settingsTab = new SettingsTab();
    await settingsTab.loadSettings();

    // Verify status badge with key present & fallback enabled
    settingsTab.updateFallbackStatusBadge();
    assert(mockElements['fallback-status-badge'].textContent.includes('Fallback Active'));
    assert.strictEqual(mockElements['fallback-status-badge'].className, 'badge badge-accent');

    // Verify status badge when key is empty
    mockElements['setting-groq-key'].value = '';
    settingsTab.updateFallbackStatusBadge();
    assert(mockElements['fallback-status-badge'].textContent.includes('Key Required'));
    assert.strictEqual(mockElements['fallback-status-badge'].className, 'badge badge-warning');

    // Verify status badge when fallback toggle is disabled
    mockElements['setting-fallback-toggle'].checked = false;
    settingsTab.updateFallbackStatusBadge();
    assert(mockElements['fallback-status-badge'].textContent.includes('Fallback Disabled'));
    assert.strictEqual(mockElements['fallback-status-badge'].className, 'badge badge-neutral');

    console.log('✓ SettingsTab status badge dynamically reflects fallback configuration state.\n');
  }

  console.log('========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 9 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err);
  process.exit(1);
});

