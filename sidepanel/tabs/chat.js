/**
 * Chat & Article/YouTube Summary Tab Controller for Siddarth AI Assistant
 * Handles:
 * 1. Mozilla Readability article extraction & 3-part structured summary (Slice 3)
 * 2. Public YouTube video summarization with clickable timestamps (Slice 4)
 * 3. English / Hinglish bilingual toggle support (Slice 5)
 * 4. Grounded Page Chat with anti-hallucination guardrails and SSE streaming (Slice 6)
 */

import { aiClient } from '../../utils/ai-client.js';
import { getSettings } from '../../utils/storage-manager.js';
import {
  isYouTubeWatchUrl,
  extractVideoId,
  extractChaptersFromText,
  groupTranscriptSegments,
  extractYouTubePageDataInTab,
  fetchCaptionTrack,
  renderClickableTimestamps,
  seekVideoInPage,
  formatSecondsToTimestamp
} from '../../utils/youtube-parser.js';

export class ChatTab {
  constructor(options = {}) {
    this.onNavigateTab = options.onNavigateTab || (() => {});
    this.currentContentType = 'article'; // 'article' | 'youtube'
    this.currentArticle = null;
    this.currentVideo = null;
    this.currentSummaryMarkdown = '';
    this.currentLanguage = 'en';

    // Chat conversation state (Slice 6)
    this.chatHistory = [];
    this.isStreaming = false;
    this.activeAbortController = null;

    // Multimodal Vision state (Slice 8)
    this.originalScreenshotUrl = null;
    this.originalImage = null;
    this.cropRect = null;
    this.isCropping = false;
    this.cropStart = null;
    this.cropCurrent = null;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    if (typeof document === 'undefined') return;

    // Summary Buttons
    this.btnSummarize = document.getElementById('quick-btn-summarize');
    this.btnSummarizeYouTube = document.getElementById('quick-btn-youtube');
    this.btnCopySummary = document.getElementById('btn-copy-summary');
    this.btnResummarize = document.getElementById('btn-resummarize');
    this.btnClearSummary = document.getElementById('btn-clear-summary');

    // Summary Containers & Badges
    this.welcomeCard = document.getElementById('chat-welcome-card');
    this.quickActionsCard = document.getElementById('chat-quick-actions-card');
    this.loadingCard = document.getElementById('summary-loading-card');
    this.loadingText = document.getElementById('summary-loading-text');
    this.summaryCard = document.getElementById('summary-result-card');
    this.summaryError = document.getElementById('summary-error-box');

    this.summaryTitle = document.getElementById('summary-article-title');
    this.summaryByline = document.getElementById('summary-article-byline');
    this.summaryDomain = document.getElementById('summary-badge-domain');
    this.summaryWords = document.getElementById('summary-badge-words');
    this.summaryReadTime = document.getElementById('summary-badge-readtime');
    this.summaryLangBadge = document.getElementById('summary-badge-lang');
    this.summaryContent = document.getElementById('summary-html-content');

    // Grounded Chat Elements (Slice 6)
    this.chatCard = document.getElementById('chat-conversation-card');
    this.chatMessagesContainer = document.getElementById('chat-messages-list');
    this.chatEmptyState = document.getElementById('chat-empty-state');
    this.chatUserInput = document.getElementById('chat-user-input');
    this.btnChatSend = document.getElementById('btn-chat-send');
    this.btnChatStop = document.getElementById('btn-chat-stop');
    this.btnClearChat = document.getElementById('btn-clear-chat');
    this.groundingPill = document.getElementById('chat-grounding-pill');
    this.groundingText = document.getElementById('chat-grounding-text');
    this.suggestionChips = document.querySelectorAll('.suggestion-chip');

    // Multimodal Vision Elements (Slice 8)
    this.btnQuickScreenshot = document.getElementById('quick-btn-screenshot');
    this.btnChatCamera = document.getElementById('btn-chat-camera');
    this.screenshotPreviewCard = document.getElementById('screenshot-preview-card');
    this.btnDismissScreenshot = document.getElementById('btn-dismiss-screenshot');
    this.screenshotCanvas = document.getElementById('screenshot-canvas');
    this.cropStatusBadge = document.getElementById('crop-status-badge');
    this.btnCropFull = document.getElementById('btn-crop-full');
    this.btnCropReset = document.getElementById('btn-crop-reset');
    this.screenshotPromptInput = document.getElementById('screenshot-prompt-input');
    this.btnAnalyzeScreenshot = document.getElementById('btn-analyze-screenshot');
    this.screenshotChips = document.querySelectorAll('.screenshot-chip');
  }

  bindEvents() {
    if (typeof document === 'undefined') return;

    // Summary events
    this.btnSummarize?.addEventListener('click', () => this.handleSummarizePage());
    this.btnSummarizeYouTube?.addEventListener('click', () => this.handleSummarizeYouTube());
    this.btnCopySummary?.addEventListener('click', () => this.handleCopySummary());
    this.btnResummarize?.addEventListener('click', () => this.handleResummarize());
    this.btnClearSummary?.addEventListener('click', () => this.clearSummary());

    // Event delegation for clickable timestamp badges in summary content
    this.summaryContent?.addEventListener('click', (e) => {
      const btn = e.target.closest('.yt-timestamp-btn');
      if (btn) {
        e.preventDefault();
        const seconds = parseFloat(btn.getAttribute('data-seconds'));
        const timeStr = btn.getAttribute('data-timestr') || btn.textContent.trim();
        this.jumpToTimestamp(seconds, timeStr);
      }
    });

    // Grounded Chat events (Slice 6)
    this.btnChatSend?.addEventListener('click', () => this.handleSendMessage());
    this.btnChatStop?.addEventListener('click', () => this.stopStreaming());
    this.btnClearChat?.addEventListener('click', () => this.clearChat());

    // Enter to send (Shift+Enter for newline)
    this.chatUserInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
      }
    });

    // Auto-resizing textarea
    this.chatUserInput?.addEventListener('input', () => {
      if (!this.chatUserInput) return;
      this.chatUserInput.style.height = 'auto';
      this.chatUserInput.style.height = Math.min(this.chatUserInput.scrollHeight, 90) + 'px';
    });

    // Suggestion chips
    this.suggestionChips?.forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt && this.chatUserInput) {
          this.chatUserInput.value = prompt;
          this.handleSendMessage();
        }
      });
    });

    // Event delegation for timestamp clicks and copy buttons inside chat messages
    this.chatMessagesContainer?.addEventListener('click', (e) => {
      // Clickable timestamps
      const tsBtn = e.target.closest('.yt-timestamp-btn');
      if (tsBtn) {
        e.preventDefault();
        const seconds = parseFloat(tsBtn.getAttribute('data-seconds'));
        const timeStr = tsBtn.getAttribute('data-timestr') || tsBtn.textContent.trim();
        this.jumpToTimestamp(seconds, timeStr);
        return;
      }

      // Copy response text
      const copyBtn = e.target.closest('.chat-copy-btn');
      if (copyBtn) {
        const rawText = copyBtn.getAttribute('data-copy-text');
        if (rawText) {
          navigator.clipboard.writeText(rawText).then(() => {
            this.showToast('Response copied to clipboard!');
          }).catch(() => {});
        }
      }
    });

    // Multimodal Vision events (Slice 8)
    this.btnQuickScreenshot?.addEventListener('click', () => this.handleCaptureScreenshot());
    this.btnChatCamera?.addEventListener('click', () => this.handleCaptureScreenshot());
    this.btnDismissScreenshot?.addEventListener('click', () => this.dismissScreenshot());
    this.btnCropFull?.addEventListener('click', () => this.resetCrop());
    this.btnCropReset?.addEventListener('click', () => this.resetCrop());
    this.btnAnalyzeScreenshot?.addEventListener('click', () => this.handleAnalyzeScreenshot());

    this.screenshotPromptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleAnalyzeScreenshot();
      }
    });

    this.screenshotChips?.forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt && this.screenshotPromptInput) {
          this.screenshotPromptInput.value = prompt;
          this.handleAnalyzeScreenshot();
        }
      });
    });

    this.bindCanvasCropEvents();
  }

  setInitialLanguage(lang) {
    this.currentLanguage = lang || 'en';
  }

  // =========================================================================
  // SLICE 3 & 4: ARTICLE & YOUTUBE SUMMARIZATION PIPELINES
  // =========================================================================

  /**
   * Main pipeline for Article Summarization
   */
  async handleSummarizePage() {
    this.hideError();

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    let activeTab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs?.[0];
    } catch (tabErr) {
      this.showError(`Could not access active tab: ${tabErr.message}`);
      return;
    }

    if (!activeTab || !activeTab.id) {
      this.showError('No active browser tab found to summarize.');
      return;
    }

    const url = activeTab.url || '';
    if (isYouTubeWatchUrl(url)) {
      return this.handleSummarizeYouTube();
    }

    if (this.isRestrictedUrl(url)) {
      this.showError(
        'Siddarth cannot interact with internal browser pages (such as chrome://, new tab, or settings). Please open an article on a website like Wikipedia, Medium, or news to generate a summary.'
      );
      return;
    }

    this.setLoading(true, 'Extracting readable article content with Mozilla Readability...');

    let extracted = null;
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['lib/Readability.js', 'content/readability-bundle.js']
      });

      extracted = injectionResults?.[0]?.result;
    } catch (injErr) {
      console.warn('[Siddarth] executeScript injection failed, attempting message dispatch:', injErr);
      try {
        extracted = await chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_PAGE_CONTENT' });
      } catch {
        this.setLoading(false);
        this.showError(`Failed to extract page content: ${injErr.message}. Make sure the webpage is fully loaded.`);
        return;
      }
    }

    if (!extracted || !extracted.success || !extracted.textContent || extracted.textContent.trim().length < 60) {
      this.setLoading(false);
      this.showError(
        extracted?.error || 'Could not extract readable article text from this page. The page may lack substantial text or require login.'
      );
      return;
    }

    this.currentContentType = 'article';
    this.currentArticle = extracted;
    this.currentVideo = null;
    this.updateGroundingStatus();

    const wordCount = extracted.wordCount || extracted.textContent.split(/\s+/).filter(Boolean).length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    const lang = this.currentLanguage || settings.defaultLanguage || 'en';

    this.setLoading(
      true,
      `Generating structured 3-part summary with ${settings.preferredModel || 'Gemini Flash-Lite'}...`
    );

    const prompt = this.buildSummaryPrompt(extracted, lang);

    try {
      const summaryMarkdown = await aiClient.generateText({
        prompt,
        systemPrompt: 'You are an expert executive reading assistant. Your summaries are structured, crisp, informative, and free of fluff.',
        model: settings.preferredModel,
        language: lang,
        temperature: 0.3,
        maxTokens: 2048,
        onFallback: ({ provider, model }) => {
          this.showToast(`⚡ Rate limit on Gemini: Auto-fallback to ${provider.toUpperCase()} (${model})`);
        }
      });

      this.currentSummaryMarkdown = summaryMarkdown;

      this.renderSummary({
        type: 'article',
        data: extracted,
        markdown: summaryMarkdown,
        wordCount,
        readTimeMinutes,
        language: lang
      });
    } catch (apiErr) {
      this.setLoading(false);
      this.showError(`Summary generation failed: ${apiErr.message}`);
    }
  }

  /**
   * Main pipeline for Public YouTube Video Summarization
   */
  async handleSummarizeYouTube() {
    this.hideError();

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    let activeTab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs?.[0];
    } catch (tabErr) {
      this.showError(`Could not access active tab: ${tabErr.message}`);
      return;
    }

    if (!activeTab || !activeTab.id) {
      this.showError('No active browser tab found.');
      return;
    }

    const url = activeTab.url || '';
    if (!isYouTubeWatchUrl(url)) {
      this.showError(
        'Active tab is not a YouTube video page. Please open a YouTube video (e.g. https://www.youtube.com/watch?v=...) to summarize.'
      );
      return;
    }

    const videoId = extractVideoId(url);

    this.setLoading(true, 'Extracting video metadata and chapter structure from YouTube...');

    let ytPageData = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: extractYouTubePageDataInTab
      });
      ytPageData = results?.[0]?.result;
    } catch (injErr) {
      console.warn('[Siddarth] Could not execute in-tab YouTube extractor:', injErr);
    }

    const title = ytPageData?.title || activeTab.title?.replace(/ - YouTube$/, '') || 'YouTube Video';
    const channel = ytPageData?.channel || '';
    const duration = ytPageData?.duration || 0;
    const description = ytPageData?.description || '';

    let chapters = ytPageData?.domChapters || [];
    if (chapters.length === 0 && description) {
      chapters = extractChaptersFromText(description);
    }

    let transcriptText = '';
    let transcriptSegmentsCount = 0;

    if (ytPageData?.captionTracks && ytPageData.captionTracks.length > 0) {
      this.setLoading(true, 'Fetching and parsing timed video captions...');

      const enTrack = ytPageData.captionTracks.find(t => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
                      ytPageData.captionTracks.find(t => t.languageCode?.startsWith('en')) ||
                      ytPageData.captionTracks[0];

      if (enTrack?.baseUrl) {
        try {
          const segments = await fetchCaptionTrack(enTrack.baseUrl);
          if (segments && segments.length > 0) {
            const grouped = groupTranscriptSegments(segments, 50, 22000);
            transcriptText = grouped.transcriptText;
            transcriptSegmentsCount = grouped.segmentsCount;
          }
        } catch (captionsErr) {
          console.warn('[Siddarth] Caption fetching encountered an error:', captionsErr);
        }
      }
    }

    this.currentContentType = 'youtube';
    this.currentVideo = {
      url,
      videoId,
      title,
      channel,
      duration,
      chapters,
      description,
      transcriptText,
      transcriptSegmentsCount
    };
    this.currentArticle = null;
    this.updateGroundingStatus();

    const lang = this.currentLanguage || settings.defaultLanguage || 'en';

    this.setLoading(
      true,
      `Generating structured notes & clickable timestamps with ${settings.preferredModel || 'Gemini'}...`
    );

    const prompt = this.buildYouTubeSummaryPrompt(this.currentVideo, lang);

    try {
      const summaryMarkdown = await aiClient.generateText({
        prompt,
        systemPrompt: 'You are an elite video analyst and educator. You produce crisp, chronological chapter notes with exact timestamps, high-impact key takeaways, and practical next steps.',
        model: settings.preferredModel,
        language: lang,
        temperature: 0.3,
        maxTokens: 2500,
        onFallback: ({ provider, model }) => {
          this.showToast(`⚡ Rate limit on Gemini: Auto-fallback to ${provider.toUpperCase()} (${model})`);
        }
      });

      this.currentSummaryMarkdown = summaryMarkdown;

      this.renderSummary({
        type: 'youtube',
        data: this.currentVideo,
        markdown: summaryMarkdown,
        wordCount: transcriptText ? transcriptText.split(/\s+/).length : 0,
        readTimeMinutes: duration > 0 ? Math.ceil(duration / 60) : 5,
        language: lang
      });
    } catch (apiErr) {
      this.setLoading(false);
      this.showError(`YouTube summary generation failed: ${apiErr.message}`);
    }
  }

  /**
   * Seeks video player to specified seconds
   */
  async jumpToTimestamp(seconds, timeStr = '') {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs?.[0];

      if (!activeTab || !activeTab.id) {
        this.showToast('No active tab found to jump.');
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: seekVideoInPage,
        args: [seconds]
      });

      const res = results?.[0]?.result;
      if (res?.success) {
        this.showToast(`Jumped to ${timeStr || formatSecondsToTimestamp(seconds)}`);
      } else {
        this.showToast(res?.error || 'Could not seek video player');
      }
    } catch (err) {
      console.error('[Siddarth] Timestamp jump error:', err);
      this.showToast(`Seek error: ${err.message}`);
    }
  }

  handleResummarize() {
    if (this.currentContentType === 'youtube') {
      this.handleSummarizeYouTube();
    } else {
      this.handleSummarizePage();
    }
  }

  // =========================================================================
  // SLICE 6: GROUNDED PAGE CHAT WITH STREAMING & ANTI-HALLUCINATION
  // =========================================================================

  /**
   * Ensures grounded page or video context exists before running chat.
   * If not already cached, performs in-tab extraction on the fly.
   */
  async ensurePageContext() {
    // 1. If we already have active article or video context, return it
    const active = this.getActiveContext();
    if (active && active.text && active.text.trim().length > 30) {
      return active;
    }

    // 2. Query active browser tab
    let activeTab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs?.[0];
    } catch {
      return null;
    }

    if (!activeTab || !activeTab.id) return null;
    const url = activeTab.url || '';
    if (this.isRestrictedUrl(url)) return null;

    // 3. YouTube Watch URL
    if (isYouTubeWatchUrl(url)) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: extractYouTubePageDataInTab
        });
        const ytData = results?.[0]?.result;
        if (ytData) {
          const chapters = ytData.domChapters?.length > 0
            ? ytData.domChapters
            : extractChaptersFromText(ytData.description || '');

          this.currentVideo = {
            url,
            videoId: extractVideoId(url),
            title: ytData.title || activeTab.title?.replace(/ - YouTube$/, '') || 'YouTube Video',
            channel: ytData.channel || '',
            duration: ytData.duration || 0,
            chapters,
            description: ytData.description || '',
            transcriptText: ''
          };
          this.currentContentType = 'youtube';
          this.updateGroundingStatus();
          return this.getActiveContext();
        }
      } catch (err) {
        console.warn('[Siddarth] In-tab YouTube extraction failed:', err);
      }
    }

    // 4. Standard web article
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['lib/Readability.js', 'content/readability-bundle.js']
      });
      const extracted = injectionResults?.[0]?.result;
      if (extracted && extracted.success && extracted.textContent) {
        this.currentArticle = extracted;
        this.currentContentType = 'article';
        this.updateGroundingStatus();
        return this.getActiveContext();
      }
    } catch (err) {
      console.warn('[Siddarth] In-tab Readability extraction failed:', err);
    }

    return null;
  }

  /**
   * Retrieves active grounded context object
   */
  getActiveContext() {
    if (this.currentContentType === 'youtube' && this.currentVideo) {
      const chaptersSummary = this.currentVideo.chapters?.map(c => `[${c.timeStr}] ${c.title}`).join('\n') || '';
      return {
        type: 'youtube',
        title: this.currentVideo.title,
        url: this.currentVideo.url,
        channel: this.currentVideo.channel,
        duration: this.currentVideo.duration,
        chapters: this.currentVideo.chapters,
        text: this.currentVideo.transcriptText ||
              `CHAPTERS:\n${chaptersSummary}\n\nDESCRIPTION:\n${this.currentVideo.description}`
      };
    }

    if (this.currentArticle) {
      return {
        type: 'article',
        title: this.currentArticle.title,
        url: this.currentArticle.url,
        siteName: this.currentArticle.siteName,
        byline: this.currentArticle.byline,
        text: this.currentArticle.textContent
      };
    }

    return null;
  }

  /**
   * Updates the grounding status pill in the chat header
   */
  updateGroundingStatus() {
    if (!this.groundingText) return;

    if (this.currentContentType === 'youtube' && this.currentVideo) {
      const shortTitle = this.currentVideo.title.length > 22
        ? `${this.currentVideo.title.slice(0, 20)}...`
        : this.currentVideo.title;
      this.groundingText.textContent = `YouTube: ${shortTitle}`;
      if (this.groundingPill) this.groundingPill.className = 'badge badge-youtube';
    } else if (this.currentArticle) {
      const shortTitle = this.currentArticle.title.length > 22
        ? `${this.currentArticle.title.slice(0, 20)}...`
        : this.currentArticle.title;
      this.groundingText.textContent = `Page: ${shortTitle}`;
      if (this.groundingPill) this.groundingPill.className = 'badge badge-accent';
    } else {
      this.groundingText.textContent = 'Auto-grounding active tab';
      if (this.groundingPill) this.groundingPill.className = 'badge badge-neutral';
    }
  }

  /**
   * Builds Grounded Chat prompt with anti-hallucination guardrails and multi-turn history
   */
  buildGroundedChatPrompt({ query, context, history = [], language = 'en' }) {
    const isHinglish = language === 'hi-en';

    // System prompt with strict anti-hallucination rule as specified in Slice 6
    const systemPrompt = isHinglish
      ? `You are Siddarth, an expert context-aware AI browser companion running inside Google Chrome.
Answer strictly based on the provided page context in conversational Roman Hinglish.
CRITICAL ANTI-HALLUCINATION RULES:
1. Rely ONLY on the information explicitly provided in <page_context>. Do not assume, extrapolate, or use outside world knowledge.
2. If the answer is not contained in the text, explicitly state: "Yeh information current page par available nahi hai."
3. Do NOT use Devanagari script. Use Roman alphabet only. Keep technical terms in English.
4. Keep your answers concise, accurate, structured, and direct.`
      : `You are Siddarth, an expert context-aware AI browser companion running inside Google Chrome.
Answer strictly based on the provided page context.
CRITICAL ANTI-HALLUCINATION RULES:
1. Rely ONLY on the information explicitly provided in <page_context>. Do not assume, extrapolate, or use outside world knowledge.
2. If the answer is not contained in the text, explicitly state: 'This information is not available on the current page.'
3. Never invent facts, numbers, or conclusions not found in the context.
4. Keep your answers concise, accurate, structured, and direct.`;

    let contextText = context?.text || 'No page content could be extracted from this tab.';
    // Clamp to 24,000 characters to protect context window limits
    if (contextText.length > 24000) {
      const head = contextText.slice(0, 16000);
      const tail = contextText.slice(contextText.length - 7500);
      contextText = `${head}\n\n[... content truncated for length ...]\n\n${tail}`;
    }

    // Format previous conversation history (last 6 turns)
    let historySection = '';
    if (history.length > 0) {
      const turns = history.slice(-6).map(h => `${h.role === 'user' ? 'User' : 'Siddarth'}: ${h.content}`);
      historySection = `CONVERSATION HISTORY:\n${turns.join('\n\n')}\n\n`;
    }

    const prompt = `<page_context>
Title: ${context?.title || 'Current Webpage'}
Type: ${context?.type === 'youtube' ? 'YouTube Video Notes & Transcript' : 'Webpage Content'}

${contextText}
</page_context>

${historySection}User Question: ${query}

Remember: Answer strictly based on the provided page context. If the answer is not contained in the text, explicitly state: "${isHinglish ? 'Yeh information current page par available nahi hai.' : 'This information is not available on the current page.'}"`;

    return { prompt, systemPrompt };
  }

  /**
   * Executes a saved skill recipe prompt against the active page in Grounded Chat (Slice 15)
   * @param {string} promptTemplate
   * @param {string} [skillName]
   */
  async handleRunSkill(promptTemplate, skillName = '') {
    if (!promptTemplate || !promptTemplate.trim()) return;

    if (this.chatUserInput) {
      this.chatUserInput.value = promptTemplate.trim();
    }

    if (skillName) {
      this.showToast(`Running skill: ${skillName}`);
    }

    await this.handleSendMessage();
  }

  /**
   * Main send message handler for Grounded Page Chat with Streaming (Slice 6)
   */
  async handleSendMessage() {
    if (!this.chatUserInput) return;
    const userQuery = this.chatUserInput.value.trim();
    if (!userQuery || this.isStreaming) return;

    // 1. Check API Key
    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    // 2. Clear input & reset height
    this.chatUserInput.value = '';
    this.chatUserInput.style.height = 'auto';

    // 3. Hide empty state
    if (this.chatEmptyState) {
      this.chatEmptyState.style.display = 'none';
    }

    // 4. Render User Message Bubble
    this.appendUserMessage(userQuery);

    // 5. Ensure grounded page context is available
    const context = await this.ensurePageContext();

    // 6. Create Assistant Bubble with Streaming Cursor
    const { messageEl, bubbleEl } = this.createAssistantMessageElement();
    this.chatMessagesContainer?.appendChild(messageEl);
    this.scrollToBottom();

    // 7. Update UI controls for streaming state
    this.setStreamingState(true);
    this.activeAbortController = new AbortController();

    const lang = this.currentLanguage || settings.defaultLanguage || 'en';
    const { prompt, systemPrompt } = this.buildGroundedChatPrompt({
      query: userQuery,
      context,
      history: this.chatHistory,
      language: lang
    });

    let accumulatedText = '';

    try {
      // 8. Stream response via Gemini SSE
      await aiClient.streamText({
        prompt,
        systemPrompt,
        model: settings.preferredModel,
        language: lang,
        temperature: 0.2, // Low temperature for maximum grounding fidelity
        signal: this.activeAbortController.signal,
        onFallback: ({ provider, model }) => {
          this.showToast(`⚡ Gemini rate limit: Auto-fallback to ${provider.toUpperCase()} (${model})`);
          const tag = messageEl.querySelector('.msg-grounded-tag');
          if (tag) {
            tag.textContent = `Fallback: ${model}`;
            tag.style.background = 'rgba(245, 158, 11, 0.2)';
            tag.style.color = '#fcd34d';
            tag.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          }
        },
        onChunk: (chunk, acc) => {
          accumulatedText = acc;
          let renderedHtml = this.renderMarkdownSafely(acc);
          if (context?.type === 'youtube') {
            renderedHtml = renderClickableTimestamps(renderedHtml);
          }
          bubbleEl.innerHTML = renderedHtml + '<span class="streaming-cursor"></span>';
          this.scrollToBottom();
        },
        onDone: (finalText) => {
          this.setStreamingState(false);
          this.activeAbortController = null;

          const textToSave = finalText || accumulatedText || 'No response generated.';
          let finalHtml = this.renderMarkdownSafely(textToSave);
          if (context?.type === 'youtube') {
            finalHtml = renderClickableTimestamps(finalHtml);
          }

          bubbleEl.innerHTML = finalHtml;
          this.appendCopyButton(bubbleEl, textToSave);

          // Update multi-turn history
          this.chatHistory.push({ role: 'user', content: userQuery });
          this.chatHistory.push({ role: 'assistant', content: textToSave });
          this.scrollToBottom();
        },
        onError: (err) => {
          this.setStreamingState(false);
          this.activeAbortController = null;
          bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Error: ${this.escapeHtml(err.message)}</div>`;
          this.scrollToBottom();
        }
      });
    } catch (err) {
      this.setStreamingState(false);
      this.activeAbortController = null;
      bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Error: ${this.escapeHtml(err.message)}</div>`;
      this.scrollToBottom();
    }
  }

  /**
   * Stops active streaming generation
   */
  stopStreaming() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.setStreamingState(false);
    this.showToast('Streaming stopped');
  }

  /**
   * Clears conversation history and restores empty state
   */
  clearChat() {
    this.chatHistory = [];
    if (this.chatMessagesContainer) {
      this.chatMessagesContainer.innerHTML = '';
      if (this.chatEmptyState) {
        this.chatMessagesContainer.appendChild(this.chatEmptyState);
        this.chatEmptyState.style.display = 'flex';
      }
    }
    this.showToast('Chat history cleared');
  }

  /**
   * Appends user message bubble to chat container
   */
  appendUserMessage(text) {
    if (!this.chatMessagesContainer) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message chat-msg-user';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    msgDiv.appendChild(bubble);
    this.chatMessagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Creates an empty assistant message element ready for streaming
   */
  createAssistantMessageElement() {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message chat-msg-assistant';

    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerHTML = `
      <img src="../assets/icons/icon16.png" class="msg-avatar" alt="Siddarth">
      <span class="msg-sender">Siddarth</span>
      <span class="msg-grounded-tag">Grounded</span>
    `;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'msg-bubble markdown-body';
    bubbleEl.innerHTML = '<span class="streaming-cursor"></span>';

    messageEl.appendChild(header);
    messageEl.appendChild(bubbleEl);

    return { messageEl, bubbleEl };
  }

  /**
   * Appends a subtle copy button below assistant response
   */
  appendCopyButton(container, text) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'chat-copy-btn';
    copyBtn.setAttribute('data-copy-text', text);
    copyBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy</span>
    `;
    container.appendChild(copyBtn);
  }

  /**
   * Toggles streaming UI button states
   */
  setStreamingState(isStreaming) {
    this.isStreaming = isStreaming;

    if (this.btnChatSend) {
      this.btnChatSend.style.display = isStreaming ? 'none' : 'flex';
      this.btnChatSend.disabled = isStreaming;
    }

    if (this.btnChatStop) {
      this.btnChatStop.style.display = isStreaming ? 'flex' : 'none';
    }
  }

  scrollToBottom() {
    if (this.chatMessagesContainer) {
      this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }
  }

  renderMarkdownSafely(md) {
    if (typeof window !== 'undefined' && window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(md);
    }
    return this.fallbackMarkdownParser(md);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // SLICE 7: CONTEXT-MENU QUICK ACTIONS (EXPLAIN, TRANSLATE, DRAFT REPLY)
  // =========================================================================

  /**
   * Handles right-click context menu actions: Explain, Translate, Draft Reply (Slice 7)
   */
  async handleContextMenuAction({ action, selectionText, pageUrl = '', pageTitle = '' }) {
    if (!selectionText || typeof selectionText !== 'string' || !selectionText.trim()) return;
    const cleanText = selectionText.trim();

    // 1. If currently streaming another response, stop it cleanly
    if (this.isStreaming) {
      this.stopStreaming();
    }

    // 2. Check API key configuration
    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    // 3. Hide empty state
    if (this.chatEmptyState) {
      this.chatEmptyState.style.display = 'none';
    }

    // 4. Update page context cache if page info provided
    if (pageUrl && pageTitle && !this.currentArticle && !this.currentVideo) {
      this.currentArticle = {
        title: pageTitle,
        url: pageUrl,
        siteName: pageUrl.includes('://') ? new URL(pageUrl).hostname : 'Webpage',
        textContent: cleanText
      };
      this.updateGroundingStatus();
    }

    // 5. Build prompt and visual tag
    const lang = this.currentLanguage || settings.defaultLanguage || 'en';
    const { label, prompt, systemPrompt } = this.buildContextMenuPrompt({
      action,
      selectionText: cleanText,
      language: lang,
      pageTitle
    });

    // 6. Render user message bubble with action badge
    const preview = cleanText.length > 280 ? `${cleanText.slice(0, 270)}...` : cleanText;
    this.appendUserActionMessage(label, preview);

    // 7. Create assistant message bubble
    const { messageEl, bubbleEl } = this.createAssistantMessageElement();
    this.chatMessagesContainer?.appendChild(messageEl);
    this.scrollToBottom();

    // 8. Stream response
    this.setStreamingState(true);
    this.activeAbortController = new AbortController();

    let accumulatedText = '';

    try {
      await aiClient.streamText({
        prompt,
        systemPrompt,
        model: settings.preferredModel,
        language: lang,
        temperature: 0.3,
        signal: this.activeAbortController.signal,
        onFallback: ({ provider, model }) => {
          this.showToast(`⚡ Gemini rate limit: Auto-fallback to ${provider.toUpperCase()} (${model})`);
          const tag = messageEl.querySelector('.msg-grounded-tag');
          if (tag) {
            tag.textContent = `Fallback: ${model}`;
            tag.style.background = 'rgba(245, 158, 11, 0.2)';
            tag.style.color = '#fcd34d';
            tag.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          }
        },
        onChunk: (chunk, acc) => {
          accumulatedText = acc;
          const renderedHtml = this.renderMarkdownSafely(acc);
          bubbleEl.innerHTML = renderedHtml + '<span class="streaming-cursor"></span>';
          this.scrollToBottom();
        },
        onDone: (finalText) => {
          this.setStreamingState(false);
          this.activeAbortController = null;

          const textToSave = finalText || accumulatedText || 'No response generated.';
          const finalHtml = this.renderMarkdownSafely(textToSave);

          bubbleEl.innerHTML = finalHtml;
          this.appendCopyButton(bubbleEl, textToSave);

          // Update multi-turn history
          this.chatHistory.push({ role: 'user', content: `[${label}] "${cleanText}"` });
          this.chatHistory.push({ role: 'assistant', content: textToSave });
          this.scrollToBottom();
        },
        onError: (err) => {
          this.setStreamingState(false);
          this.activeAbortController = null;
          bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Error: ${this.escapeHtml(err.message)}</div>`;
          this.scrollToBottom();
        }
      });
    } catch (err) {
      this.setStreamingState(false);
      this.activeAbortController = null;
      bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Error: ${this.escapeHtml(err.message)}</div>`;
      this.scrollToBottom();
    }
  }

  /**
   * Appends a user message with action badge to chat
   */
  appendUserActionMessage(badgeLabel, text) {
    if (!this.chatMessagesContainer) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message chat-msg-user';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = `<span class="badge badge-accent" style="margin-right: 6px; font-size: 10px; vertical-align: middle;">${this.escapeHtml(badgeLabel)}</span>"${this.escapeHtml(text)}"`;

    msgDiv.appendChild(bubble);
    this.chatMessagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Builds prompt and system prompt for right-click context menu actions (Slice 7)
   */
  buildContextMenuPrompt({ action, selectionText, language = 'en', pageTitle = '' }) {
    const isHinglish = language === 'hi-en';
    const contextNote = pageTitle ? ` (from page "${pageTitle}")` : '';

    if (action === 'explain') {
      const label = 'Explain';
      const systemPrompt = isHinglish
        ? `You are Siddarth, an expert AI tutor. Explain the selected text clearly in conversational Roman Hinglish. Break down complex jargon, provide an intuitive analogy or concrete example, and keep technical terms in English. Do NOT use Devanagari script.`
        : `You are Siddarth, an expert AI tutor. Explain the selected text clearly in plain language. Break down complex jargon, provide an intuitive analogy or concrete example, and keep explanations crisp and accessible.`;

      const prompt = `Please explain the following selected text${contextNote} in plain language:

"${selectionText}"

Adhere strictly to this structure:
### 1. Plain-Language Summary
A crisp, non-intimidating overview explaining what this means in simple terms.

### 2. Key Terms & Concepts
Break down the critical terms or acronyms present in the snippet.

### 3. Intuitive Analogy / Real-World Example
An analogy or practical scenario illustrating the concept.`;

      return { label, prompt, systemPrompt };
    }

    if (action === 'translate') {
      const label = 'Translate';
      const systemPrompt = isHinglish
        ? `You are Siddarth, a bilingual translator. Translate the text into natural conversational Roman Hinglish. Do not use Devanagari script. Keep technical terms in English.`
        : `You are Siddarth, a bilingual translator. Translate the text into clear, natural English (or into conversational Roman Hinglish if requested).`;

      const targetDesc = isHinglish
        ? 'conversational Roman Hinglish (natural Hindi written in English alphabet)'
        : 'clear, fluent English';

      const prompt = `Please translate the following text${contextNote} into ${targetDesc}:

"${selectionText}"

Adhere strictly to this structure:
### 1. ${isHinglish ? 'Roman Hinglish Translation' : 'English Translation'}
The accurate translation in ${isHinglish ? 'Roman Hinglish' : 'English'}.

### 2. Context & Meaning Nuance
A brief sentence explaining any cultural, technical, or idiomatic nuances.`;

      return { label, prompt, systemPrompt };
    }

    if (action === 'reply') {
      const label = 'Draft Reply';
      const systemPrompt = isHinglish
        ? `You are Siddarth, an expert communication assistant. Draft clear, polite, and effective replies in conversational Roman Hinglish. Do not use Devanagari script.`
        : `You are Siddarth, an expert communication assistant. Draft clear, polite, and effective replies in crisp professional English.`;

      const prompt = `Please draft thoughtful, context-aware reply options to the following message/snippet${contextNote}:

"${selectionText}"

Provide two distinct reply options:
### 1. Option A: Professional & Structured
Polite, clear, business-appropriate, and constructive.

### 2. Option B: Friendly & Conversational
Warm, approachable, and concise.`;

      return { label, prompt, systemPrompt };
    }

    return {
      label: 'Ask',
      prompt: `Please assist with the following text: "${selectionText}"`,
      systemPrompt: 'You are Siddarth, an expert AI browser assistant.'
    };
  }

  // =========================================================================
  // SLICE 8: SCREENSHOT-AND-ASK (MULTIMODAL VISION) PIPELINE
  // =========================================================================

  /**
   * Captures the visible browser tab and loads it into the preview/crop selector
   */
  async handleCaptureScreenshot() {
    this.hideError();

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required for Vision analysis. Please configure your key in Settings.');
      this.onNavigateTab('settings');
      return;
    }

    const origBtnHtml = this.btnQuickScreenshot?.innerHTML;
    if (this.btnQuickScreenshot) {
      this.btnQuickScreenshot.disabled = true;
      this.btnQuickScreenshot.innerHTML = '<span class="icon">⏳</span> Capturing Tab...';
    }

    try {
      this.showToast('Capturing visible tab...');
      let response = null;

      // Identify active tab and target window ID
      let targetWindowId = null;
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const activeTab = tabs?.[0];
          if (activeTab) {
            targetWindowId = activeTab.windowId;
            const url = (activeTab.url || '').toLowerCase();
            if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
                url.startsWith('devtools://') || url.startsWith('edge://') ||
                url.startsWith('about:') || url.startsWith('view-source:')) {
              const displayUrl = activeTab.url.split('?')[0];
              this.showError(`Cannot capture internal browser pages (${displayUrl}). Please open a regular website or sample-chart.html and try again.`);
              return;
            }
          }
        } catch (tabErr) {
          console.warn('[Siddarth] Could not query active tab:', tabErr);
        }
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        response = await Promise.race([
          new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT', windowId: targetWindowId }, (res) => {
              if (chrome.runtime?.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(res || { success: false, error: 'No response from background worker' });
              }
            });
          }),
          new Promise((resolve) => setTimeout(() => resolve({
            success: false,
            error: 'Tab capture timed out after 5 seconds. Please ensure the target web page is open and focused.'
          }), 5000))
        ]);
      } else {
        response = { success: false, error: 'Chrome runtime is unavailable in this context.' };
      }

      if (!response || !response.success || !response.dataUrl) {
        throw new Error(response?.error || 'Failed to capture visible tab.');
      }

      const dataUrl = response.dataUrl;

      if (typeof Image !== 'undefined') {
        const img = new Image();
        img.onload = () => {
          this.originalImage = img;
          this.originalScreenshotUrl = dataUrl;
          this.cropRect = null;
          this.renderScreenshotCanvas();

          if (this.screenshotPreviewCard) {
            this.screenshotPreviewCard.style.display = 'block';
            this.screenshotPreviewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          this.updateCropBadge(`Full View (${img.naturalWidth || img.width}×${img.naturalHeight || img.height}px)`);
          if (this.screenshotPromptInput) {
            this.screenshotPromptInput.focus();
          }
          this.showToast('Screenshot captured! Crop or enter question.');
        };
        img.onerror = () => {
          this.showError('Failed to decode captured screenshot image.');
        };
        img.src = dataUrl;
      } else {
        // Node / test environment fallback
        this.originalImage = { naturalWidth: 1280, naturalHeight: 720, width: 1280, height: 720 };
        this.originalScreenshotUrl = dataUrl;
        this.cropRect = null;
        if (this.screenshotPreviewCard) {
          this.screenshotPreviewCard.style.display = 'block';
        }
        this.updateCropBadge('Full View (1280×720px)');
      }
    } catch (err) {
      console.error('[Siddarth] Screenshot capture error:', err);
      this.showError(`Screenshot capture failed: ${err.message}`);
    } finally {
      if (this.btnQuickScreenshot && origBtnHtml) {
        this.btnQuickScreenshot.disabled = false;
        this.btnQuickScreenshot.innerHTML = origBtnHtml;
      }
    }
  }

  /**
   * Binds interactive canvas mouse and touch cropping listeners
   */
  bindCanvasCropEvents() {
    if (!this.screenshotCanvas) return;

    const onMouseDown = (e) => {
      if (!this.originalImage) return;
      this.isCropping = true;
      this.cropStart = this.getCanvasCoords(e);
      this.cropCurrent = { ...this.cropStart };
    };

    const onMouseMove = (e) => {
      if (!this.isCropping || !this.cropStart) return;
      this.cropCurrent = this.getCanvasCoords(e);
      const x = Math.min(this.cropStart.x, this.cropCurrent.x);
      const y = Math.min(this.cropStart.y, this.cropCurrent.y);
      const width = Math.abs(this.cropCurrent.x - this.cropStart.x);
      const height = Math.abs(this.cropCurrent.y - this.cropStart.y);
      this.cropRect = { x, y, width, height };
      this.renderScreenshotCanvas();
      this.updateCropBadge(`Crop: ${Math.round(width)}×${Math.round(height)}px`);
    };

    const onMouseUp = () => {
      if (!this.isCropping) return;
      this.isCropping = false;
      if (!this.cropRect || this.cropRect.width < 10 || this.cropRect.height < 10) {
        this.cropRect = null;
        this.renderScreenshotCanvas();
        this.updateCropBadge('Full View (100%)');
      }
    };

    this.screenshotCanvas.addEventListener('mousedown', onMouseDown);
    this.screenshotCanvas.addEventListener('mousemove', onMouseMove);
    this.screenshotCanvas.addEventListener('mouseup', onMouseUp);
    this.screenshotCanvas.addEventListener('mouseleave', onMouseUp);

    // Touch listeners
    this.screenshotCanvas.addEventListener('touchstart', (e) => {
      if (e.touches?.[0]) onMouseDown(e.touches[0]);
    }, { passive: true });
    this.screenshotCanvas.addEventListener('touchmove', (e) => {
      if (e.touches?.[0]) onMouseMove(e.touches[0]);
    }, { passive: true });
    this.screenshotCanvas.addEventListener('touchend', onMouseUp);
  }

  /**
   * Converts viewport client coordinates to internal canvas resolution coordinates
   */
  getCanvasCoords(e) {
    if (!this.screenshotCanvas) return { x: 0, y: 0 };
    const rect = this.screenshotCanvas.getBoundingClientRect();
    const scaleX = this.screenshotCanvas.width / (rect.width || 1);
    const scaleY = this.screenshotCanvas.height / (rect.height || 1);
    return {
      x: Math.max(0, Math.min(this.screenshotCanvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(this.screenshotCanvas.height, (e.clientY - rect.top) * scaleY))
    };
  }

  /**
   * Renders the screenshot and active crop selection on the canvas
   */
  renderScreenshotCanvas() {
    if (!this.screenshotCanvas || !this.originalImage) return;
    const canvas = this.screenshotCanvas;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;

    const imgWidth = this.originalImage.naturalWidth || this.originalImage.width || 1280;
    const imgHeight = this.originalImage.naturalHeight || this.originalImage.height || 720;

    if (canvas.width !== imgWidth || canvas.height !== imgHeight) {
      canvas.width = imgWidth;
      canvas.height = imgHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.originalImage, 0, 0);

    // If active crop, dim outer region and draw bright crop box
    if (this.cropRect && this.cropRect.width > 5 && this.cropRect.height > 5) {
      const { x, y, width, height } = this.cropRect;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + height, canvas.width, canvas.height - (y + height));
      ctx.fillRect(0, y, x, height);
      ctx.fillRect(x + width, y, canvas.width - (x + width), height);

      // Crop border
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = Math.max(2, Math.round(canvas.width / 400));
      ctx.strokeRect(x, y, width, height);

      // Corner handles
      const handleSize = Math.max(6, Math.round(canvas.width / 150));
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(x + width - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(x - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(x + width - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);
    }
  }

  resetCrop() {
    this.cropRect = null;
    this.renderScreenshotCanvas();
    this.updateCropBadge('Full View (100%)');
  }

  updateCropBadge(text) {
    if (this.cropStatusBadge) {
      this.cropStatusBadge.textContent = text;
    }
  }

  dismissScreenshot() {
    this.originalScreenshotUrl = null;
    this.originalImage = null;
    this.cropRect = null;
    if (this.screenshotPreviewCard) {
      this.screenshotPreviewCard.style.display = 'none';
    }
  }

  /**
   * Returns base64 image string (either cropped region or full screenshot)
   */
  getEffectiveImageBase64() {
    if (!this.originalScreenshotUrl) return null;
    if (!this.cropRect || this.cropRect.width < 10 || this.cropRect.height < 10 || !this.originalImage) {
      return this.originalScreenshotUrl;
    }

    try {
      if (typeof document === 'undefined') return this.originalScreenshotUrl;
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(this.cropRect.width);
      cropCanvas.height = Math.round(this.cropRect.height);
      const ctx = cropCanvas.getContext?.('2d');
      if (!ctx) return this.originalScreenshotUrl;

      ctx.drawImage(
        this.originalImage,
        this.cropRect.x,
        this.cropRect.y,
        this.cropRect.width,
        this.cropRect.height,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height
      );
      return cropCanvas.toDataURL('image/png');
    } catch (err) {
      console.warn('[Siddarth] Canvas crop export failed, using full screenshot:', err);
      return this.originalScreenshotUrl;
    }
  }

  /**
   * Submits screenshot + question to Gemini Flash Multimodal Vision
   */
  async handleAnalyzeScreenshot() {
    const rawPrompt = (this.screenshotPromptInput?.value || '').trim();
    const prompt = rawPrompt || 'Which month had the highest sales?';
    const imageBase64 = this.getEffectiveImageBase64();

    if (!imageBase64) {
      this.showError('No screenshot available to analyze. Please capture a screenshot first.');
      return;
    }

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    // Dismiss preview card
    this.dismissScreenshot();

    // If currently streaming another response, stop it cleanly
    if (this.isStreaming) {
      this.stopStreaming();
    }

    // Hide empty state
    if (this.chatEmptyState) {
      this.chatEmptyState.style.display = 'none';
    }

    // Render user vision message
    this.appendUserVisionMessage(prompt, imageBase64);

    // Create assistant message element
    const { messageEl, bubbleEl } = this.createVisionAssistantMessageElement();
    this.chatMessagesContainer?.appendChild(messageEl);
    this.scrollToBottom();

    this.setStreamingState(true);
    this.activeAbortController = new AbortController();

    const lang = this.currentLanguage || settings.defaultLanguage || 'en';
    let accumulatedText = '';
    let watchdogTimer = null;

    // Safety watchdog: prevent infinite loading if connection hangs
    watchdogTimer = setTimeout(() => {
      if (this.isStreaming && !accumulatedText) {
        console.warn('[Siddarth] Vision watchdog timer fired after 25s.');
        this.stopStreaming();
        bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Vision request timed out. Please check your internet connection or Gemini API key, then try again.</div>`;
        this.scrollToBottom();
      }
    }, 25000);

    const cleanupWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    try {
      await aiClient.streamScreenshot({
        prompt,
        imageBase64,
        language: lang,
        signal: this.activeAbortController.signal,
        onChunk: (chunk, acc) => {
          cleanupWatchdog();
          accumulatedText = acc;
          const renderedHtml = this.renderMarkdownSafely(acc);
          bubbleEl.innerHTML = renderedHtml + '<span class="streaming-cursor"></span>';
          this.scrollToBottom();
        },
        onDone: (finalText) => {
          cleanupWatchdog();
          this.setStreamingState(false);
          this.activeAbortController = null;

          const textToSave = finalText || accumulatedText || 'No response generated.';
          const finalHtml = this.renderMarkdownSafely(textToSave);

          bubbleEl.innerHTML = finalHtml;
          this.appendCopyButton(bubbleEl, textToSave);

          // Update multi-turn history
          this.chatHistory.push({ role: 'user', content: `[Screenshot Vision Query]: ${prompt}` });
          this.chatHistory.push({ role: 'assistant', content: textToSave });
          this.scrollToBottom();
        },
        onError: async (err) => {
          cleanupWatchdog();
          console.warn('[Siddarth] Vision stream error, attempting analyzeScreenshot fallback:', err.message);

          // Attempt single-shot fallback before showing error
          if (!accumulatedText && !this.activeAbortController?.signal?.aborted) {
            bubbleEl.innerHTML = '<span class="streaming-cursor"></span> <span class="vision-loading-hint" style="color: #94a3b8; font-size: 13px; font-style: italic;">Retrying with direct vision query...</span>';
            try {
              const fallbackReply = await aiClient.analyzeScreenshot({
                prompt,
                imageBase64,
                language: lang
              });
              if (fallbackReply) {
                this.setStreamingState(false);
                this.activeAbortController = null;
                const finalHtml = this.renderMarkdownSafely(fallbackReply);
                bubbleEl.innerHTML = finalHtml;
                this.appendCopyButton(bubbleEl, fallbackReply);
                this.chatHistory.push({ role: 'user', content: `[Screenshot Vision Query]: ${prompt}` });
                this.chatHistory.push({ role: 'assistant', content: fallbackReply });
                this.scrollToBottom();
                return;
              }
            } catch (fbErr) {
              console.error('[Siddarth] Direct vision fallback also failed:', fbErr.message);
            }
          }

          this.setStreamingState(false);
          this.activeAbortController = null;
          bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Vision Error: ${this.escapeHtml(err.message)}</div>`;
          this.scrollToBottom();
        }
      });
    } catch (err) {
      cleanupWatchdog();
      this.setStreamingState(false);
      this.activeAbortController = null;
      bubbleEl.innerHTML = `<div class="chat-error-text">⚠️ Vision Error: ${this.escapeHtml(err.message)}</div>`;
      this.scrollToBottom();
    }
  }

  /**
   * Appends user message containing screenshot thumbnail and question
   */
  appendUserVisionMessage(promptText, imageBase64) {
    if (!this.chatMessagesContainer) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message chat-msg-user';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Thumbnail
    const imgThumb = document.createElement('img');
    imgThumb.src = imageBase64;
    imgThumb.alt = 'Screenshot snippet';
    imgThumb.className = 'chat-vision-thumbnail';
    bubble.appendChild(imgThumb);

    // Text row
    const textRow = document.createElement('div');
    textRow.className = 'chat-vision-text-row';
    textRow.innerHTML = `<span class="badge badge-accent" style="margin-right: 6px; font-size: 10px; vertical-align: middle;">Vision</span>${this.escapeHtml(promptText)}`;
    bubble.appendChild(textRow);

    msgDiv.appendChild(bubble);
    this.chatMessagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Creates an assistant message element with Vision Analysis badge
   */
  createVisionAssistantMessageElement() {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message chat-msg-assistant';

    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerHTML = `
      <img src="../assets/icons/icon16.png" class="msg-avatar" alt="Siddarth">
      <span class="msg-sender">Siddarth</span>
      <span class="msg-grounded-tag" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border-color: rgba(99, 102, 241, 0.4);">Vision Analysis</span>
    `;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'msg-bubble markdown-body';
    bubbleEl.innerHTML = '<span class="streaming-cursor"></span> <span class="vision-loading-hint" style="color: #94a3b8; font-size: 13px; font-style: italic;">Analyzing visual details...</span>';

    messageEl.appendChild(header);
    messageEl.appendChild(bubbleEl);

    return { messageEl, bubbleEl };
  }

  // =========================================================================
  // COMMON HELPERS & SUMMARY RENDERING
  // =========================================================================

  buildYouTubeSummaryPrompt(video, language = 'en') {
    const isHinglish = language === 'hi-en';

    let languageDirective = '';
    if (isHinglish) {
      languageDirective = `
LANGUAGE DIRECTIVE (CRITICAL - NATURAL ROMAN HINGLISH):
- You MUST write the entire output in natural, conversational Roman Hinglish (Hindi written using the English alphabet, blended seamlessly with technical English words).
- Example: "Is video me speaker explain kar rahe hain ki...", "Pehle 3 key takeaways yeh hain...", "Ab aapko yeh follow karna chahiye...".
- Do NOT use Devanagari script. Use Roman alphabet only.
- In Section 2, explain what happens at each timestamp in Roman Hinglish.
- Keep timestamps in format [MM:SS] exactly as shown.`;
    } else {
      languageDirective = `
LANGUAGE DIRECTIVE:
- Respond in clear, crisp, professional English.`;
    }

    let contextSection = '';
    if (video.transcriptText) {
      contextSection = `TIMED TRANSCRIPT (CHRONOLOGICAL):
${video.transcriptText}`;
    } else if (video.chapters && video.chapters.length > 0) {
      const chapterList = video.chapters.map(c => `[${c.timeStr}] ${c.title}`).join('\n');
      contextSection = `VIDEO CHAPTERS:
${chapterList}

DESCRIPTION NOTES:
${video.description || 'No description available.'}`;
    } else {
      contextSection = `VIDEO DESCRIPTION:
${video.description || 'No description available.'}`;
    }

    return `Please analyze the following YouTube video and generate a comprehensive structured video summary with CLICKABLE TIMESTAMPS adhering strictly to this format:

### 1. One-line TL;DR
Provide exactly one bold, impactful sentence capturing the core thesis, main outcome, or major takeaway of this video.

### 2. Key Chapters & Timestamps
Provide a chronological breakdown of the key moments and topics covered in the video. For each chapter, include the exact timestamp in brackets like [MM:SS] (or [HH:MM:SS]) followed by a bold topic title and 1-2 sentences explaining what is covered:
- **[00:00]**: **[Topic Title]** - [Clear explanation of what is discussed or demonstrated at this point]
- **[MM:SS]**: **[Topic Title]** - [Clear explanation of what is discussed or demonstrated at this point]

### 3. Five Key Takeaways
Provide a bulleted list of the 5 most critical insights, facts, or learnings from the video. Use bold keywords at the beginning of each bullet point:
- **[Key Concept 1]**: [Clear explanation]
- **[Key Concept 2]**: [Clear explanation]
- **[Key Concept 3]**: [Clear explanation]
- **[Key Concept 4]**: [Clear explanation]
- **[Key Concept 5]**: [Clear explanation]

### 4. What to Do Next
Provide 2 to 3 actionable next steps, practical takeaways, or decisions that the viewer should consider:
- **[Actionable Item 1]**: [Practical guidance]
- **[Actionable Item 2]**: [Practical guidance]

${languageDirective}

VIDEO METADATA:
- Title: ${video.title}
- Channel: ${video.channel || 'Unknown Channel'}
- Duration: ${video.duration ? formatSecondsToTimestamp(video.duration) : 'Unknown'}
- URL: ${video.url}

<video_context>
${contextSection}
</video_context>`;
  }

  buildSummaryPrompt(article, language = 'en') {
    const isHinglish = language === 'hi-en';

    let languageDirective = '';
    if (isHinglish) {
      languageDirective = `
LANGUAGE DIRECTIVE (CRITICAL - NATURAL ROMAN HINGLISH):
- You MUST write the entire output in natural, conversational Roman Hinglish (Hindi written using the English alphabet, blended seamlessly with technical English words).
- Example: "Yeh article explain karta hai ki...", "Pehle 3 key takeaways yeh hain...", "Ab aapko yeh karna chahiye...".
- Do NOT use Devanagari script. Use Roman alphabet only.`;
    } else {
      languageDirective = `
LANGUAGE DIRECTIVE:
- Respond in clear, crisp, professional English.`;
    }

    return `Please read the following article and generate a high-impact, clean 3-part structured summary adhering strictly to this format:

### 1. One-line TL;DR
Provide exactly one bold, impactful sentence capturing the core thesis or major takeaway of the piece.

### 2. Five Key Takeaways
Provide a bulleted list of the 5 most critical insights, facts, or takeaways from the article. Use bold keywords at the beginning of each bullet point:
- **[Key Concept 1]**: [Clear explanation]
- **[Key Concept 2]**: [Clear explanation]
- **[Key Concept 3]**: [Clear explanation]
- **[Key Concept 4]**: [Clear explanation]
- **[Key Concept 5]**: [Clear explanation]

### 3. What to Do Next
Provide 2 to 3 actionable next steps, practical takeaways, or decisions that the reader should consider:
- **[Actionable Item 1]**: [Practical guidance]
- **[Actionable Item 2]**: [Practical guidance]

${languageDirective}

ARTICLE METADATA:
- Title: ${article.title}
- Source: ${article.siteName || 'Web Article'}
- Author: ${article.byline || 'Unknown Author'}

<article_content>
${article.textContent}
</article_content>`;
  }

  renderSummary({ type, data, markdown, wordCount, readTimeMinutes, language }) {
    this.setLoading(false);

    if (this.summaryTitle) {
      this.summaryTitle.textContent = data.title || (type === 'youtube' ? 'YouTube Video' : 'Extracted Article');
    }

    if (this.summaryByline) {
      const bylineText = type === 'youtube'
        ? (data.channel ? `Channel: ${data.channel}` : '')
        : (data.byline ? `By ${data.byline}` : '');

      if (bylineText) {
        this.summaryByline.textContent = bylineText;
        this.summaryByline.style.display = 'block';
      } else {
        this.summaryByline.style.display = 'none';
      }
    }

    if (this.summaryDomain) {
      if (type === 'youtube') {
        this.summaryDomain.textContent = 'YouTube';
        this.summaryDomain.className = 'badge badge-youtube';
      } else {
        this.summaryDomain.textContent = data.siteName || 'Webpage';
        this.summaryDomain.className = 'badge badge-accent';
      }
    }

    if (this.summaryWords) {
      if (type === 'youtube' && data.duration > 0) {
        this.summaryWords.textContent = `${formatSecondsToTimestamp(data.duration)} duration`;
      } else {
        this.summaryWords.textContent = `~${wordCount.toLocaleString()} words`;
      }
    }

    if (this.summaryReadTime) {
      if (type === 'youtube') {
        const chapterCount = data.chapters?.length || 0;
        this.summaryReadTime.textContent = chapterCount > 0 ? `${chapterCount} Chapters` : 'Timed Notes';
      } else {
        this.summaryReadTime.textContent = `${readTimeMinutes} min read`;
      }
    }

    if (this.summaryLangBadge) {
      this.summaryLangBadge.textContent = language === 'hi-en' ? 'Hinglish' : 'English';
    }

    let renderedHtml = this.renderMarkdownSafely(markdown);
    renderedHtml = renderClickableTimestamps(renderedHtml);

    if (this.summaryContent) {
      this.summaryContent.innerHTML = renderedHtml;
    }

    if (this.summaryCard) {
      this.summaryCard.style.display = 'block';
      this.summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  fallbackMarkdownParser(md) {
    if (!md) return '';
    return md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>')
      .replace(/\n\n/gim, '<p></p>')
      .replace(/\n/gim, '<br/>');
  }

  async handleCopySummary() {
    if (!this.currentSummaryMarkdown) return;

    try {
      await navigator.clipboard.writeText(this.currentSummaryMarkdown);
      this.showToast('Summary copied to clipboard!');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = this.currentSummaryMarkdown;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      this.showToast('Summary copied to clipboard!');
    }
  }

  clearSummary() {
    this.currentArticle = null;
    this.currentVideo = null;
    this.currentSummaryMarkdown = '';
    if (this.summaryCard) this.summaryCard.style.display = 'none';
    this.hideError();
    this.updateGroundingStatus();
  }

  async onLanguageChange(newLang) {
    this.currentLanguage = newLang;

    if (this.summaryLangBadge) {
      this.summaryLangBadge.textContent = newLang === 'hi-en' ? 'Hinglish' : 'English';
    }

    if (this.summaryCard && this.summaryCard.style.display !== 'none') {
      if (this.currentContentType === 'youtube' && this.currentVideo) {
        this.handleSummarizeYouTube();
      } else if (this.currentContentType === 'article' && this.currentArticle) {
        this.handleSummarizePage();
      }
    }
  }

  isRestrictedUrl(url) {
    return (
      !url ||
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('devtools://') ||
      url.startsWith('view-source:') ||
      url.startsWith('about:')
    );
  }

  setLoading(isLoading, message = 'Processing...') {
    if (this.loadingCard) {
      this.loadingCard.style.display = isLoading ? 'flex' : 'none';
    }
    if (this.loadingText) {
      this.loadingText.textContent = message;
    }
    if (this.btnSummarize) {
      this.btnSummarize.disabled = isLoading;
    }
    if (this.btnSummarizeYouTube) {
      this.btnSummarizeYouTube.disabled = isLoading;
    }
  }

  showError(message) {
    if (!this.summaryError) return;
    this.summaryError.style.display = 'block';
    this.summaryError.textContent = message;
  }

  hideError() {
    if (!this.summaryError) return;
    this.summaryError.style.display = 'none';
  }

  showToast(message) {
    const toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }
}
