/**
 * CLI Test script for Live Gemini and Groq API Keys
 * Reads GEMINI_API_KEY and GROQ_API_KEY from .env
 * Usage: node tests/test-live-gemini.js
 */

import { AIClient } from '../utils/ai-client.js';

// Auto-load .env in Node 20.6+ if present
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env file is optional
  }
}

const geminiKey = process.argv[2] || process.env.GEMINI_API_KEY;
const groqKey = process.argv[3] || process.env.GROQ_API_KEY;

async function runLiveVerification() {
  console.log('=== Live API Key Verification ===\n');

  const client = new AIClient();

  // 1. Test Gemini
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    const masked = geminiKey.length > 8 ? `${geminiKey.slice(0, 6)}...${geminiKey.slice(-4)}` : '***';
    console.log(`[1/2] Testing Gemini API Key (${masked})...`);
    try {
      const res = await client.testConnection(geminiKey, 'gemini-flash-lite-latest');
      console.log('   ✅ Gemini Connected successfully!');
      console.log(`      Model:    ${res.model}`);
      console.log(`      Reply:    "${res.reply}" (${res.latencyMs}ms, ${res.tokens.totalTokens} tokens)\n`);
    } catch (err) {
      console.log(`   ❌ Gemini check: ${err.message}`);
      if (!geminiKey.startsWith('AIzaSy')) {
        console.log('      💡 Note: Google AI Studio Gemini API keys typically start with "AIzaSy...".');
        console.log('      Get a free key at: https://aistudio.google.com/apikey\n');
      }
    }
  } else {
    console.log('[1/2] Gemini API Key: Not configured in .env\n');
  }

  // 2. Test Groq
  if (groqKey && groqKey !== 'your_groq_api_key_here') {
    const maskedGroq = groqKey.length > 8 ? `${groqKey.slice(0, 6)}...${groqKey.slice(-4)}` : '***';
    console.log(`[2/2] Testing Groq API Key (${maskedGroq})...`);
    try {
      const res = await client.testGroqConnection(groqKey);
      console.log('   ✅ Groq Connected successfully!');
      console.log(`      Model:    ${res.model}`);
      console.log(`      Reply:    "${res.reply}" (${res.latencyMs}ms, ${res.tokens.totalTokens} tokens)\n`);
    } catch (err) {
      console.log(`   ❌ Groq check: ${err.message}\n`);
    }
  } else {
    console.log('[2/2] Groq API Key: Not configured in .env\n');
  }
}

runLiveVerification();
