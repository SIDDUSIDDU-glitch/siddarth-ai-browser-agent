/**
 * Verification Test Suite for:
 * - Slice 4: Public YouTube Summary with Clickable Timestamps
 * - Slice 5: English / Hinglish Bilingual Toggle
 */

import assert from 'node:assert';
import {
  isYouTubeUrl,
  isYouTubeWatchUrl,
  extractVideoId,
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  extractChaptersFromText,
  parseTimedTextXml,
  parseTimedTextJson3,
  groupTranscriptSegments,
  renderClickableTimestamps,
  seekVideoInPage
} from '../utils/youtube-parser.js';
import { aiClient } from '../utils/ai-client.js';
import { ChatTab } from '../sidepanel/tabs/chat.js';

async function runTests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 4 & Slice 5');
  console.log('========================================================\n');

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - YouTube URL & ID Extraction
  // ----------------------------------------------------
  console.log('--- Test Group 1: YouTube URL Detection & Video ID Extraction ---');

  // Standard watch URLs
  assert.strictEqual(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeUrl('https://www.wikipedia.org/wiki/AI'), false);
  assert.strictEqual(isYouTubeUrl(''), false);

  assert.strictEqual(isYouTubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeWatchUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeWatchUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeWatchUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeWatchUrl('https://www.youtube.com/'), false); // homepage is not watch url
  assert.strictEqual(isYouTubeWatchUrl('https://www.youtube.com/feed/subscriptions'), false);

  // Video ID parsing across all standard forms
  assert.strictEqual(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=105s&feature=share'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=45'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractVideoId('https://example.com/not-a-video'), null);
  console.log('✓ YouTube URL detection and 11-char Video ID extraction verified.');

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - Timestamp Parsing & Formatting
  // ----------------------------------------------------
  console.log('\n--- Test Group 2: Timestamp Parsing & Formatting ---');

  // MM:SS parsing
  assert.strictEqual(parseTimestampToSeconds('00:00'), 0);
  assert.strictEqual(parseTimestampToSeconds('01:45'), 105);
  assert.strictEqual(parseTimestampToSeconds('1:45'), 105);
  assert.strictEqual(parseTimestampToSeconds('10:00'), 600);
  assert.strictEqual(parseTimestampToSeconds('[02:15]'), 135);
  assert.strictEqual(parseTimestampToSeconds('(04:20)'), 260);

  // HH:MM:SS parsing
  assert.strictEqual(parseTimestampToSeconds('01:05:30'), 3930);
  assert.strictEqual(parseTimestampToSeconds('1:15:00'), 4500);

  // Natural string parsing
  assert.strictEqual(parseTimestampToSeconds('90s'), 90);
  assert.strictEqual(parseTimestampToSeconds('2m15s'), 135);
  assert.strictEqual(parseTimestampToSeconds('1h2m3s'), 3723);
  assert.strictEqual(parseTimestampToSeconds(105), 105);

  // Seconds to timestamp formatting
  assert.strictEqual(formatSecondsToTimestamp(0), '00:00');
  assert.strictEqual(formatSecondsToTimestamp(15), '00:15');
  assert.strictEqual(formatSecondsToTimestamp(105), '01:45');
  assert.strictEqual(formatSecondsToTimestamp(600), '10:00');
  assert.strictEqual(formatSecondsToTimestamp(3930), '01:05:30');
  assert.strictEqual(formatSecondsToTimestamp(4500), '01:15:00');
  console.log('✓ Bi-directional timestamp conversion verified (MM:SS & HH:MM:SS).');

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - Description Chapters Extraction
  // ----------------------------------------------------
  console.log('\n--- Test Group 3: Description Chapter Parsing ---');

  const sampleDescription = `
Check out this full tech talk on building AI browser agents!

TIMESTAMPS:
00:00 - Introduction & Motivation
01:45 - Architecture of Extension Agents
04:30 - Structured DOM Extraction vs Computer Vision
08:15 - Human-in-the-Loop Safeguards
12:40 - Live Interactive Demo
16:20 - Conclusion & Open Source Release

Links: https://github.com/example/repo
`;

  const extractedChapters = extractChaptersFromText(sampleDescription);
  assert.strictEqual(extractedChapters.length, 6);
  assert.strictEqual(extractedChapters[0].timeStr, '00:00');
  assert.strictEqual(extractedChapters[0].seconds, 0);
  assert.strictEqual(extractedChapters[0].title, 'Introduction & Motivation');

  assert.strictEqual(extractedChapters[1].timeStr, '01:45');
  assert.strictEqual(extractedChapters[1].seconds, 105);
  assert.strictEqual(extractedChapters[1].title, 'Architecture of Extension Agents');

  assert.strictEqual(extractedChapters[5].timeStr, '16:20');
  assert.strictEqual(extractedChapters[5].seconds, 980);
  console.log(`✓ Extracted ${extractedChapters.length} chapters accurately from video description.`);

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - TimedText Captions (XML & JSON3)
  // ----------------------------------------------------
  console.log('\n--- Test Group 4: Timed Transcript Parsing (XML & JSON3) ---');

  // TimedText XML
  const sampleXml = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.0" dur="2.5">Welcome everyone to this presentation.</text>
  <text start="2.5" dur="3.0">Today we&#39;re discussing &quot;Browser AI Agents&quot; &amp; safety.</text>
  <text start="5.5" dur="4.2">Let&#39;s dive into the core architecture.</text>
</transcript>`;

  const xmlSegments = parseTimedTextXml(sampleXml);
  assert.strictEqual(xmlSegments.length, 3);
  assert.strictEqual(xmlSegments[0].timeStr, '00:00');
  assert.strictEqual(xmlSegments[0].text, 'Welcome everyone to this presentation.');
  assert.strictEqual(xmlSegments[1].text, 'Today we\'re discussing "Browser AI Agents" & safety.');
  assert.strictEqual(xmlSegments[2].timeStr, '00:05');

  // TimedText JSON3
  const sampleJson3 = {
    events: [
      { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: 'Hello world' }] },
      { tStartMs: 2500, dDurationMs: 3000, segs: [{ utf8: 'This is step 2' }] }
    ]
  };

  const jsonSegments = parseTimedTextJson3(sampleJson3);
  assert.strictEqual(jsonSegments.length, 2);
  assert.strictEqual(jsonSegments[0].text, 'Hello world');
  assert.strictEqual(jsonSegments[1].text, 'This is step 2');

  // Grouping segments into paragraphs with timestamp headings
  const grouped = groupTranscriptSegments(xmlSegments, 60);
  assert(grouped.transcriptText.includes('[00:00]'));
  assert(grouped.transcriptText.includes('Welcome everyone to this presentation.'));
  assert.strictEqual(grouped.segmentsCount, 3);
  console.log('✓ Parsed timed captions and grouped into chronological transcript blocks.');

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - Interactive Clickable Timestamps
  // ----------------------------------------------------
  console.log('\n--- Test Group 5: Clickable Timestamp Button Replacement ---');

  const sampleSummaryHtml = `
<h3>2. Key Chapters & Timestamps</h3>
<ul>
  <li><strong>[00:00]</strong>: <strong>Introduction</strong> - Problem space overview.</li>
  <li><strong>[01:45]</strong>: <strong>Architecture</strong> - How side panels work.</li>
  <li><strong>[12:30]</strong>: <strong>Demo</strong> - Live element badging.</li>
</ul>
`;

  const renderedWithButtons = renderClickableTimestamps(sampleSummaryHtml);
  assert(renderedWithButtons.includes('class="yt-timestamp-btn"'), 'Must contain yt-timestamp-btn class');
  assert(renderedWithButtons.includes('data-seconds="105"'), 'Must contain data-seconds="105" for 01:45');
  assert(renderedWithButtons.includes('data-timestr="01:45"'), 'Must contain data-timestr="01:45"');
  assert(renderedWithButtons.includes('data-seconds="750"'), 'Must contain data-seconds="750" for 12:30');
  assert(renderedWithButtons.includes('title="Jump video to 01:45"'), 'Must have helpful title tooltip');
  console.log('✓ All timestamp markers converted into interactive HTML button elements.');

  // ----------------------------------------------------
  // TEST SUITE: SLICE 4 - Tab Player Seeking
  // ----------------------------------------------------
  console.log('\n--- Test Group 6: Tab Video Player Seeking Logic ---');

  // Create mock video element in a mock environment
  const mockVideo = {
    currentTime: 0,
    duration: 1080,
    paused: true,
    play() {
      this.paused = false;
      return Promise.resolve();
    }
  };

  // Mock document.querySelector
  const originalDoc = globalThis.document;
  globalThis.document = {
    querySelector: (sel) => (sel === 'video' ? mockVideo : null)
  };

  const seekResult = seekVideoInPage(105);
  assert.strictEqual(seekResult.success, true);
  assert.strictEqual(mockVideo.currentTime, 105);
  assert.strictEqual(mockVideo.paused, false, 'Video should be playing after seek');
  console.log('✓ Video element seeks to 105 seconds (01:45) and initiates playback.');

  // Restore global document
  if (originalDoc) globalThis.document = originalDoc;
  else delete globalThis.document;

  // ----------------------------------------------------
  // TEST SUITE: SLICE 5 - English / Hinglish Bilingual Toggle
  // ----------------------------------------------------
  console.log('\n--- Test Group 7: Bilingual Prompt Conditioning (English vs Hinglish) ---');

  // Test AI Client System Prompt for English
  const englishSysPrompt = aiClient.buildSystemPrompt('Custom task prompt', 'en');
  assert(englishSysPrompt.includes('Respond in clear, crisp, professional English.'));
  assert(englishSysPrompt.includes('You are Siddarth'));

  // Test AI Client System Prompt for Hinglish
  const hinglishSysPrompt = aiClient.buildSystemPrompt('Custom task prompt', 'hi-en');
  assert(hinglishSysPrompt.includes('Roman Hinglish'));
  assert(hinglishSysPrompt.includes('Do NOT output Devanagari script'));
  assert(hinglishSysPrompt.includes('Keep technical terms'));
  console.log('✓ AI Client system prompt dynamically adapts for English and Roman Hinglish.');

  // Test ChatTab prompt builder for YouTube Summary in English
  const chatTab = new ChatTab();
  const mockVideoData = {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Building AI Browser Agents',
    channel: 'Tech Talk Channel',
    duration: 980,
    transcriptText: '[00:00] Hello and welcome.\n\n[01:45] We now discuss the extension architecture.'
  };

  const enYouTubePrompt = chatTab.buildYouTubeSummaryPrompt(mockVideoData, 'en');
  assert(enYouTubePrompt.includes('### 1. One-line TL;DR'));
  assert(enYouTubePrompt.includes('### 2. Key Chapters & Timestamps'));
  assert(enYouTubePrompt.includes('### 3. Five Key Takeaways'));
  assert(enYouTubePrompt.includes('### 4. What to Do Next'));
  assert(enYouTubePrompt.includes('Respond in clear, crisp, professional English.'));
  assert(enYouTubePrompt.includes('TIMED TRANSCRIPT'));

  // Test ChatTab prompt builder for YouTube Summary in Hinglish
  const hiYouTubePrompt = chatTab.buildYouTubeSummaryPrompt(mockVideoData, 'hi-en');
  assert(hiYouTubePrompt.includes('### 1. One-line TL;DR'));
  assert(hiYouTubePrompt.includes('### 2. Key Chapters & Timestamps'));
  assert(hiYouTubePrompt.includes('NATURAL ROMAN HINGLISH'));
  assert(hiYouTubePrompt.includes('Do NOT use Devanagari script'));
  assert(hiYouTubePrompt.includes('Keep timestamps in format [MM:SS] exactly'));
  console.log('✓ YouTube summary prompt adheres to structured format with timestamps in both languages.');

  // Test ChatTab prompt builder for Article Summary in Hinglish
  const mockArticle = {
    title: 'The Future of Web Automation',
    siteName: 'techcrunch.com',
    byline: 'Jane Doe',
    textContent: 'Full content of the article here.'
  };
  const hiArticlePrompt = chatTab.buildSummaryPrompt(mockArticle, 'hi-en');
  assert(hiArticlePrompt.includes('NATURAL ROMAN HINGLISH'));
  assert(hiArticlePrompt.includes('### 1. One-line TL;DR'));
  assert(hiArticlePrompt.includes('### 2. Five Key Takeaways'));
  assert(hiArticlePrompt.includes('### 3. What to Do Next'));
  console.log('✓ Article summary prompt conditions Roman Hinglish with 3-part structure.');

  console.log('\n========================================================');
  console.log('ALL VERIFICATION TESTS FOR SLICE 4 & SLICE 5 PASSED! ✓');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

