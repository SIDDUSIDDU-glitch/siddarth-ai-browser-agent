/**
 * Readability Bundle Content Script for Siddarth AI Assistant
 * Extracts clean, readable article content from the active webpage,
 * stripping ads, navbars, and cookie banners.
 */

(function () {
  'use strict';

  /**
   * Main extractor function
   */
  function extractPageContent() {
    try {
      // 1. Check if Mozilla Readability is loaded
      let parsed = null;
      if (typeof window.Readability === 'function') {
        try {
          const reader = new window.Readability(document);
          parsed = reader.parse();
        } catch (rErr) {
          console.warn('[Siddarth] Readability parsing exception:', rErr);
        }
      }

      // 2. Fallback if Readability fails or returns insufficient content
      if (!parsed || !parsed.textContent || parsed.textContent.length < 150) {
        parsed = fallbackExtractor();
      }

      if (!parsed || !parsed.textContent) {
        return {
          success: false,
          error: 'No readable article content found on this webpage.'
        };
      }

      const wordCount = parsed.wordCount || parsed.textContent.split(/\s+/).filter(Boolean).length;

      return {
        success: true,
        title: parsed.title || document.title || 'Untitled Page',
        byline: parsed.byline || '',
        excerpt: parsed.excerpt || '',
        siteName: parsed.siteName || window.location.hostname.replace(/^www\./, ''),
        url: window.location.href,
        length: parsed.length || parsed.textContent.length,
        wordCount,
        textContent: parsed.textContent,
        content: parsed.content || ''
      };
    } catch (err) {
      console.error('[Siddarth] Content extraction error:', err);
      return {
        success: false,
        error: `Extraction error: ${err.message}`
      };
    }
  }

  /**
   * Fallback DOM text extractor for non-standard articles, dashboards, or SPAs
   */
  function fallbackExtractor() {
    const mainEl = document.querySelector('article, main, [role="main"], #content, .post, .article');
    const root = mainEl || document.body;

    if (!root) return null;

    // Filter out standard noisy selectors
    const noiseSelectors = [
      'nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript',
      'iframe', '.cookie-banner', '#onetrust', '[role="dialog"]',
      '.ads', '.ad', '.sidebar', '.social-share', '.comments'
    ];

    const cloned = root.cloneNode(true);
    noiseSelectors.forEach((sel) => {
      cloned.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const paragraphs = cloned.querySelectorAll('h1, h2, h3, h4, p, li, blockquote');
    const textPieces = [];

    paragraphs.forEach((p) => {
      const txt = p.textContent?.trim() || '';
      if (txt.length > 25) {
        textPieces.push(txt);
      }
    });

    const fullText = textPieces.join('\n\n').trim();
    if (!fullText) return null;

    return {
      title: document.querySelector('h1')?.textContent?.trim() || document.title,
      byline: '',
      excerpt: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      siteName: window.location.hostname.replace(/^www\./, ''),
      content: cloned.innerHTML,
      textContent: fullText,
      length: fullText.length,
      wordCount: fullText.split(/\s+/).filter(Boolean).length
    };
  }

  // Register message listener for chrome.runtime messaging
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'EXTRACT_PAGE_CONTENT') {
        const result = extractPageContent();
        sendResponse(result);
        return false;
      }
    });
  }

  // Also expose on window for direct executeScript return value
  window.__siddarthExtractor = {
    extract: extractPageContent
  };

  // Immediate return for chrome.scripting.executeScript results
  return extractPageContent();
})();

