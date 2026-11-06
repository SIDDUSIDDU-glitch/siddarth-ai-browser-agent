/**
 * Mozilla Readability Standalone Bundle for Siddarth AI Assistant
 * Implements Mozilla's core Reader View extraction algorithm.
 * Parses web articles, strips navigation/ads/cookie notices, scores content nodes,
 * and extracts clean article text, metadata, and word counts.
 */

(function (global) {
  'use strict';

  // Regular expressions for node classification & cleaning
  const REGEXPS = {
    unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|modal|nav|onetrust|paid|popup|promo|related|remark|ribbon|scroll|share|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|tracking|trustarc|tweet|twitter|video-overlay/i,
    okMaybeItsACandidate: /and|article|body|column|content|main|shadow|entry|post|story|text/i,
    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
    negative: /hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|modal|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget|ad-|cookie|popup/i,
    byline: /byline|author|post-author|article-author|written-by/i,
    extraneousTags: /^(script|style|noscript|iframe|svg|canvas|object|embed|applet)$/i
  };

  class Readability {
    /**
     * @param {Document} doc
     * @param {object} options
     */
    constructor(doc, options = {}) {
      if (!doc || !doc.documentElement) {
        throw new Error('Readability requires a valid DOM Document.');
      }
      this._doc = doc;
      this._maxElemsToParse = options.maxElemsToParse || 0;
      this._charThreshold = options.charThreshold || 250;
      this._classesToPreserve = options.classesToPreserve || [];
    }

    /**
     * Main entry point to parse readable article content
     * @returns {object|null}
     */
    parse() {
      // 1. Extract metadata
      const metadata = this._getArticleMetadata();

      // 2. Clone document body for non-destructive DOM manipulation
      const workingBody = this._doc.body ? this._doc.body.cloneNode(true) : null;
      if (!workingBody) {
        return this._fallbackExtraction(metadata);
      }

      // 3. Remove known noise & modal elements
      this._cleanNoise(workingBody);

      // 4. Identify and score candidate content nodes
      const candidates = this._scoreCandidates(workingBody);

      // 5. Select best candidate
      let topCandidate = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.readabilityScore - a.readabilityScore);
        topCandidate = candidates[0];
      }

      // 6. Build readable output
      let articleContent = '';
      let textContent = '';

      if (topCandidate && topCandidate.readabilityScore >= 15) {
        const articleDiv = this._doc.createElement('div');
        articleDiv.className = 'siddarth-readable-content';

        // Collect top candidate and siblings with matching scores
        const parent = topCandidate.parentNode;
        const siblingScoreThreshold = Math.max(10, topCandidate.readabilityScore * 0.2);

        if (parent) {
          const siblings = Array.from(parent.children);
          for (const sib of siblings) {
            let append = false;
            if (sib === topCandidate) {
              append = true;
            } else if (sib.readabilityScore && sib.readabilityScore >= siblingScoreThreshold) {
              append = true;
            } else if (sib.tagName === 'P') {
              const linkDensity = this._getLinkDensity(sib);
              const nodeLength = (sib.textContent || '').trim().length;
              if (nodeLength > 60 && linkDensity < 0.3) {
                append = true;
              }
            }

            if (append) {
              articleDiv.appendChild(sib.cloneNode(true));
            }
          }
        } else {
          articleDiv.appendChild(topCandidate.cloneNode(true));
        }

        // Clean any residual unwanted elements in output
        this._cleanArticle(articleDiv);

        articleContent = articleDiv.innerHTML;
        textContent = this._sanitizeWhitespace(articleDiv.textContent || '');
      }

      // 7. Check if word count is sufficient; if < 150 words, run fallback pipeline
      const wordCount = textContent.split(/\s+/).filter(Boolean).length;
      if (wordCount < 150) {
        return this._fallbackExtraction(metadata);
      }

      // 8. Cap textContent to 25,000 characters with smart truncation
      const clampedText = this._clampText(textContent, 25000);

      return {
        title: metadata.title,
        byline: metadata.byline,
        excerpt: metadata.excerpt,
        siteName: metadata.siteName,
        content: articleContent,
        textContent: clampedText,
        length: clampedText.length,
        wordCount: clampedText.split(/\s+/).filter(Boolean).length
      };
    }

    /**
     * Extracts title, byline, excerpt, and site name from document meta
     */
    _getArticleMetadata() {
      const doc = this._doc;
      let title = '';
      let byline = '';
      let excerpt = '';
      let siteName = '';

      // Title extraction
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
      const twitterTitle = doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content');
      const h1 = doc.querySelector('h1')?.textContent?.trim();

      title = ogTitle || twitterTitle || h1 || doc.title || '';
      // Remove trailing site separators (e.g. "Article Title | The Verge")
      title = title.replace(/\s+[|\-–—]\s+[^|\-–—]+$/, '').trim();

      // Byline extraction
      const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
                         doc.querySelector('meta[property="article:author"]')?.getAttribute('content');
      const bylineElem = doc.querySelector('[rel="author"], .byline, .author, [class*="byline"], [class*="author"]');

      byline = metaAuthor || bylineElem?.textContent?.trim() || '';
      byline = byline.replace(/^by\s+/i, '').trim();

      // Excerpt extraction
      excerpt = doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
                doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content') || '';

      // Site name extraction
      siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
                 doc.location?.hostname?.replace(/^www\./, '') || '';

      return { title, byline, excerpt, siteName };
    }

    /**
     * Removes ads, cookie banners, navigation, and modal dialogues
     */
    _cleanNoise(node) {
      // Remove unwanted tag types
      const elements = node.querySelectorAll('*');
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        const tag = el.tagName.toLowerCase();

        if (REGEXPS.extraneousTags.test(tag)) {
          el.remove();
          continue;
        }

        // Remove modals and cookie banners
        const idAndClass = `${el.id} ${el.className}`;
        if (el.getAttribute('role') === 'dialog' ||
            el.getAttribute('aria-modal') === 'true' ||
            REGEXPS.unlikelyCandidates.test(idAndClass)) {
          if (!REGEXPS.okMaybeItsACandidate.test(idAndClass)) {
            el.remove();
          }
        }
      }
    }

    /**
     * Traverses elements and scores candidates based on content density
     */
    _scoreCandidates(node) {
      const candidates = [];
      const paragraphs = node.querySelectorAll('p, pre, td, blockquote');

      paragraphs.forEach((p) => {
        const text = p.textContent?.trim() || '';
        if (text.length < 25) return;

        let parent = p.parentNode;
        let grandParent = parent ? parent.parentNode : null;

        if (!parent || parent.tagName === 'BODY') return;

        // Initialize score if not yet initialized
        if (!parent.readabilityScore) {
          this._initNodeScore(parent);
          candidates.push(parent);
        }

        if (grandParent && grandParent.tagName !== 'BODY' && !grandParent.readabilityScore) {
          this._initNodeScore(grandParent);
          candidates.push(grandParent);
        }

        // Score addition for this paragraph
        let contentScore = 1;
        // Count commas/semicolons (indicates sentences)
        contentScore += (text.split(',').length - 1);
        contentScore += (text.split(';').length - 1);
        // Length bonus
        contentScore += Math.min(Math.floor(text.length / 80), 3);

        parent.readabilityScore += contentScore;
        if (grandParent) {
          grandParent.readabilityScore += contentScore / 2;
        }
      });

      // Scale score by link density
      for (const cand of candidates) {
        cand.readabilityScore = cand.readabilityScore * (1 - this._getLinkDensity(cand));
      }

      return candidates;
    }

    /**
     * Assigns initial weight based on tag name, class, and ID
     */
    _initNodeScore(node) {
      let score = 0;
      switch (node.tagName) {
        case 'DIV': score += 5; break;
        case 'PRE':
        case 'TD':
        case 'BLOCKQUOTE': score += 3; break;
        case 'ADDRESS':
        case 'OL':
        case 'UL':
        case 'DL':
        case 'DD':
        case 'DT':
        case 'LI':
        case 'FORM': score -= 3; break;
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
        case 'TH': score -= 5; break;
      }

      const matchString = `${node.className} ${node.id}`;
      if (REGEXPS.positive.test(matchString)) score += 25;
      if (REGEXPS.negative.test(matchString)) score -= 25;

      node.readabilityScore = score;
    }

    /**
     * Calculates ratio of link text to total text
     */
    _getLinkDensity(node) {
      const textLength = node.textContent?.trim().length || 0;
      if (textLength === 0) return 0;

      let linkLength = 0;
      const links = node.getElementsByTagName('a');
      for (let i = 0; i < links.length; i++) {
        linkLength += links[i].textContent?.trim().length || 0;
      }

      return linkLength / textLength;
    }

    /**
     * Removes residual unwanted markup from the extracted article container
     */
    _cleanArticle(articleElement) {
      const toRemove = articleElement.querySelectorAll(
        'form, button, input, select, textarea, style, script, noscript, [role="navigation"], [role="banner"], [role="complementary"]'
      );
      toRemove.forEach((el) => el.remove());
    }

    /**
     * Secondary fallback extraction for SPAs or non-standard blogs
     */
    _fallbackExtraction(metadata) {
      const doc = this._doc;
      const mainContainer = doc.querySelector('main, article, [role="main"], #content, .content, #main');
      const root = mainContainer || doc.body;

      if (!root) {
        return null;
      }

      const textBlocks = [];
      const nodes = root.querySelectorAll('h1, h2, h3, h4, p, li, blockquote');

      nodes.forEach((n) => {
        // Skip hidden elements
        const style = global.getComputedStyle ? global.getComputedStyle(n) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          return;
        }

        const txt = n.textContent?.trim() || '';
        if (txt.length > 20) {
          textBlocks.push(txt);
        }
      });

      const fullText = this._sanitizeWhitespace(textBlocks.join('\n\n'));
      if (!fullText) {
        return null;
      }

      const clampedText = this._clampText(fullText, 25000);

      return {
        title: metadata.title,
        byline: metadata.byline,
        excerpt: metadata.excerpt,
        siteName: metadata.siteName,
        content: `<div>${clampedText.split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>`,
        textContent: clampedText,
        length: clampedText.length,
        wordCount: clampedText.split(/\s+/).filter(Boolean).length
      };
    }

    /**
     * Normalizes excessive whitespace and line breaks
     */
    _sanitizeWhitespace(str) {
      return (str || '')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ \u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    /**
     * Caps text length while intelligently preserving head, body, and tail
     */
    _clampText(text, maxChars = 25000) {
      if (!text || text.length <= maxChars) {
        return text;
      }

      // Preserve first 18,000 characters and last 6,000 characters with ellipsis
      const head = text.slice(0, 18000);
      const tail = text.slice(text.length - 6000);
      return `${head.trim()}\n\n[... content truncated for length ...]\n\n${tail.trim()}`;
    }
  }

  // Export to global scope / UMD
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Readability };
  } else {
    global.Readability = Readability;
  }
})(typeof window !== 'undefined' ? window : globalThis);

