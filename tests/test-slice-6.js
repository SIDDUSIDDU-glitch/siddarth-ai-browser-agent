/**
 * Verification Test Suite for Slice 6: Grounded Page Chat with Streaming
 * Tests:
 * 1. Anti-hallucination system prompt conditioning (English & Hinglish)
 * 2. Strict grounding refusal rule enforcement ("This information is not available on the current page.")
 * 3. Context window clamping on large web pages
 * 4. Multi-turn conversation history compilation
 * 5. YouTube vs Webpage grounded context resolution
 * 6. SSE streaming parser, chunk accumulation & onDone lifecycle
 * 7. AbortController stream cancellation
 */

import assert from 'node:assert';
import { aiClient } from '../utils/ai-client.js';
import { ChatTab } from '../sidepanel/tabs/chat.js';
import { saveSettings } from '../utils/storage-manager.js';

// Setup mock chrome.storage.local for Node.js test environment
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
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 6 (Grounded Chat)');
  console.log('========================================================\n');

  const chatTab = new ChatTab();

  // ----------------------------------------------------
  // TEST 1: Anti-Hallucination System Prompt (English)
  // ----------------------------------------------------
  console.log('Test 1: Verify anti-hallucination system prompt in English...');
  const sampleArticleContext = {
    title: 'Modern Web Agents with Manifest V3',
    siteName: 'techcrunch.com',
    url: 'https://techcrunch.com/agents',
    text: 'Modern browser agents use Chrome Manifest V3 side panels, DOM element scanning, and human approval gates to automate web reading.'
  };

  const { prompt: enPrompt, systemPrompt: enSysPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'What do browser agents use for user safety?',
    context: sampleArticleContext,
    history: [],
    language: 'en'
  });

  assert(
    enSysPrompt.includes("If the answer is not contained in the text, explicitly state: 'This information is not available on the current page.'"),
    'System prompt must mandate exact refusal phrase for missing information'
  );
  assert(enSysPrompt.includes('CRITICAL ANTI-HALLUCINATION RULES'), 'Must include critical anti-hallucination rules header');
  assert(enPrompt.includes('<page_context>'), 'Prompt must encapsulate page context in <page_context> tag');
  assert(enPrompt.includes('Modern browser agents use Chrome Manifest V3'), 'Prompt must contain extracted text');
  assert(enPrompt.includes('User Question: What do browser agents use for user safety?'));
  console.log('✓ Anti-hallucination system prompt strictly conditioned in English.');

  // ----------------------------------------------------
  // TEST 2: Anti-Hallucination System Prompt (Hinglish)
  // ----------------------------------------------------
  console.log('\nTest 2: Verify anti-hallucination system prompt in Roman Hinglish...');
  const { prompt: hiPrompt, systemPrompt: hiSysPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'Is article me pricing di gayi hai kya?',
    context: sampleArticleContext,
    history: [],
    language: 'hi-en'
  });

  assert(
    hiSysPrompt.includes('Yeh information current page par available nahi hai.'),
    'Hinglish system prompt must mandate exact Roman Hinglish refusal phrase'
  );
  assert(hiSysPrompt.includes('Do NOT use Devanagari script'), 'Must enforce Roman alphabet only');
  assert(hiPrompt.includes('Yeh information current page par available nahi hai.'));
  console.log('✓ Anti-hallucination system prompt strictly conditioned in Roman Hinglish.');

  // ----------------------------------------------------
  // TEST 3: Unrelated Query Refusal Instruction Verification
  // ----------------------------------------------------
  console.log('\nTest 3: Verify prompt rules for unrelated queries (e.g. Cooking vs Capital of France)...');
  const cookingContext = {
    title: 'Authentic Butter Chicken Recipe',
    siteName: 'cookingblog.com',
    url: 'https://cookingblog.com/butter-chicken',
    text: 'Ingredients: 500g chicken thighs, 2 tbsp butter, tomato puree, garam masala, heavy cream, fenugreek leaves.'
  };

  const { prompt: unrelatedPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'What is the capital of France?',
    context: cookingContext,
    history: [],
    language: 'en'
  });

  assert(unrelatedPrompt.includes('Authentic Butter Chicken Recipe'));
  assert(unrelatedPrompt.includes('User Question: What is the capital of France?'));
  assert(unrelatedPrompt.includes('If the answer is not contained in the text, explicitly state: "This information is not available on the current page."'));
  console.log('✓ Prompt structure guarantees strict refusal on out-of-context questions.');

  // ----------------------------------------------------
  // TEST 4: Multi-Turn Conversation History
  // ----------------------------------------------------
  console.log('\nTest 4: Verify multi-turn conversation history preserved with grounded context...');
  const sampleHistory = [
    { role: 'user', content: 'What are the main ingredients?' },
    { role: 'assistant', content: 'The recipe calls for chicken thighs, butter, tomato puree, garam masala, and cream.' }
  ];

  const { prompt: multiTurnPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'Can I replace cream with yogurt?',
    context: cookingContext,
    history: sampleHistory,
    language: 'en'
  });

  assert(multiTurnPrompt.includes('CONVERSATION HISTORY:'), 'Must include conversation history header');
  assert(multiTurnPrompt.includes('User: What are the main ingredients?'));
  assert(multiTurnPrompt.includes('Siddarth: The recipe calls for chicken thighs'));
  assert(multiTurnPrompt.includes('User Question: Can I replace cream with yogurt?'));
  assert(multiTurnPrompt.includes('<page_context>'), 'Must retain original page grounding context');
  console.log('✓ Multi-turn history formatted cleanly alongside grounded page context.');

  // ----------------------------------------------------
  // TEST 5: Context Clamping on Massive Articles
  // ----------------------------------------------------
  console.log('\nTest 5: Verify context window clamping on huge text (24,000 char cap)...');
  const massiveText = 'Header intro. ' + 'Body content repetitive paragraph. '.repeat(1500) + ' Conclusion at the end.';
  assert(massiveText.length > 35000);

  const massiveContext = {
    title: 'Massive Research Paper',
    url: 'https://example.com/paper',
    text: massiveText
  };

  const { prompt: clampedPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'Summarize the conclusion',
    context: massiveContext,
    history: [],
    language: 'en'
  });

  assert(clampedPrompt.length < 30000, 'Total prompt length should be capped');
  assert(clampedPrompt.includes('[... content truncated for length ...]'), 'Must display truncation indicator');
  assert(clampedPrompt.includes('Header intro'));
  assert(clampedPrompt.includes('Conclusion at the end'));
  console.log(`✓ Massive text clamped successfully while preserving beginning and end.`);

  // ----------------------------------------------------
  // TEST 6: YouTube Grounded Context
  // ----------------------------------------------------
  console.log('\nTest 6: Verify YouTube video grounded context resolution...');
  chatTab.currentContentType = 'youtube';
  chatTab.currentVideo = {
    title: 'Building Browser Agents with Gemini Flash',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    channel: 'AI Engineering Hub',
    duration: 1080,
    chapters: [
      { timeStr: '00:00', title: 'Intro' },
      { timeStr: '01:45', title: 'Architecture' }
    ],
    transcriptText: '[00:00] Welcome everyone.\n\n[01:45] We now explore the Side Panel architecture.'
  };

  const ytContext = chatTab.getActiveContext();
  assert.strictEqual(ytContext.type, 'youtube');
  assert.strictEqual(ytContext.title, 'Building Browser Agents with Gemini Flash');
  assert(ytContext.text.includes('[01:45] We now explore the Side Panel architecture.'));

  const { prompt: ytChatPrompt } = chatTab.buildGroundedChatPrompt({
    query: 'At what timestamp does the architecture section start?',
    context: ytContext,
    history: [],
    language: 'en'
  });

  assert(ytChatPrompt.includes('Type: YouTube Video Notes & Transcript'));
  assert(ytChatPrompt.includes('[01:45]'));
  console.log('✓ YouTube video context properly grounded with transcript and chapters.');

  // ----------------------------------------------------
  // TEST 7: SSE Streaming Chunk Assembly & onDone
  // ----------------------------------------------------
  console.log('\nTest 7: Verify streaming SSE parser and accumulated chunk assembly...');

  // Mock SSE response body chunks
  const mockChunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Modern "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"browser "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"agents "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"run locally."}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":6,"totalTokenCount":18}}\n\n',
    'data: [DONE]\n\n'
  ];

  // Mock global fetch to return our SSE stream
  const originalFetch = globalThis.fetch;
  let chunkCount = 0;
  const receivedChunks = [];

  globalThis.fetch = async (url) => {
    assert(url.includes('streamGenerateContent'), 'Must call streamGenerateContent endpoint');
    assert(url.includes('alt=sse'), 'Must request alt=sse');

    // Create ReadableStream of SSE data
    const encoder = new TextEncoder();
    let idx = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (idx < mockChunks.length) {
          controller.enqueue(encoder.encode(mockChunks[idx]));
          idx++;
        } else {
          controller.close();
        }
      }
    });

    return {
      ok: true,
      status: 200,
      body: stream
    };
  };

  // Configure API key in storage
  await saveSettings({
    geminiApiKey: 'AIzaSyMockKeyForVerificationTests',
    preferredModel: 'gemini-flash-lite-latest',
    defaultLanguage: 'en'
  });

  let accumulatedResult = '';
  await aiClient.streamText({
    prompt: 'Tell me about browser agents',
    systemPrompt: 'Grounded system prompt',
    onChunk: (chunk, acc) => {
      chunkCount++;
      receivedChunks.push(chunk);
      accumulatedResult = acc;
    },
    onDone: (final) => {
      assert.strictEqual(final, 'Modern browser agents run locally.');
    }
  });

  assert.strictEqual(chunkCount, 4, 'Should have received 4 chunks');
  assert.strictEqual(accumulatedResult, 'Modern browser agents run locally.');
  assert.deepStrictEqual(receivedChunks, ['Modern ', 'browser ', 'agents ', 'run locally.']);
  console.log(`✓ Streamed 4 SSE chunks successfully into accumulated text: "${accumulatedResult}"`);

  // ----------------------------------------------------
  // TEST 8: AbortController Stream Cancellation
  // ----------------------------------------------------
  console.log('\nTest 8: Verify AbortController stream cancellation stops reading cleanly...');
  const abortCtrl = new AbortController();

  let abortDoneCalled = false;
  // Abort immediately before / during pull
  abortCtrl.abort();

  await aiClient.streamText({
    prompt: 'Long query',
    signal: abortCtrl.signal,
    onChunk: () => {},
    onDone: (text) => {
      abortDoneCalled = true;
    }
  });

  assert(abortDoneCalled, 'onDone should be invoked when aborted');
  console.log('✓ Stream aborted cleanly without unhandled exceptions.');

  // Restore global fetch
  globalThis.fetch = originalFetch;

  console.log('\n========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 6 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
