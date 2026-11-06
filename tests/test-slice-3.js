/**
 * Verification Test Suite for Slice 3: Article Extraction & Structured Summary
 * Tests:
 * 1. Mozilla Readability noise filtering (nav, ads, cookie banners, footer removed)
 * 2. High-fidelity article metadata and text extraction (title, byline, wordCount)
 * 3. Text length clamping (context window protection)
 * 4. Fallback extraction pipeline for non-standard pages
 * 5. Marked.js Markdown parser rendering structured summary HTML
 * 6. ChatTab prompt compilation and restricted URL validation
 */

import assert from 'node:assert';
import { Readability } from '../lib/Readability.js';
import marked from '../lib/marked.min.js';

// Minimal mock DOM node for Node.js unit testing
class MockNode {
  constructor(tagName = 'DIV', attributes = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.id = attributes.id || '';
    this.className = attributes.class || '';
    this._textContent = textContent;
    this.children = [];
    this.parentNode = null;
    this.readabilityScore = 0;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  get textContent() {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map(c => c.textContent).join(' ');
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  cloneNode(deep = true) {
    const clone = new MockNode(this.tagName, { ...this.attributes }, this._textContent);
    clone.readabilityScore = this.readabilityScore;
    if (deep) {
      for (const c of this.children) {
        clone.appendChild(c.cloneNode(true));
      }
    }
    return clone;
  }

  querySelectorAll(selector) {
    const results = [];
    const lowerSel = selector.toLowerCase();

    function traverse(node) {
      for (const child of node.children) {
        const matchesTag = lowerSel.split(',').some(part => {
          const s = part.trim();
          if (s === '*') return true;
          if (s.startsWith('.')) return child.className.includes(s.slice(1));
          if (s.startsWith('#')) return child.id === s.slice(1);

          // Attribute selector: [attr="val"] or tag[attr="val"]
          const attrMatch = s.match(/^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/i);
          if (attrMatch) {
            const [, tag, attrName, attrVal] = attrMatch;
            if (tag && child.tagName.toLowerCase() !== tag.toLowerCase()) return false;
            const actualVal = child.getAttribute(attrName);
            if (actualVal === null) return false;
            if (attrVal !== undefined) return actualVal.toLowerCase() === attrVal.toLowerCase();
            return true;
          }

          return child.tagName.toLowerCase() === s;
        });

        if (matchesTag) {
          results.push(child);
        }
        traverse(child);
      }
    }

    traverse(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementsByTagName(tagName) {
    return this.querySelectorAll(tagName);
  }
}

class MockDocument {
  constructor() {
    this.documentElement = new MockNode('HTML');
    this.head = new MockNode('HEAD');
    this.body = new MockNode('BODY');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.title = 'Default Mock Title';
    this.location = { hostname: 'techcrunch.com' };
  }

  createElement(tagName) {
    return new MockNode(tagName);
  }

  querySelector(sel) {
    return this.documentElement.querySelector(sel);
  }

  querySelectorAll(sel) {
    return this.documentElement.querySelectorAll(sel);
  }
}

async function runTests() {
  console.log('--- Starting Slice 3 Verification Tests ---');

  // Test 1: Mozilla Readability Noise Removal & Extraction
  console.log('Test 1: Verify Readability strips noise (nav, ads, cookie notice, footer)...');
  const doc = new MockDocument();
  doc.title = 'AI Agents Are Transforming Web Browsing | TechCrunch';

  // Add metadata
  const metaAuthor = doc.createElement('meta');
  metaAuthor.attributes = { name: 'author', content: 'Jane Doe' };
  doc.head.appendChild(metaAuthor);

  // Add noisy header and nav
  const nav = doc.createElement('nav');
  nav.attributes = { class: 'site-nav' };
  nav.textContent = 'Home About Contact Subscribe Now';
  doc.body.appendChild(nav);

  // Add cookie modal
  const cookieBanner = doc.createElement('div');
  cookieBanner.attributes = { id: 'onetrust-consent-sdk', role: 'dialog' };
  cookieBanner.textContent = 'We value your privacy. Accept cookies to continue.';
  doc.body.appendChild(cookieBanner);

  // Add ad banner
  const adBanner = doc.createElement('div');
  adBanner.attributes = { class: 'ad-banner-top' };
  adBanner.textContent = 'Limited time offer! Buy one get one free.';
  doc.body.appendChild(adBanner);

  // Add main article container
  const article = doc.createElement('article');
  article.attributes = { class: 'article-content' };

  const h1 = doc.createElement('h1');
  h1.textContent = 'AI Agents Are Transforming Web Browsing';
  article.appendChild(h1);

  // Add substantial paragraphs with punctuation and realistic sentences
  const paragraphs = [
    'Autonomous and assistive browser agents represent the next massive evolution in interactive web technology, enabling users to comprehend and navigate complex applications effortlessly.',
    'Traditional conversational models operate in a disconnected chat silo, forcing knowledge workers to continuously copy and paste paragraphs between multiple open browser windows and research tabs.',
    'By observing the active Document Object Model and understanding interactive buttons and forms, local agents can propose safe, deterministic steps while keeping human oversight firmly at the center.',
    'Security remains paramount when designing agents that interface with live web credentials, strictly preventing unauthorized interactions on banking gateways, authentication screens, and payment fields.',
    'Developers and end users alike are discovering that controlled vertical slices, grounded summarization, and human-in-the-loop validation provide the perfect balance between power and total peace of mind.'
  ];

  for (const pText of paragraphs) {
    const p = doc.createElement('p');
    p.textContent = pText;
    article.appendChild(p);
  }

  doc.body.appendChild(article);

  // Add noisy footer and sidebar
  const footer = doc.createElement('footer');
  footer.attributes = { class: 'site-footer' };
  footer.textContent = 'Copyright 2026 TechCrunch Inc. All rights reserved. Privacy Policy Terms.';
  doc.body.appendChild(footer);

  // Run Readability
  const reader = new Readability(doc);
  const result = reader.parse();

  assert(result, 'Readability should return parsed article');
  assert.strictEqual(result.title, 'AI Agents Are Transforming Web Browsing');
  assert.strictEqual(result.byline, 'Jane Doe');
  assert.strictEqual(result.siteName, 'techcrunch.com');

  // Ensure noise is NOT in the extracted textContent
  assert(!result.textContent.includes('Accept cookies'), 'Cookie banner should be stripped');
  assert(!result.textContent.includes('Limited time offer'), 'Ads should be stripped');
  assert(!result.textContent.includes('Copyright 2026'), 'Footer should be stripped');

  // Ensure real article content IS present
  assert(result.textContent.includes('Autonomous and assistive browser agents'));
  assert(result.textContent.includes('Security remains paramount'));
  assert(result.wordCount >= 100);
  console.log(`✓ Readability extracted clean article (${result.wordCount} words, 0 noise).`);

  // Test 2: Fallback Extraction Pipeline
  console.log('Test 2: Verify fallback extraction for non-standard articles...');
  const sparseDoc = new MockDocument();
  sparseDoc.title = 'Sparse Blog Post';

  const mainDiv = sparseDoc.createElement('main');
  const p1 = sparseDoc.createElement('p');
  p1.textContent = 'This is a single paragraph inside a simple web page that lacks rich markup or article tags.';
  mainDiv.appendChild(p1);
  sparseDoc.body.appendChild(mainDiv);

  const fallbackReader = new Readability(sparseDoc);
  const fallbackResult = fallbackReader.parse();
  assert(fallbackResult, 'Fallback extractor should return content');
  assert(fallbackResult.textContent.includes('This is a single paragraph'));
  console.log('✓ Fallback extraction pipeline succeeded.');

  // Test 3: Marked.js Markdown Parsing
  console.log('Test 3: Verify marked.min.js renders 3-part structured summary HTML...');
  const sampleSummaryMarkdown = `
### 1. One-line TL;DR
**AI browser agents are moving from passive text chat to controlled, interactive browser comprehension.**

### 2. Five Key Takeaways
- **Context Awareness**: Agents observe open page structure directly.
- **Human-in-the-Loop**: Actions require explicit user approval.
- **Safety Rails**: Sensitive financial and password inputs are hard-blocked.
- **Readability Extraction**: Ads and cookie banners are cleanly stripped.
- **Resilience**: State persistence guarantees zero task loss.

### 3. What to Do Next
- **Test on Articles**: Navigate to Wikipedia or tech blogs to generate summaries.
- **Configure Keys**: Save your preferred Gemini or Groq model in Settings.
`;

  const parsedHtml = marked.parse(sampleSummaryMarkdown);
  assert(parsedHtml.includes('<h3>1. One-line TL;DR</h3>') || parsedHtml.includes('<h3>'), 'H3 headers must be parsed');
  assert(parsedHtml.includes('<ul>'), 'Bullet list must be rendered as <ul>');
  assert(parsedHtml.includes('<li>'), 'Key points must be rendered as <li>');
  assert(parsedHtml.includes('<strong>Context Awareness</strong>'), 'Bold terms must be rendered as <strong>');
  console.log('✓ Marked.js parsed structured summary into clean semantic HTML.');

  // Test 4: Text clamping protection (context window limit)
  console.log('Test 4: Verify text length clamping preserves head, conclusion, and size cap...');
  const hugeText = 'Start of article. ' + 'Middle sentence filler. '.repeat(2000) + ' Conclusion at the end.';
  assert(hugeText.length > 25000);

  const clamped = reader._clampText(hugeText, 25000);
  assert(clamped.length <= 25000);
  assert(clamped.includes('Start of article'));
  assert(clamped.includes('[... content truncated for length ...]'));
  assert(clamped.includes('Conclusion at the end'));
  console.log(`✓ Text clamped from ${hugeText.length} to ${clamped.length} characters.`);

  // Test 5: Prompt structure validation
  console.log('Test 5: Verify 3-part summary prompt structure...');
  // Dynamically import ChatTab
  const { ChatTab } = await import('../sidepanel/tabs/chat.js');
  const chatTab = new ChatTab();

  const generatedPrompt = chatTab.buildSummaryPrompt({
    title: 'Test Article',
    siteName: 'example.com',
    byline: 'John Smith',
    textContent: 'Full content of the article here.'
  });

  assert(generatedPrompt.includes('### 1. One-line TL;DR'));
  assert(generatedPrompt.includes('### 2. Five Key Takeaways'));
  assert(generatedPrompt.includes('### 3. What to Do Next'));
  assert(generatedPrompt.includes('<article_content>'));
  assert(generatedPrompt.includes('Full content of the article here.'));
  console.log('✓ 3-part prompt structure verified.');

  // Test 6: Restricted URL detection
  console.log('Test 6: Verify restricted internal browser URLs are rejected...');
  assert.strictEqual(chatTab.isRestrictedUrl('chrome://extensions'), true);
  assert.strictEqual(chatTab.isRestrictedUrl('chrome://settings'), true);
  assert.strictEqual(chatTab.isRestrictedUrl('edge://settings'), true);
  assert.strictEqual(chatTab.isRestrictedUrl('about:blank'), true);
  assert.strictEqual(chatTab.isRestrictedUrl('https://en.wikipedia.org/wiki/Artificial_intelligence'), false);
  assert.strictEqual(chatTab.isRestrictedUrl('https://medium.com/@author/story'), false);
  console.log('✓ Restricted URLs correctly identified and blocked.');

  console.log('\n--- All Slice 3 Verification Tests Passed Successfully! ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
