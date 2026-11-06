/**
 * Chat & Article Summary Tab Controller for Siddarth AI Assistant
 * Extracts readable article content via Mozilla Readability and
 * generates a structured 3-part summary (TL;DR, 5 Key Points, What to do next)
 * with Markdown rendering and clipboard export.
 */

import { aiClient } from '../../utils/ai-client.js';
import { getSettings } from '../../utils/storage-manager.js';

export class ChatTab {
  constructor(options = {}) {
    this.onNavigateTab = options.onNavigateTab || (() => {});
    this.currentArticle = null;
    this.currentSummaryMarkdown = '';
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    if (typeof document === 'undefined') return;

    // Buttons
    this.btnSummarize = document.getElementById('quick-btn-summarize');
    this.btnCopySummary = document.getElementById('btn-copy-summary');
    this.btnResummarize = document.getElementById('btn-resummarize');
    this.btnClearSummary = document.getElementById('btn-clear-summary');

    // Containers
    this.welcomeCard = document.getElementById('chat-welcome-card');
    this.quickActionsCard = document.getElementById('chat-quick-actions-card');
    this.loadingCard = document.getElementById('summary-loading-card');
    this.loadingText = document.getElementById('summary-loading-text');
    this.summaryCard = document.getElementById('summary-result-card');
    this.summaryError = document.getElementById('summary-error-box');

    // Summary metadata display
    this.summaryTitle = document.getElementById('summary-article-title');
    this.summaryByline = document.getElementById('summary-article-byline');
    this.summaryDomain = document.getElementById('summary-badge-domain');
    this.summaryWords = document.getElementById('summary-badge-words');
    this.summaryReadTime = document.getElementById('summary-badge-readtime');
    this.summaryLangBadge = document.getElementById('summary-badge-lang');
    this.summaryContent = document.getElementById('summary-html-content');
  }

  bindEvents() {
    if (typeof document === 'undefined') return;

    this.btnSummarize?.addEventListener('click', () => this.handleSummarizePage());
    this.btnCopySummary?.addEventListener('click', () => this.handleCopySummary());
    this.btnResummarize?.addEventListener('click', () => this.handleSummarizePage());
    this.btnClearSummary?.addEventListener('click', () => this.clearSummary());
  }

  /**
   * Main pipeline: Extract page -> Generate 3-part summary -> Render Markdown
   */
  async handleSummarizePage() {
    this.hideError();

    // 1. Check API Key configuration
    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim()) {
      this.showError('Gemini API key is required. Please configure your key in Settings first.');
      this.onNavigateTab('settings');
      return;
    }

    // 2. Query active browser tab
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

    // 3. Check for restricted browser internal URLs
    const url = activeTab.url || '';
    if (this.isRestrictedUrl(url)) {
      this.showError(
        'Siddarth cannot interact with internal browser pages (such as chrome://, new tab, or settings). Please open an article on a website like Wikipedia, Medium, or news to generate a summary.'
      );
      return;
    }

    // 4. Extract content using Mozilla Readability
    this.setLoading(true, 'Extracting readable article content with Mozilla Readability...');

    let extracted = null;
    try {
      // Inject Readability and content script bundle
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['lib/Readability.js', 'content/readability-bundle.js']
      });

      extracted = injectionResults?.[0]?.result;
    } catch (injErr) {
      console.warn('[Siddarth] executeScript injection failed, attempting message dispatch:', injErr);
      try {
        extracted = await chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_PAGE_CONTENT' });
      } catch (msgErr) {
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

    this.currentArticle = extracted;

    // 5. Build prompt for 3-part structured summary
    const wordCount = extracted.wordCount || extracted.textContent.split(/\s+/).filter(Boolean).length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    const lang = settings.defaultLanguage || 'en';

    this.setLoading(
      true,
      `Generating structured 3-part summary with ${settings.preferredModel || 'Gemini Flash-Lite'}...`
    );

    const prompt = this.buildSummaryPrompt(extracted);

    try {
      // 6. Call Gemini API
      const summaryMarkdown = await aiClient.generateText({
        prompt,
        systemPrompt: 'You are an expert executive reading assistant. Your summaries are structured, crisp, informative, and free of fluff.',
        model: settings.preferredModel,
        language: lang,
        temperature: 0.3,
        maxTokens: 2048
      });

      this.currentSummaryMarkdown = summaryMarkdown;

      // 7. Render Markdown into crisp HTML
      this.renderSummary({
        article: extracted,
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
   * Builds the prompt requesting the exact 3-part summary structure
   */
  buildSummaryPrompt(article) {
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

ARTICLE METADATA:
- Title: ${article.title}
- Source: ${article.siteName || 'Web Article'}
- Author: ${article.byline || 'Unknown Author'}

<article_content>
${article.textContent}
</article_content>`;
  }

  /**
   * Renders the generated summary and metadata into the UI
   */
  renderSummary({ article, markdown, wordCount, readTimeMinutes, language }) {
    this.setLoading(false);

    if (this.summaryTitle) {
      this.summaryTitle.textContent = article.title || 'Extracted Article';
    }

    if (this.summaryByline) {
      if (article.byline) {
        this.summaryByline.textContent = `By ${article.byline}`;
        this.summaryByline.style.display = 'block';
      } else {
        this.summaryByline.style.display = 'none';
      }
    }

    if (this.summaryDomain) {
      this.summaryDomain.textContent = article.siteName || 'Webpage';
    }

    if (this.summaryWords) {
      this.summaryWords.textContent = `~${wordCount.toLocaleString()} words`;
    }

    if (this.summaryReadTime) {
      this.summaryReadTime.textContent = `${readTimeMinutes} min read`;
    }

    if (this.summaryLangBadge) {
      this.summaryLangBadge.textContent = language === 'hi-en' ? 'Hinglish' : 'English';
    }

    // Parse Markdown to HTML
    let renderedHtml = '';
    if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
      renderedHtml = window.marked.parse(markdown);
    } else {
      renderedHtml = this.fallbackMarkdownParser(markdown);
    }

    if (this.summaryContent) {
      this.summaryContent.innerHTML = renderedHtml;
    }

    if (this.summaryCard) {
      this.summaryCard.style.display = 'block';
      this.summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Simple fallback Markdown parser if marked library is not available
   */
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

  /**
   * Copies active summary markdown to clipboard
   */
  async handleCopySummary() {
    if (!this.currentSummaryMarkdown) return;

    try {
      await navigator.clipboard.writeText(this.currentSummaryMarkdown);
      this.showToast('Summary copied to clipboard!');
    } catch (err) {
      // Fallback copy using textarea
      const textarea = document.createElement('textarea');
      textarea.value = this.currentSummaryMarkdown;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      this.showToast('Summary copied to clipboard!');
    }
  }

  /**
   * Clears the summary and restores the default quick action view
   */
  clearSummary() {
    this.currentArticle = null;
    this.currentSummaryMarkdown = '';
    if (this.summaryCard) this.summaryCard.style.display = 'none';
    this.hideError();
  }

  /**
   * Handles language change notification from main app
   */
  async onLanguageChange(newLang) {
    // If we have an article already loaded, re-summarize in the new language
    if (this.currentArticle && this.summaryCard && this.summaryCard.style.display !== 'none') {
      this.handleSummarizePage();
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
