/**
 * AI Client for Siddarth AI Browser Assistant
 * Handles direct calls to Google Gemini API (AI Studio) and Groq Cloud Fallback.
 * Includes rate-limit resilience, retry with exponential backoff, streaming,
 * and comprehensive token usage tracking.
 */

import { getSettings, recordTokenUsage, getTokenUsage, resetTokenUsage } from './storage-manager.js';

export const SUPPORTED_MODELS = {
  GEMINI_FLASH_LITE: 'gemini-flash-lite-latest',
  GEMINI_35_FLASH_LITE: 'gemini-3.5-flash-lite',
  GEMINI_FLASH: 'gemini-flash-latest',
  GEMINI_38_FLASH: 'gemini-3.8-flash',
  GROQ_PRIMARY: 'openai/gpt-oss-120b',
  GROQ_FAST: 'openai/gpt-oss-20b',
  GROQ_QWEN: 'qwen/qwen3.8-27b',
  // Backward compatibility keys
  'gemini-2.0-flash-lite': 'gemini-flash-lite-latest',
  'gemini-2.0-flash': 'gemini-flash-latest',
  'gemini-1.5-flash': 'gemini-flash-lite-latest',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b'
};

const MODEL_ALIASES = {
  'gemini-2.0-flash-lite': 'gemini-flash-lite-latest',
  'gemini-2.0-flash': 'gemini-flash-latest',
  'gemini-1.5-flash': 'gemini-flash-lite-latest',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b'
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';

export class AIClient {
  constructor() {
    this.cachedSettings = null;
    this.baseRetryDelay = 1000;
    this.sessionTokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      requestCount: 0
    };
  }

  /**
   * Computes exponential backoff delay with randomized jitter (Slice 9)
   * Formula: (2 ^ attempt) * baseDelay + random_jitter
   * Stages: 0 -> ~1s, 1 -> ~2s, 2 -> ~4s
   * @param {number} attempt Attempt index (0, 1, 2)
   * @param {number} baseDelayMs Base delay in milliseconds
   * @param {number} maxJitterMs Maximum random jitter added
   * @returns {number} Delay in milliseconds
   */
  calculateBackoffDelay(attempt = 0, baseDelayMs = 1000, maxJitterMs = 400) {
    const isTestMode = typeof process !== 'undefined' && !process.env?.SIDDARTH_REAL_DELAY;
    const effectiveBase = isTestMode ? 15 : (this.baseRetryDelay || baseDelayMs);
    const effectiveJitterMax = isTestMode ? 10 : maxJitterMs;
    const exponential = Math.pow(2, attempt) * effectiveBase;
    const jitter = Math.random() * effectiveJitterMax;
    return Math.round(exponential + jitter);
  }

  /**
   * Resolves model aliases to currently active API endpoints
   */
  resolveModel(modelName) {
    if (!modelName) return 'gemini-flash-lite-latest';
    return MODEL_ALIASES[modelName] || modelName;
  }

  /**
   * Retrieves active user settings from local storage
   */
  async getActiveSettings() {
    this.cachedSettings = await getSettings();
    return this.cachedSettings;
  }

  /**
   * Formats Google Gemini API endpoint URL
   * @param {string} model
   * @param {string} apiKey
   * @param {boolean} isStreaming
   * @returns {string}
   */
  buildEndpoint(model, apiKey, isStreaming = false) {
    const action = isStreaming ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:${action}key=${encodeURIComponent(apiKey)}`;
  }

  /**
   * Prepares system prompt with language and persona guidelines
   */
  buildSystemPrompt(baseSystemPrompt = '', language = 'en') {
    let languageInstruction = '';

    if (language === 'hi-en') {
      languageInstruction = `
LANGUAGE DIRECTIVE (CRITICAL):
- NATURAL ROMAN HINGLISH: You MUST respond in conversational Roman Hinglish (natural Hindi written in the English alphabet, blended smoothly with standard English technical terms).
- Strictly use the Roman script (English alphabet). Do NOT output Devanagari script (no हिन्दी लिपि).
- Example for articles: "Yeh article explain karta hai ki AI agents kaise browser automate kar sakte hain...", "Pehle 5 key takeaways yeh hain...", "Ab aapko yeh action items dekhne chahiye...".
- Example for YouTube: "Is video me speaker discuss kar rahe hain ki...", "Key chapters aur timestamps niche diye gaye hain...", "Aage yeh steps follow karein...".
- Keep technical terms (e.g. DOM, API, URL, credentials, architecture, algorithm, backend, frontend, database) in English.
- Make it sound natural, helpful, conversational, and culturally authentic for an Indian developer or student.`;
    } else {
      languageInstruction = `
LANGUAGE DIRECTIVE:
- Respond in clear, crisp, professional English.`;
    }

    const persona = `You are Siddarth, an expert, context-aware AI browser companion running inside Google Chrome. You help users comprehend web pages, summarize articles and YouTube videos, and assist with controlled browser actions. Always maintain accuracy and refuse to invent details not present in the provided context.`;

    return `${persona}\n${languageInstruction}\n\n${baseSystemPrompt}`.trim();
  }

  /**
   * Formats API error messages into user-friendly explanations
   */
  formatApiError(status, errorData = {}, model = '') {
    const rawMessage = errorData.error?.message || '';

    if (status === 400) {
      if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('API key not valid') || rawMessage.includes('INVALID_ARGUMENT')) {
        return 'Invalid Gemini API key. Please verify your API key in Google AI Studio.';
      }
      return `Bad Request (HTTP 400): ${rawMessage || 'Malformed request payload.'}`;
    }

    if (status === 403) {
      return 'Permission Denied (HTTP 403): Ensure the Generative Language API is enabled for your API key in Google AI Studio / Google Cloud.';
    }

    if (status === 404) {
      return `Model "${model}" not found (HTTP 404). Please verify the model name or select another model in Settings.`;
    }

    if (status === 429) {
      return 'Gemini API rate limit exceeded (HTTP 429). Please wait a moment or configure Groq fallback in Settings.';
    }

    if (status === 500 || status === 503) {
      return `Gemini service temporarily unavailable (HTTP ${status}). Please try again in a few moments.`;
    }

    return rawMessage ? `Gemini API Error: ${rawMessage}` : `API Error (HTTP ${status})`;
  }

  /**
   * Records token consumption in memory and persistent storage
   */
  async recordUsage({ promptTokens = 0, candidatesTokens = 0, totalTokens = 0 }) {
    const calcTotal = totalTokens || (promptTokens + candidatesTokens);
    this.sessionTokenUsage.promptTokens += promptTokens;
    this.sessionTokenUsage.candidatesTokens += candidatesTokens;
    this.sessionTokenUsage.totalTokens += calcTotal;
    this.sessionTokenUsage.requestCount += 1;

    try {
      return await recordTokenUsage({ promptTokens, candidatesTokens, totalTokens: calcTotal });
    } catch (err) {
      console.warn('[Siddarth] Could not persist token usage to storage:', err);
      return this.sessionTokenUsage;
    }
  }

  /**
   * Returns cumulative token usage from storage
   */
  async getTokenUsage() {
    try {
      return await getTokenUsage();
    } catch {
      return this.sessionTokenUsage;
    }
  }

  /**
   * Resets token usage counters
   */
  async resetTokenUsage() {
    this.sessionTokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      requestCount: 0
    };
    try {
      return await resetTokenUsage();
    } catch {
      return this.sessionTokenUsage;
    }
  }

  /**
   * Verifies Gemini API connectivity using a sample "Ping" prompt
   * @param {string|null} customApiKey Optional explicit key (e.g. from input before saving)
   * @param {string|null} customModel Optional model identifier
   * @returns {Promise<{success: boolean, model: string, reply: string, latencyMs: number, tokens: object}>}
   */
  async testConnection(customApiKey = null, customModel = null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Network offline. Please check your internet connection and try again.');
    }

    const settings = await this.getActiveSettings();
    const apiKey = (customApiKey || settings.geminiApiKey || '').trim();

    if (!apiKey) {
      throw new Error('Gemini API key is missing. Please enter your API key.');
    }

    let targetModel = this.resolveModel(customModel || settings.preferredModel || SUPPORTED_MODELS.GEMINI_FLASH_LITE);
    let endpoint = this.buildEndpoint(targetModel, apiKey, false);

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Ping' }]
        }
      ],
      systemInstruction: {
        parts: [{ text: "You are a connectivity test assistant. Respond with the single word 'Pong' and nothing else." }]
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 30
      }
    };

    const startTime = performance.now();

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Auto-fallback if specific model name is deprecated or 404
      if (!response.ok && (response.status === 404 || response.status === 400)) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData.error?.message || '';
        if ((rawMsg.includes('not found') || rawMsg.includes('no longer available')) && targetModel !== 'gemini-flash-lite-latest') {
          console.warn(`[Siddarth] Model ${targetModel} unavailable (${rawMsg}). Retrying with gemini-flash-lite-latest...`);
          targetModel = 'gemini-flash-lite-latest';
          endpoint = this.buildEndpoint(targetModel, apiKey, false);
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
        } else {
          const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
          throw new Error(formattedMsg);
        }
      }

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
        throw new Error(formattedMsg);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];

      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        if (candidate.finishReason === 'SAFETY') {
          throw new Error('Test prompt was blocked by Gemini safety filters.');
        }
      }

      const reply = candidate?.content?.parts?.[0]?.text?.trim() || '';
      if (!reply) {
        throw new Error('Gemini returned an empty response.');
      }

      // Track usage metadata if available
      const usage = data.usageMetadata || {};
      const tokens = {
        promptTokens: usage.promptTokenCount || 0,
        candidatesTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || ((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0))
      };

      await this.recordUsage(tokens);

      return {
        success: true,
        model: targetModel,
        reply,
        latencyMs,
        tokens
      };
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        throw new Error('Network error: Unable to reach Google Gemini API. Please check your connection.');
      }
      throw err;
    }
  }

  /**
   * Verifies Groq API connectivity using a sample "Ping" prompt
   * @param {string|null} customApiKey Optional explicit key (e.g. from input before saving)
   * @param {string|null} customModel Optional Groq model identifier
   * @returns {Promise<{success: boolean, model: string, reply: string, latencyMs: number, tokens: object}>}
   */
  async testGroqConnection(customApiKey = null, customModel = null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Network offline. Please check your internet connection and try again.');
    }

    const settings = await this.getActiveSettings();
    const apiKey = (customApiKey || settings.groqApiKey || '').trim();

    if (!apiKey) {
      throw new Error('Groq API key is missing. Please enter your Groq API key.');
    }

    let targetModel = this.resolveModel(customModel || settings.groqModel || SUPPORTED_MODELS.GROQ_PRIMARY);
    const startTime = performance.now();

    try {
      let response = await fetch(GROQ_API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: "You are a connectivity test assistant. Respond with the single word 'Pong' and nothing else." },
            { role: 'user', content: 'Ping' }
          ],
          max_tokens: 30,
          temperature: 0.1
        })
      });

      // Auto-fallback if specific Groq model name is missing or unavailable
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const rawMsg = errData.error?.message || '';
        if ((rawMsg.includes('does not exist') || rawMsg.includes('not have access') || response.status === 404) && targetModel !== 'openai/gpt-oss-120b') {
          console.warn(`[Siddarth] Groq model ${targetModel} unavailable (${rawMsg}). Retrying with openai/gpt-oss-120b...`);
          targetModel = 'openai/gpt-oss-120b';
          response = await fetch(GROQ_API_BASE, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: targetModel,
              messages: [
                { role: 'system', content: "You are a connectivity test assistant. Respond with the single word 'Pong' and nothing else." },
                { role: 'user', content: 'Ping' }
              ],
              max_tokens: 30,
              temperature: 0.1
            })
          });
        }
      }

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.error?.message || `Groq API Error (HTTP ${response.status})`;
        throw new Error(msg);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || '';

      const usage = data.usage || {};
      const tokens = {
        promptTokens: usage.prompt_tokens || 0,
        candidatesTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))
      };

      await this.recordUsage(tokens);

      return {
        success: true,
        model: targetModel,
        reply,
        latencyMs,
        tokens
      };
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        throw new Error('Network error: Unable to reach Groq Cloud API. Please check your connection.');
      }
      throw err;
    }
  }

  /**
   * Core non-streaming generation via Gemini with 3-stage backoff and Groq fallback (Slice 9)
   */
  async generateText({
    prompt,
    systemPrompt = '',
    model = null,
    language = null,
    temperature = 0.4,
    maxTokens = 2048,
    retryCount = 0,
    maxRetries = 3,
    onFallback = null
  }) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Network offline. Cannot generate response while disconnected.');
    }

    const settings = await this.getActiveSettings();
    const apiKey = settings.geminiApiKey?.trim();

    if (!apiKey) {
      throw new Error('Gemini API key is missing. Please configure your API key in Siddarth Settings.');
    }

    let targetModel = this.resolveModel(model || settings.preferredModel || SUPPORTED_MODELS.GEMINI_FLASH_LITE);
    const targetLang = language || settings.defaultLanguage || 'en';
    const compiledSystemPrompt = this.buildSystemPrompt(systemPrompt, targetLang);

    let endpoint = this.buildEndpoint(targetModel, apiKey, false);

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: compiledSystemPrompt }]
      },
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Handle model deprecation / 404 auto-fallback
      if (!response.ok && (response.status === 404 || response.status === 400)) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData.error?.message || '';
        if ((rawMsg.includes('not found') || rawMsg.includes('no longer available')) && targetModel !== 'gemini-flash-lite-latest') {
          console.warn(`[Siddarth] Model ${targetModel} unavailable (${rawMsg}). Retrying with gemini-flash-lite-latest...`);
          targetModel = 'gemini-flash-lite-latest';
          endpoint = this.buildEndpoint(targetModel, apiKey, false);
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
        }
      }

      // Error Interceptor for Rate Limits (HTTP 429) & Transient Server Errors (HTTP 500 / 503)
      if (response.status === 429 || response.status === 503 || response.status === 500) {
        const isRateLimit = response.status === 429;
        const errType = isRateLimit ? 'Rate Limit (HTTP 429)' : `Transient Server Error (HTTP ${response.status})`;

        console.warn(`[Siddarth] Gemini ${errType} encountered (attempt ${retryCount + 1} of ${maxRetries}).`);

        // Stage 1 to 3: Exponential backoff with jitter retry
        if (retryCount < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(retryCount);
          console.log(`[Siddarth] Backoff retry scheduled in ${delay}ms (Stage ${retryCount + 1})...`);
          await new Promise((res) => setTimeout(res, delay));
          return await this.generateText({
            prompt,
            systemPrompt,
            model: targetModel,
            language: targetLang,
            temperature,
            maxTokens,
            retryCount: retryCount + 1,
            maxRetries,
            onFallback
          });
        }

        // Secondary Dispatch: Auto-fallback to Groq API if configured and enabled
        if (settings.enableFallback && settings.groqApiKey?.trim()) {
          const fallbackModel = settings.groqModel || 'llama-3.3-70b-versatile';
          console.warn(`[Siddarth] Gemini retries exhausted. Secondary dispatching to Groq Cloud fallback (${fallbackModel})...`);
          onFallback?.({ provider: 'groq', model: fallbackModel });
          return await this.callGroqFallback({
            prompt,
            systemPrompt: compiledSystemPrompt,
            temperature
          });
        }

        // If no fallback is enabled or configured, throw clean actionable message
        const message = isRateLimit
          ? 'Gemini API rate limit exceeded (HTTP 429). 3 retry attempts exhausted. Please wait a moment or configure Groq fallback in Settings.'
          : `Gemini service is temporarily unavailable (HTTP ${response.status}). Retries exhausted. Please try again shortly or enable Groq fallback in Settings.`;
        throw new Error(message);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
        throw new Error(formattedMsg);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];

      if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
        if (candidate.finishReason === 'SAFETY') {
          throw new Error('Content generation blocked by Gemini safety policy.');
        }
      }

      const responseText = candidate?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response. The content may have been filtered by safety settings.');
      }

      // Track token usage
      if (data.usageMetadata) {
        const tokens = {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0
        };
        await this.recordUsage(tokens);
      }

      return responseText.trim();
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        throw new Error('Network error: Unable to connect to Gemini API. Please check your connection.');
      }
      throw err;
    }
  }

  /**
   * Generation helper returning response text alongside token metadata
   */
  async generateTextWithMetadata(options) {
    const startTime = performance.now();
    const text = await this.generateText(options);
    const latencyMs = Math.round(performance.now() - startTime);
    const usage = await this.getTokenUsage();

    return {
      text,
      latencyMs,
      usage,
      model: options.model || (await this.getActiveSettings()).preferredModel || SUPPORTED_MODELS.GEMINI_FLASH_LITE
    };
  }

  /**
   * Streaming generation using Server-Sent Events (SSE) with 3-stage backoff & Groq fallback (Slice 9)
   */
  async streamText({
    prompt,
    contents = null,
    systemPrompt = '',
    model = null,
    language = null,
    temperature = 0.4,
    signal = null,
    retryCount = 0,
    maxRetries = 3,
    onFallback = null,
    onChunk,
    onDone,
    onError
  }) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onError?.(new Error('Network offline. Please check your internet connection.'));
      return;
    }

    const settings = await this.getActiveSettings();
    const apiKey = settings.geminiApiKey?.trim();

    if (!apiKey) {
      onError?.(new Error('Gemini API key is not configured. Please open Settings and enter your key.'));
      return;
    }

    let targetModel = this.resolveModel(model || settings.preferredModel || SUPPORTED_MODELS.GEMINI_FLASH_LITE);
    const targetLang = language || settings.defaultLanguage || 'en';
    const compiledSystemPrompt = this.buildSystemPrompt(systemPrompt, targetLang);

    let endpoint = this.buildEndpoint(targetModel, apiKey, true);

    const formattedContents = contents && Array.isArray(contents) && contents.length > 0
      ? contents
      : [
          {
            role: 'user',
            parts: [{ text: prompt || '' }]
          }
        ];

    const requestBody = {
      contents: formattedContents,
      systemInstruction: {
        parts: [{ text: compiledSystemPrompt }]
      },
      generationConfig: {
        temperature
      }
    };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal
      });

      // Handle model deprecation / 404 auto-fallback, and 503 overload fallback for specific model
      if (!response.ok && (response.status === 404 || response.status === 400 || (response.status === 503 && targetModel === 'gemini-flash-latest'))) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData.error?.message || '';
        if ((response.status === 503 || rawMsg.includes('not found') || rawMsg.includes('no longer available')) && targetModel !== 'gemini-flash-lite-latest') {
          console.warn(`[Siddarth] Model ${targetModel} unavailable in stream (${rawMsg || response.status}). Retrying with gemini-flash-lite-latest...`);
          targetModel = 'gemini-flash-lite-latest';
          endpoint = this.buildEndpoint(targetModel, apiKey, true);
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal
          });
        }
      }

      // Error Interceptor for Rate Limits (HTTP 429) & Transient Errors (HTTP 500 / 503)
      if (response.status === 429 || response.status === 503 || response.status === 500) {
        const isRateLimit = response.status === 429;
        const errType = isRateLimit ? 'Rate Limit (HTTP 429)' : `Transient Server Error (HTTP ${response.status})`;
        const hasImagePart = formattedContents.some(c => c.parts?.some(p => p.inlineData));

        console.warn(`[Siddarth] Gemini stream ${errType} encountered (attempt ${retryCount + 1} of ${maxRetries}).`);

        // Stage 1 to 3: Exponential backoff with jitter retry
        if (retryCount < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(retryCount);
          console.log(`[Siddarth] Backoff retry scheduled in ${delay}ms (Stage ${retryCount + 1})...`);
          await new Promise((res) => setTimeout(res, delay));
          if (signal?.aborted) return;
          return this.streamText({
            prompt,
            contents,
            systemPrompt,
            model: targetModel,
            language: targetLang,
            temperature,
            signal,
            retryCount: retryCount + 1,
            maxRetries,
            onFallback,
            onChunk,
            onDone,
            onError
          });
        }

        // Secondary Dispatch: Auto-fallback to Groq API if enabled, configured, and text-only
        if (settings.enableFallback && settings.groqApiKey?.trim() && !hasImagePart) {
          const fallbackModel = settings.groqModel || 'llama-3.3-70b-versatile';
          console.warn(`[Siddarth] Retries exhausted in stream. Secondary dispatching to Groq Cloud fallback (${fallbackModel})...`);
          onFallback?.({ provider: 'groq', model: fallbackModel });
          const fallbackPrompt = prompt || formattedContents[formattedContents.length - 1]?.parts?.[0]?.text || '';
          return this.streamGroqFallback({
            prompt: fallbackPrompt,
            systemPrompt: compiledSystemPrompt,
            temperature,
            signal,
            onChunk,
            onDone,
            onError
          });
        }

        const errorData = await response.json().catch(() => ({}));
        const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
        onError?.(new Error(formattedMsg));
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
        throw new Error(formattedMsg);
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        console.warn('[Siddarth] ReadableStream getReader not supported on response.body, falling back to non-streaming...');
        const hasImage = formattedContents.some(c => c.parts?.some(p => p.inlineData));
        if (hasImage) {
          const syncReply = await this.analyzeScreenshot({
            prompt: prompt || formattedContents[0]?.parts?.[0]?.text,
            imageBase64: formattedContents[0]?.parts?.find(p => p.inlineData)?.inlineData?.data,
            mimeType: formattedContents[0]?.parts?.find(p => p.inlineData)?.inlineData?.mimeType,
            systemPrompt,
            language: targetLang,
            model: targetModel
          });
          onChunk?.(syncReply, syncReply);
          onDone?.(syncReply);
          return;
        } else {
          const syncReply = await this.generateText({
            prompt,
            systemPrompt,
            model: targetModel,
            language: targetLang,
            temperature
          });
          onChunk?.(syncReply, syncReply);
          onDone?.(syncReply);
          return;
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let streamUsage = null;

      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep remainder in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') continue;

            try {
              const chunkData = JSON.parse(jsonStr);
              const chunkText = chunkData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (chunkText) {
                accumulatedText += chunkText;
                onChunk?.(chunkText, accumulatedText);
              }
              if (chunkData.usageMetadata) {
                streamUsage = chunkData.usageMetadata;
              }
            } catch {
              // Ignore partial JSON parse errors in chunk stream
            }
          }
        }
      }

      // If stream ended with no tokens and was multimodal, attempt analyzeScreenshot fallback
      if (!accumulatedText.trim() && !signal?.aborted) {
        const hasImage = formattedContents.some(c => c.parts?.some(p => p.inlineData));
        if (hasImage) {
          console.warn('[Siddarth] Multimodal stream ended with empty output, falling back to analyzeScreenshot...');
          try {
            const syncReply = await this.analyzeScreenshot({
              prompt: prompt || formattedContents[0]?.parts?.[0]?.text,
              imageBase64: formattedContents[0]?.parts?.find(p => p.inlineData)?.inlineData?.data,
              mimeType: formattedContents[0]?.parts?.find(p => p.inlineData)?.inlineData?.mimeType,
              systemPrompt,
              language: targetLang,
              model: targetModel
            });
            if (syncReply) {
              accumulatedText = syncReply;
              onChunk?.(syncReply, syncReply);
            }
          } catch (syncErr) {
            console.error('[Siddarth] analyzeScreenshot fallback after empty stream failed:', syncErr);
          }
        }
      }

      if (streamUsage) {
        await this.recordUsage({
          promptTokens: streamUsage.promptTokenCount || 0,
          candidatesTokens: streamUsage.candidatesTokenCount || 0,
          totalTokens: streamUsage.totalTokenCount || 0
        });
      }

      onDone?.(accumulatedText);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[Siddarth] Stream cancelled by user.');
        onDone?.('');
        return;
      }
      console.error('[Siddarth] Stream error:', err);
      onError?.(err);
    }
  }

  /**
   * Generates a vision system prompt customized for language & chart reasoning
   */
  buildVisionSystemPrompt(language = 'en') {
    const isHinglish = language === 'hi-en';
    if (isHinglish) {
      return `You are Siddarth, an expert multimodal visual intelligence assistant.
Examine the screenshot/image carefully and answer the user query in natural Roman Hinglish.
- Identify charts, axes, labels, values, errors, diagrams, and UI elements accurately.
- Do NOT use Devanagari script; write in conversational Roman Hinglish.
- If the image contains a chart (like a bar chart or line chart), read the exact labels, quantities, and months/categories directly from visual elements.`;
    }
    return `You are Siddarth, an expert multimodal visual intelligence assistant.
Examine the screenshot/image carefully and answer the user query accurately and directly.
- Identify charts, axes, labels, values, errors, diagrams, and UI elements with high precision.
- If the image contains a chart (like a bar chart or line chart), read the exact labels, quantities, and months/categories directly from visual elements.
- Be concise, factual, and clear.`;
  }

  /**
   * Multimodal Vision Analysis (Gemini Flash) - Single Request
   */
  async analyzeScreenshot({
    prompt,
    imageBase64,
    mimeType = 'image/png',
    systemPrompt = '',
    language = null,
    model = null
  }) {
    const settings = await this.getActiveSettings();
    const apiKey = settings.geminiApiKey?.trim();

    if (!apiKey) {
      throw new Error('Gemini API key is missing. Please configure your API key in Siddarth Settings.');
    }

    let targetModel = this.resolveModel(model || SUPPORTED_MODELS.GEMINI_FLASH); // Gemini Flash for vision
    const targetLang = language || settings.defaultLanguage || 'en';
    const visionSysPrompt = systemPrompt || this.buildVisionSystemPrompt(targetLang);
    const compiledSystemPrompt = this.buildSystemPrompt(visionSysPrompt, targetLang);

    const cleanBase64 = (imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    let endpoint = this.buildEndpoint(targetModel, apiKey, false);

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: (prompt || 'Describe and analyze this image.').trim() },
            {
              inlineData: {
                mimeType,
                data: cleanBase64
              }
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: compiledSystemPrompt }]
      }
    };

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    // Auto-fallback if model is overloaded (503), server error (500), or not found (404/400)
    if (!response.ok && (response.status === 503 || response.status === 500 || response.status === 404 || response.status === 400)) {
      if (targetModel !== 'gemini-flash-lite-latest') {
        console.warn(`[Siddarth] Vision model ${targetModel} returned HTTP ${response.status}. Retrying with gemini-flash-lite-latest...`);
        targetModel = 'gemini-flash-lite-latest';
        endpoint = this.buildEndpoint(targetModel, apiKey, false);
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
      } else if (response.status === 503 || response.status === 500) {
        console.warn(`[Siddarth] Vision model ${targetModel} overloaded. Retrying with gemini-3.5-flash-lite...`);
        targetModel = 'gemini-3.5-flash-lite';
        endpoint = this.buildEndpoint(targetModel, apiKey, false);
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
      }
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(this.formatApiError(response.status, errData, targetModel));
    }

    const data = await response.json();

    if (data.usageMetadata) {
      await this.recordUsage({
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0
      });
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  /**
   * Multimodal Vision Streaming Generation (Gemini Flash)
   */
  async streamScreenshot({
    prompt,
    imageBase64,
    mimeType = 'image/png',
    systemPrompt = '',
    language = null,
    model = null,
    temperature = 0.2,
    signal = null,
    onChunk,
    onDone,
    onError
  }) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onError?.(new Error('Network offline. Please check your internet connection.'));
      return;
    }

    const cleanBase64 = (imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    if (!cleanBase64) {
      onError?.(new Error('No valid image data provided for multimodal vision analysis.'));
      return;
    }

    const settings = await this.getActiveSettings();
    const targetModel = this.resolveModel(model || SUPPORTED_MODELS.GEMINI_FLASH);
    const targetLang = language || settings.defaultLanguage || 'en';
    const visionSysPrompt = systemPrompt || this.buildVisionSystemPrompt(targetLang);
    const visionPrompt = (prompt || 'Describe and analyze this image in detail.').trim();

    const contents = [
      {
        role: 'user',
        parts: [
          { text: visionPrompt },
          {
            inlineData: {
              mimeType,
              data: cleanBase64
            }
          }
        ]
      }
    ];

    let chunksEmitted = 0;
    return this.streamText({
      prompt: visionPrompt,
      contents,
      systemPrompt: visionSysPrompt,
      model: targetModel,
      language: targetLang,
      temperature,
      signal,
      onChunk: (chunk, acc) => {
        chunksEmitted++;
        onChunk?.(chunk, acc);
      },
      onDone: (finalText) => {
        onDone?.(finalText);
      },
      onError: async (err) => {
        const isRateLimit = err.message?.toLowerCase().includes('rate limit') || err.message?.includes('429');
        if (chunksEmitted === 0 && !signal?.aborted && !isRateLimit) {
          console.warn(`[Siddarth] Vision stream error (${err.message}). Attempting single-shot analyzeScreenshot fallback...`);
          try {
            const fallbackModel = (targetModel === 'gemini-flash-latest') ? 'gemini-flash-lite-latest' : targetModel;
            const singleShotReply = await this.analyzeScreenshot({
              prompt: visionPrompt,
              imageBase64: cleanBase64,
              mimeType,
              systemPrompt: visionSysPrompt,
              language: targetLang,
              model: fallbackModel
            });
            if (singleShotReply) {
              onChunk?.(singleShotReply, singleShotReply);
              onDone?.(singleShotReply);
              return;
            }
          } catch (singleErr) {
            console.error('[Siddarth] Single-shot vision fallback failed:', singleErr);
          }
        }
        onError?.(err);
      }
    });
  }

  /**
   * Groq Cloud Fallback Client (OpenAI-compatible)
   */
  async callGroqFallback({ prompt, systemPrompt = '', temperature = 0.4 }) {
    const settings = await this.getActiveSettings();
    const groqKey = settings.groqApiKey?.trim();

    if (!groqKey) {
      throw new Error('Groq fallback is enabled but no Groq API Key was provided in Settings.');
    }

    const targetModel = this.resolveModel(settings.groqModel || SUPPORTED_MODELS.GROQ_PRIMARY);
    const response = await fetch(GROQ_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Groq Fallback Error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();

    if (data.usage) {
      await this.recordUsage({
        promptTokens: data.usage.prompt_tokens || 0,
        candidatesTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      });
    }

    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  /**
   * Real-time streaming fallback to Groq Cloud using Server-Sent Events (SSE) (Slice 9)
   */
  async streamGroqFallback({
    prompt,
    systemPrompt = '',
    temperature = 0.4,
    signal = null,
    onChunk,
    onDone,
    onError
  }) {
    const settings = await this.getActiveSettings();
    const groqKey = settings.groqApiKey?.trim();

    if (!groqKey) {
      onError?.(new Error('Groq fallback is enabled but no Groq API Key was provided in Settings.'));
      return;
    }

    const targetModel = this.resolveModel(settings.groqModel || SUPPORTED_MODELS.GROQ_PRIMARY);

    try {
      const response = await fetch(GROQ_API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature,
          stream: true
        }),
        signal
      });

      if (!response.ok) {
        console.warn(`[Siddarth] Groq stream endpoint returned HTTP ${response.status}. Attempting non-streaming call...`);
        const syncReply = await this.callGroqFallback({ prompt, systemPrompt, temperature });
        onChunk?.(syncReply, syncReply);
        onDone?.(syncReply);
        return;
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const syncReply = await this.callGroqFallback({ prompt, systemPrompt, temperature });
        onChunk?.(syncReply, syncReply);
        onDone?.(syncReply);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') continue;

            try {
              const chunkData = JSON.parse(jsonStr);
              const delta = chunkData.choices?.[0]?.delta?.content || '';
              if (delta) {
                accumulatedText += delta;
                onChunk?.(delta, accumulatedText);
              }
            } catch {
              // Ignore partial JSON chunks
            }
          }
        }
      }

      const approxTokens = Math.max(1, Math.round(accumulatedText.length / 4));
      await this.recordUsage({
        promptTokens: Math.max(1, Math.round(prompt.length / 4)),
        candidatesTokens: approxTokens,
        totalTokens: Math.max(2, Math.round((prompt.length + accumulatedText.length) / 4))
      });

      onDone?.(accumulatedText);
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone?.('');
        return;
      }
      console.warn('[Siddarth] Groq stream error, falling back to non-streaming:', err);
      try {
        const syncReply = await this.callGroqFallback({ prompt, systemPrompt, temperature });
        onChunk?.(syncReply, syncReply);
        onDone?.(syncReply);
      } catch (finalErr) {
        onError?.(finalErr);
      }
    }
  }

  /**
   * Structured Element Selection ("Find It for Me") - Slice 11
   * Matches natural language queries (e.g. "Where do I submit my resume?") to a specific #ID
   * @param {object} options
   * @param {string} options.query User search query
   * @param {Array<object>} options.elements Scanned interactive elements map
   * @param {string|null} options.language 'en' or 'hi-en'
   * @returns {Promise<{targetId: number|null, label: string|null, reason: string}>}
   */
  async findElementForMe({ query, elements = [], language = null }) {
    if (!query || !query.trim()) {
      throw new Error('Query string is required for element selection.');
    }

    if (!Array.isArray(elements) || elements.length === 0) {
      return {
        targetId: null,
        label: null,
        reason: 'No interactive elements detected on the current webpage.'
      };
    }

    const settings = await this.getActiveSettings();
    const targetLang = language || settings.defaultLanguage || 'en';
    const isHinglish = targetLang === 'hi-en';

    // Build compact element representation for token efficiency
    const compactElements = elements.map(el => ({
      id: el.id,
      tag: el.tag,
      role: el.role,
      label: el.label,
      placeholder: el.placeholder || undefined,
      name: el.name || undefined,
      type: el.type || undefined,
      isConsequential: el.isConsequential ? true : undefined
    }));

    const systemPrompt = `You are Siddarth, an intelligent browser assistant specializing in DOM navigation and web element grounding.
Given a user natural language query and a list of interactive elements found on the active webpage, select the single best matching element by its sequential "#id".

CRITICAL INSTRUCTIONS:
1. Examine the user's intent carefully (e.g. "upload CV" maps to resume file inputs, "submit" maps to submit buttons, "login" maps to login links/buttons, "email" maps to email inputs).
2. You MUST respond with ONLY a strict JSON object with this exact schema:
{
  "targetId": <number or null>,
  "label": "<exact label or description of target element, or null>",
  "reason": "<concise explanation of why this element matches the user query>"
}
3. If no element on the page matches the query, return:
{
  "targetId": null,
  "label": null,
  "reason": "${isHinglish ? 'Is page par is query ke liye koi matching element nahi mila.' : 'No matching element found for this query on the current page.'}"
}
4. ${isHinglish ? 'Provide the "reason" explanation in natural, conversational Roman Hinglish (English alphabet, no Devanagari).' : 'Provide the "reason" explanation in clear, concise English.'}
5. Do NOT include any markdown fences or explanations outside the JSON object. Output valid JSON only.`;

    const userPrompt = `User Query: "${query.trim()}"

Interactive Elements on Page:
${JSON.stringify(compactElements, null, 2)}`;

    const rawResponse = await this.generateText({
      prompt: userPrompt,
      systemPrompt,
      temperature: 0.1,
      language: targetLang
    });

    // Clean JSON response (strip markdown fences if present)
    let cleaned = (rawResponse || '').trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);
      let targetId = null;
      if (typeof parsed.targetId === 'number' && Number.isInteger(parsed.targetId)) {
        // Verify element actually exists in list
        const exists = elements.some(el => el.id === parsed.targetId);
        if (exists) {
          targetId = parsed.targetId;
        }
      }

      return {
        targetId,
        label: parsed.label || (targetId ? elements.find(el => el.id === targetId)?.label : null),
        reason: parsed.reason || (targetId ? `Matched element #${targetId}` : 'No matching element found.')
      };
    } catch (parseErr) {
      console.warn('[Siddarth] Failed to parse element selection JSON:', cleaned, parseErr);
      // Fallback: heuristic regex search for "targetId": X
      const idMatch = cleaned.match(/"targetId"\s*:\s*(\d+)/);
      if (idMatch) {
        const id = parseInt(idMatch[1], 10);
        const matchedEl = elements.find(el => el.id === id);
        if (matchedEl) {
          return {
            targetId: id,
            label: matchedEl.label,
            reason: `Identified element #${id} as the target for "${query}".`
          };
        }
      }

      return {
        targetId: null,
        label: null,
        reason: 'Unable to parse selection result from AI model.'
      };
    }
  }

  /**
   * Human-in-the-Loop Action Planner - Slice 12
   * Analyzes current task, interactive elements on page, and prior step history
   * to propose exactly ONE atomic next action for user approval.
   * 
   * @param {object} options
   * @param {string} options.task High-level task description from user
   * @param {Array<object>} options.elements Scanned interactive elements on active page
   * @param {Array<object>} [options.stepHistory=[]] Completed or skipped steps in current session
   * @param {object|null} [options.profile=null] User profile memory for auto-form filling
   * @param {string|null} [options.language=null] 'en' or 'hi-en'
   * @returns {Promise<{action: string, targetId: number|null, value: string|null, label: string|null, reason: string, isConsequential: boolean}>}
   */
  async planNextStep({ task, elements = [], stepHistory = [], profile = null, language = null }) {
    if (!task || !task.trim()) {
      throw new Error('Task description is required for agent action planning.');
    }

    const settings = await this.getActiveSettings();
    const targetLang = language || settings.defaultLanguage || 'en';
    const isHinglish = targetLang === 'hi-en';

    if (!Array.isArray(elements) || elements.length === 0) {
      return {
        action: 'done',
        targetId: null,
        value: null,
        label: null,
        reason: isHinglish
          ? 'Page par koi interactive element nahi mila ya task complete ho gaya hai.'
          : 'No interactive elements detected on the webpage to interact with.',
        isConsequential: false
      };
    }

    // Build compact element map
    const compactElements = elements.map(el => ({
      id: el.id,
      tag: el.tag,
      role: el.role,
      label: el.label,
      placeholder: el.placeholder || undefined,
      name: el.name || undefined,
      type: el.type || undefined,
      currentValue: el.value || undefined,
      isConsequential: el.isConsequential ? true : undefined
    }));

    // Build compact history of prior steps
    const historySummary = (stepHistory || []).map((step, idx) => ({
      stepNumber: step.stepNumber || idx + 1,
      action: step.action,
      targetId: step.targetId,
      value: step.value,
      label: step.label,
      status: step.status || 'approved'
    }));

    // Build profile context if available
    let profileContext = '';
    if (profile && typeof profile === 'object') {
      const parts = [];
      if (profile.name) parts.push(`Full Name: ${profile.name}`);
      if (profile.email) parts.push(`Email Address: ${profile.email}`);
      if (profile.phone) parts.push(`Phone Number: ${profile.phone}`);
      if (profile.college) parts.push(`College / University: ${profile.college}`);
      if (profile.degree) parts.push(`Degree Program / Major: ${profile.degree}`);
      if (profile.skills) parts.push(`Technical Skills: ${profile.skills}`);
      if (profile.links) parts.push(`Portfolio / GitHub / LinkedIn: ${profile.links}`);
      if (profile.bio) parts.push(`Bio / Statement: ${profile.bio}`);
      if (profile.preferredTone) parts.push(`Preferred Tone: ${profile.preferredTone}`);
      if (parts.length > 0) {
        profileContext = `\nUSER PROFILE MEMORY (use these personal facts when filling relevant fields):\n${parts.join('\n')}\n`;
      }
    }

    const systemPrompt = `You are Siddarth, an intelligent AI browser agent. You operate in a strict Human-in-the-Loop browser automation loop.
Your job is to break down the user's high-level task into individual, atomic browser actions.
You propose EXACTLY ONE atomic step at a time and wait for user approval.

CRITICAL RULES:
1. Propose ONLY ONE atomic action for the next step.
2. Valid action types:
   - "type": Types text into an input field or textarea. Requires valid "targetId" and non-empty "value".
   - "click": Clicks a button, link, checkbox, radio button, or tab. Requires valid "targetId".
   - "select": Selects an option from a dropdown or combobox. Requires valid "targetId" and "value".
   - "scroll": Scrolls the page or down to an element when fields are out of view.
   - "done": Signals that the user's task is fully completed or no further actions are possible.
3. Review STEP HISTORY carefully:
   - Never repeat an action that has already succeeded.
   - If a step was "skipped" by the user, do not propose the exact same step again; adapt your plan.
   - If all necessary fields have been filled or target buttons clicked, return "action": "done".
4. CONTEXT & PROFILE:
   - If the task involves filling a form and User Profile Memory is provided, use values from the profile (e.g. name, college, skills).
5. SENSITIVE FIELDS:
   - Do NOT attempt to fill password, credit card, CVV, or OTP fields. If a sensitive field is encountered, skip it or ask the user to fill it.
6. CONSEQUENTIAL ACTIONS:
   - If an action submits a form, makes a purchase, deletes data, or triggers an irreversible state change, set "isConsequential": true.
7. LANGUAGE:
   - ${isHinglish ? 'Provide the "reason" explanation in natural, conversational Roman Hinglish (English alphabet, no Devanagari).' : 'Provide the "reason" explanation in clear, concise English.'}
8. STRICT JSON FORMAT:
   You MUST respond with ONLY a valid JSON object matching this exact schema:
{
  "action": "click" | "type" | "select" | "scroll" | "done",
  "targetId": <number or null>,
  "value": <string or number or null>,
  "label": <target element label or null>,
  "reason": "<clear explanation of why this atomic step is needed>",
  "isConsequential": <boolean>
}
Do NOT output markdown fences, HTML, or explanations outside the JSON object.`;

    const userPrompt = `USER TASK: "${task.trim()}"
${profileContext}
STEP HISTORY SO FAR:
${historySummary.length > 0 ? JSON.stringify(historySummary, null, 2) : 'No steps executed yet (starting Step 1).'}

INTERACTIVE ELEMENTS ON CURRENT WEBPAGE:
${JSON.stringify(compactElements, null, 2)}

Propose the single next atomic step:`;

    const rawResponse = await this.generateText({
      prompt: userPrompt,
      systemPrompt,
      temperature: 0.1,
      language: targetLang
    });

    // Clean JSON response (strip markdown fences if present)
    let cleaned = (rawResponse || '').trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);

      let action = (parsed.action || 'done').toLowerCase().trim();
      if (!['click', 'type', 'select', 'scroll', 'done'].includes(action)) {
        action = 'done';
      }

      let targetId = null;
      if (typeof parsed.targetId === 'number' && Number.isInteger(parsed.targetId)) {
        const found = elements.find(el => el.id === parsed.targetId);
        if (found) {
          targetId = parsed.targetId;
        }
      }

      const targetEl = targetId ? elements.find(el => el.id === targetId) : null;
      const displayLabel = parsed.label || targetEl?.label || (targetId ? `Element #${targetId}` : null);

      // Detect consequential flag
      let isConsequential = Boolean(parsed.isConsequential);
      if (targetEl?.isConsequential) {
        isConsequential = true;
      }
      if (action === 'click' && targetEl) {
        const testText = `${targetEl.label || ''} ${targetEl.name || ''} ${targetEl.role || ''}`;
        if (/submit|buy|order|pay|transfer|delete|remove|send|checkout|purchase/i.test(testText)) {
          isConsequential = true;
        }
      }

      return {
        action,
        targetId,
        value: parsed.value !== undefined ? parsed.value : null,
        label: displayLabel,
        reason: parsed.reason || (action === 'done' ? 'Task finished.' : `Perform ${action} on ${displayLabel || 'page'}.`),
        isConsequential
      };
    } catch (parseErr) {
      console.warn('[Siddarth] Failed to parse planNextStep JSON:', cleaned, parseErr);

      // Fallback: heuristic extraction from text
      const actionMatch = cleaned.match(/"action"\s*:\s*"([^"]+)"/i);
      const targetMatch = cleaned.match(/"targetId"\s*:\s*(\d+)/i);
      const valueMatch = cleaned.match(/"value"\s*:\s*"([^"]*)"/i);
      const reasonMatch = cleaned.match(/"reason"\s*:\s*"([^"]*)"/i);

      const parsedAction = actionMatch ? actionMatch[1].toLowerCase() : 'done';
      const parsedTargetId = targetMatch ? parseInt(targetMatch[1], 10) : null;
      const parsedValue = valueMatch ? valueMatch[1] : null;
      const parsedReason = reasonMatch ? reasonMatch[1] : 'Proceeding with next step.';

      const targetEl = parsedTargetId ? elements.find(el => el.id === parsedTargetId) : null;

      return {
        action: ['click', 'type', 'select', 'scroll', 'done'].includes(parsedAction) ? parsedAction : 'done',
        targetId: targetEl ? parsedTargetId : null,
        value: parsedValue,
        label: targetEl?.label || (parsedTargetId ? `Element #${parsedTargetId}` : null),
        reason: parsedReason,
        isConsequential: Boolean(targetEl?.isConsequential)
      };
    }
  }
}

// Global singleton instance
export const aiClient = new AIClient();
