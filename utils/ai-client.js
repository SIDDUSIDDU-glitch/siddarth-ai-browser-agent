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
    this.sessionTokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      requestCount: 0
    };
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
- You MUST respond in conversational Roman Hinglish (natural Hindi written in the English alphabet, blended smoothly with English terms).
- Example: "Yeh article explain karta hai ki AI agents kaise browser automate kar sakte hain...", "Pehle 3 key takeaways yeh hain...", "Ab aapko yeh karna chahiye...".
- Keep technical terms (e.g. DOM, API, URL, credentials) in English.
- Make it sound natural, helpful, and easy to understand for an Indian user.`;
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
   * Core non-streaming generation via Gemini with retry and fallback
   */
  async generateText({
    prompt,
    systemPrompt = '',
    model = null,
    language = null,
    temperature = 0.4,
    maxTokens = 2048,
    retryCount = 0
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

      // Handle Rate Limiting (HTTP 429)
      if (response.status === 429) {
        console.warn(`[Siddarth] Gemini 429 Rate Limit encountered (attempt ${retryCount + 1}).`);

        // Check if Groq fallback is available
        if (settings.enableFallback && settings.groqApiKey?.trim()) {
          console.log('[Siddarth] Routing request to Groq Cloud fallback...');
          return await this.callGroqFallback({ prompt, systemPrompt: compiledSystemPrompt, temperature });
        }

        // Retry with backoff if within limits
        if (retryCount < 2) {
          const delay = Math.pow(2, retryCount) * 1200 + Math.random() * 400;
          await new Promise((res) => setTimeout(res, delay));
          return await this.generateText({
            prompt,
            systemPrompt,
            model: targetModel,
            language: targetLang,
            temperature,
            maxTokens,
            retryCount: retryCount + 1
          });
        }

        throw new Error('Gemini API rate limit exceeded (HTTP 429). Please wait a moment or add a Groq fallback key in Settings.');
      }

      // Handle transient server errors (HTTP 500 / 503)
      if ((response.status === 500 || response.status === 503) && retryCount < 2) {
        console.warn(`[Siddarth] Gemini server error HTTP ${response.status}. Retrying (attempt ${retryCount + 1})...`);
        const delay = (retryCount + 1) * 1000;
        await new Promise((res) => setTimeout(res, delay));
        return await this.generateText({
          prompt,
          systemPrompt,
          model: targetModel,
          language: targetLang,
          temperature,
          maxTokens,
          retryCount: retryCount + 1
        });
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
   * Streaming generation using Server-Sent Events (SSE)
   */
  async streamText({
    prompt,
    systemPrompt = '',
    model = null,
    language = null,
    temperature = 0.4,
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

    const targetModel = model || settings.preferredModel || SUPPORTED_MODELS.GEMINI_FLASH_LITE;
    const targetLang = language || settings.defaultLanguage || 'en';
    const compiledSystemPrompt = this.buildSystemPrompt(systemPrompt, targetLang);

    const endpoint = this.buildEndpoint(targetModel, apiKey, true);

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
        temperature
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const formattedMsg = this.formatApiError(response.status, errorData, targetModel);
        throw new Error(formattedMsg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let streamUsage = null;

      while (true) {
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

      if (streamUsage) {
        await this.recordUsage({
          promptTokens: streamUsage.promptTokenCount || 0,
          candidatesTokens: streamUsage.candidatesTokenCount || 0,
          totalTokens: streamUsage.totalTokenCount || 0
        });
      }

      onDone?.(accumulatedText);
    } catch (err) {
      console.error('[Siddarth] Stream error:', err);
      onError?.(err);
    }
  }

  /**
   * Multimodal Vision Analysis (Gemini Flash)
   */
  async analyzeScreenshot({
    prompt,
    imageBase64,
    mimeType = 'image/png',
    systemPrompt = '',
    language = null
  }) {
    const settings = await this.getActiveSettings();
    const apiKey = settings.geminiApiKey?.trim();

    if (!apiKey) {
      throw new Error('Gemini API key is missing. Please configure your API key in Siddarth Settings.');
    }

    const targetModel = SUPPORTED_MODELS.GEMINI_FLASH; // Gemini Flash for vision
    const targetLang = language || settings.defaultLanguage || 'en';
    const compiledSystemPrompt = this.buildSystemPrompt(systemPrompt, targetLang);

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const endpoint = this.buildEndpoint(targetModel, apiKey, false);

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

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
}

// Global singleton instance
export const aiClient = new AIClient();
