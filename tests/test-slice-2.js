/**
 * Verification test suite for Slice 2: Gemini Text API Integration
 * Tests:
 * 1. AIClient initialization & configuration
 * 2. buildEndpoint formatting (generateContent vs streamGenerateContent)
 * 3. buildSystemPrompt (English & Hinglish directives)
 * 4. Error formatting (400 invalid key, 403 forbidden, 404 model, 429 rate limit, 503 unavailable)
 * 5. Token usage tracking (storage-manager + aiClient in-memory & persistence)
 * 6. testConnection verification ("Ping" sample prompt -> "Pong" response with tokens & latency)
 * 7. generateText execution & retry handling
 */

import assert from 'node:assert';
import { AIClient, SUPPORTED_MODELS } from '../utils/ai-client.js';
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  DEFAULT_TOKEN_USAGE,
  getSettings,
  saveSettings,
  getTokenUsage,
  recordTokenUsage,
  resetTokenUsage
} from '../utils/storage-manager.js';

// Setup mock chrome.storage.local for Node environment
const mockStorage = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        for (const k of keys) {
          res[k] = mockStorage[k];
        }
        cb(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorage, obj);
        cb && cb();
      },
      remove: (keys, cb) => {
        for (const k of keys) {
          delete mockStorage[k];
        }
        cb && cb();
      }
    }
  },
  runtime: {
    lastError: null
  }
};

async function runTests() {
  console.log('--- Starting Slice 2 Verification Tests ---');

  const client = new AIClient();

  // Test 1: Supported Models Definition
  console.log('Test 1: Verify supported models map...');
  assert.strictEqual(SUPPORTED_MODELS.GEMINI_FLASH_LITE, 'gemini-flash-lite-latest');
  assert.strictEqual(SUPPORTED_MODELS.GEMINI_FLASH, 'gemini-flash-latest');
  assert.strictEqual(client.resolveModel('gemini-2.0-flash-lite'), 'gemini-flash-lite-latest');
  assert.strictEqual(client.resolveModel('llama-3.3-70b-versatile'), 'openai/gpt-oss-120b');
  console.log('✓ Supported models verified.');

  // Test 2: buildEndpoint formatting
  console.log('Test 2: Verify endpoint URL construction...');
  const normalUrl = client.buildEndpoint('gemini-2.0-flash-lite', 'AIzaFakeKey123', false);
  assert.strictEqual(
    normalUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=AIzaFakeKey123'
  );

  const streamUrl = client.buildEndpoint('gemini-2.0-flash-lite', 'AIzaFakeKey123', true);
  assert.strictEqual(
    streamUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse&key=AIzaFakeKey123'
  );
  console.log('✓ Endpoint URLs correctly formatted.');

  // Test 3: System prompt compilation
  console.log('Test 3: Verify system prompt conditioning for English and Hinglish...');
  const enPrompt = client.buildSystemPrompt('Summarize this.', 'en');
  assert(enPrompt.includes('Respond in clear, crisp, professional English.'));
  assert(enPrompt.includes('You are Siddarth'));

  const hiPrompt = client.buildSystemPrompt('Summarize this.', 'hi-en');
  assert(hiPrompt.includes('LANGUAGE DIRECTIVE (CRITICAL)'));
  assert(hiPrompt.includes('Roman Hinglish'));
  console.log('✓ System prompts correctly conditioned.');

  // Test 4: API Error formatting
  console.log('Test 4: Verify friendly API error formatting...');
  const err400 = client.formatApiError(400, { error: { message: 'API_KEY_INVALID' } }, 'gemini-2.0-flash-lite');
  assert(err400.includes('Invalid Gemini API key'));

  const err403 = client.formatApiError(403, {}, 'gemini-2.0-flash-lite');
  assert(err403.includes('Permission Denied'));

  const err404 = client.formatApiError(404, {}, 'gemini-custom');
  assert(err404.includes('Model "gemini-custom" not found'));

  const err429 = client.formatApiError(429, {}, 'gemini-2.0-flash-lite');
  assert(err429.includes('rate limit exceeded'));

  const err503 = client.formatApiError(503, {}, 'gemini-2.0-flash-lite');
  assert(err503.includes('temporarily unavailable'));
  console.log('✓ Error messages cleanly categorized.');

  // Test 5: Token usage recording and retrieval
  console.log('Test 5: Verify token usage tracking in storage & client...');
  await client.resetTokenUsage();
  let usage = await client.getTokenUsage();
  assert.strictEqual(usage.totalTokens, 0);
  assert.strictEqual(usage.requestCount, 0);

  await client.recordUsage({ promptTokens: 15, candidatesTokens: 25, totalTokens: 40 });
  usage = await client.getTokenUsage();
  assert.strictEqual(usage.promptTokens, 15);
  assert.strictEqual(usage.candidatesTokens, 25);
  assert.strictEqual(usage.totalTokens, 40);
  assert.strictEqual(usage.requestCount, 1);

  await client.recordUsage({ promptTokens: 10, candidatesTokens: 10 }); // totalTokens auto-computed
  usage = await client.getTokenUsage();
  assert.strictEqual(usage.promptTokens, 25);
  assert.strictEqual(usage.candidatesTokens, 35);
  assert.strictEqual(usage.totalTokens, 60);
  assert.strictEqual(usage.requestCount, 2);

  await client.resetTokenUsage();
  usage = await client.getTokenUsage();
  assert.strictEqual(usage.totalTokens, 0);
  assert.strictEqual(usage.requestCount, 0);
  console.log('✓ Token usage tracking persists and resets accurately.');

  // Test 6: testConnection with mocked fetch ("Ping" -> "Pong")
  console.log('Test 6: Verify testConnection sends "Ping" and returns verified result...');
  const originalFetch = globalThis.fetch;

  let capturedUrl = '';
  let capturedBody = null;

  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Pong' }]
            },
            finishReason: 'STOP'
          }
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          totalTokenCount: 7
        }
      })
    };
  };

  const testResult = await client.testConnection('test-key-xyz', 'gemini-2.0-flash-lite');

  assert.strictEqual(testResult.success, true);
  assert.strictEqual(testResult.model, 'gemini-flash-lite-latest');
  assert.strictEqual(testResult.reply, 'Pong');
  assert.strictEqual(testResult.tokens.totalTokens, 7);
  assert(testResult.latencyMs >= 0);

  // Check captured payload
  assert(capturedUrl.includes('gemini-flash-lite-latest:generateContent?key=test-key-xyz'));
  assert.strictEqual(capturedBody.contents[0].parts[0].text, 'Ping');
  console.log(`✓ testConnection verified: reply="${testResult.reply}", latency=${testResult.latencyMs}ms, tokens=${testResult.tokens.totalTokens}`);

  // Test 7: testConnection error handling
  console.log('Test 7: Verify testConnection error handling on 400 Invalid Key...');
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: { message: 'API_KEY_INVALID: Key not valid. Please pass a valid API key.' }
    })
  });

  await assert.rejects(
    async () => {
      await client.testConnection('invalid-key', 'gemini-2.0-flash-lite');
    },
    /Invalid Gemini API key/
  );
  console.log('✓ testConnection rejected invalid key with clear message.');

  // Test 8: generateText with usage tracking
  console.log('Test 8: Verify generateText returns response and tracks usage...');
  await saveSettings({ geminiApiKey: 'valid-stored-key', preferredModel: 'gemini-2.0-flash-lite' });

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: 'This is the generated text summary.' }]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 30,
        totalTokenCount: 80
      }
    })
  });

  const generatedText = await client.generateText({ prompt: 'Summarize web' });
  assert.strictEqual(generatedText, 'This is the generated text summary.');

  const finalUsage = await client.getTokenUsage();
  assert(finalUsage.totalTokens >= 80);
  console.log(`✓ generateText succeeded. Cumulative tokens tracked: ${finalUsage.totalTokens}`);

  // Test 9: Safety finishReason detection
  console.log('Test 9: Verify safety block detection in candidate finishReason...');
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          finishReason: 'SAFETY',
          content: { parts: [{ text: '' }] }
        }
      ]
    })
  });

  await assert.rejects(
    async () => {
      await client.generateText({ prompt: 'unsafe prompt' });
    },
    /safety policy|filtered by safety/i
  );
  console.log('✓ Safety blocking correctly intercepted.');

  // Test 10: Rate limit (HTTP 429) fallback to Groq
  console.log('Test 10: Verify HTTP 429 rate limit triggers Groq fallback when enabled...');
  await saveSettings({
    geminiApiKey: 'valid-gemini-key',
    enableFallback: true,
    groqApiKey: 'valid-groq-key'
  });

  let groqCalled = false;
  globalThis.fetch = async (url) => {
    if (url.includes('googleapis.com')) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Quota exceeded' } })
      };
    }
    if (url.includes('groq.com')) {
      groqCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Response from Groq Llama fallback' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      };
    }
    throw new Error('Unknown endpoint');
  };

  const fallbackOutput = await client.generateText({ prompt: 'Heavy prompt' });
  assert.strictEqual(groqCalled, true);
  assert.strictEqual(fallbackOutput, 'Response from Groq Llama fallback');
  console.log('✓ HTTP 429 gracefully fell back to Groq Llama model.');

  // Test 11: testGroqConnection
  console.log('Test 11: Verify testGroqConnection sends "Ping" and returns verified result...');
  globalThis.fetch = async (url, options) => {
    assert(url.includes('api.groq.com'));
    const body = JSON.parse(options.body);
    assert.strictEqual(body.messages[1].content, 'Ping');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Pong' } }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
      })
    };
  };

  const groqTestResult = await client.testGroqConnection('gsk_test_key_123');
  assert.strictEqual(groqTestResult.success, true);
  assert.strictEqual(groqTestResult.reply, 'Pong');
  assert.strictEqual(groqTestResult.tokens.totalTokens, 5);
  console.log('✓ testGroqConnection verified: reply="Pong", tokens=5');

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log('\n--- All Slice 2 Verification Tests Passed Successfully! ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
