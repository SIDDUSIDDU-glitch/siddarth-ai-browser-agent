# Siddarth: Context-Aware Chrome Side-Panel AI Browser Agent

> **An in-browser agentic AI companion built on Chrome Extension Manifest V3, bridging passive conversational LLMs and active web reading with high-fidelity article extraction, rate-limit resilience, and strict human-in-the-loop safety.**

---

## 1. Project Overview & Executive Summary

Modern web research and browsing workflows suffer from severe context fragmentation. Knowledge workers, students, and engineers frequently find themselves trapped in a repetitive cycle of toggling between browser tabs, manually copying and pasting lengthy articles into external AI chat interfaces, and describing webpage structures to models that cannot see or interact with the active DOM. Existing automated agents either rely on complex, costly remote servers or run unconstrained autonomous loops that risk accidental clicks, destructive form submissions, or privacy leaks.

**Siddarth** directly solves this dilemma. Built natively inside Google Chrome utilizing the modern **Manifest V3 Side Panel API**, Siddarth sits persistently beside the user's active browsing tab. It inspects the live Document Object Model (DOM), extracts distraction-free content using an embedded **Mozilla Readability** engine, strips noise (such as cookie banners, advertisement banners, navigation menus, and footers), and synthesizes high-impact **3-part structured summaries** (1-line TL;DR, 5 Key Concept Takeaways, and Actionable Next Steps) powered by Google's generative models (**Gemini Flash-Lite** / **Gemini Flash**) and fast **Groq Cloud** fallbacks.

All operations adhere to a strict **Human-in-the-Loop** paradigm with zero-compromise deterministic security: API credentials and user profile information are stored exclusively inside local browser sandboxes (`chrome.storage.local`), ensuring zero unauthorized telemetry and complete privacy.

---

## 2. Key Capabilities & Vertical Slices Built

### Phase 1: The Eyes (Read & Comprehend the Web)

#### Slice 1: Extension Shell, Side Panel & Storage Foundations
- **Manifest V3 Architecture**: Configured with modern Chrome extension permissions (`sidePanel`, `storage`, `activeTab`, `scripting`, `contextMenus`, `tabs`, and `<all_urls>` host permissions).
- **Side Panel UI**: Persistent multi-view interface with dedicated tabs for **Chat**, **Agent**, **Profile**, and **Settings**.
- **Modern Theme & Design System**: Responsive CSS design token system featuring dark neutral backgrounds, high-contrast badges, glowing loaders, and accessible interactive buttons.
- **Typed Storage Manager**: Promise-based wrapper around `chrome.storage.local` managing user credentials, preferences, session checkpoints, and execution audit trails.

#### Slice 2: Gemini & Groq Live AI Integration with Token Tracking
- **Unified AI Client (`utils/ai-client.js`)**: Direct REST client communicating with Google Gemini API Studio (`generativelanguage.googleapis.com/v1beta`) and Groq Cloud (`api.groq.com/openai/v1`).
- **Endpoint Auto-Resolution**: Supports active production models (`gemini-flash-lite-latest`, `gemini-3.5-flash-lite`, `gemini-flash-latest`, `gemini-3.8-flash`, and Groq's `openai/gpt-oss-120b`), automatically mapping deprecated model IDs to active production endpoints.
- **Connection Verification**: "Test Gemini Connection" and "Test Groq Connection" buttons send a live sample probe prompt (`"Ping"`) to verify latency, token consumption, and response accuracy (`"Pong"`).
- **Persistent Token Tracking**: In-memory and storage-synchronized token consumption counters tracking prompt tokens, candidate tokens, total tokens, and request counts, complete with a reset utility in Settings.
- **Rate-Limit Resilience (HTTP 429)**: Integrated 3-stage exponential backoff with jitter and automated text fallback to Groq when Gemini rate limits are hit.

#### Slice 3: Article Extraction & Structured 3-Part Summaries
- **Embedded Mozilla Readability (`lib/Readability.js`)**: Standalone DOM parsing engine that clones the document, strips noise elements (e.g. `#onetrust`, `.cookie-banner`, `[role="dialog"]`, `<nav>`, `<footer>`, `<aside>`, and `.ad-banner`), scores paragraphs based on density and sentence punctuation, and extracts clean article text.
- **Context-Window Protection**: Intelligently clamps massive articles (exceeding 25,000 characters) by preserving the article head, lead arguments, and concluding sections while filtering boilerplate.
- **Secondary Fallback Extractor**: Gracefully handles non-standard Single Page Applications (SPAs) and blogs lacking formal semantic `<article>` tags.
- **Structured 3-Part Summary Engine**:
  1. **### 1. One-line TL;DR**: A bold single sentence capturing the core thesis.
  2. **### 2. Five Key Takeaways**: 5 structured bullet points highlighting critical concepts with bold headings.
  3. **### 3. What to Do Next**: 2 to 3 actionable takeaways and practical conclusions.
- **Marked.js Markdown Parser (`lib/marked.min.js`)**: Bundled local UMD parser rendering markdown into clean, accessible HTML without external CDNs.
- **Export & Language Toggles**: One-click **Copy Summary** to clipboard, re-summarization triggers, and dynamic prompt conditioning between English and natural Roman Hinglish (`hi-en`).

#### Slice 4: Public YouTube Summary with Clickable Timestamps
- **YouTube Intelligence (`utils/youtube-parser.js`)**: Detects YouTube URLs across formats (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`), parses 11-character video IDs, and converts timestamps bi-directionally (`MM:SS` & `HH:MM:SS` <-> total seconds).
- **In-Tab Video & Caption Extractor**: Injects non-intrusive metadata extraction into YouTube tabs, retrieving title, channel name, video duration, description chapters, and timed caption tracks (`captionTracks`).
- **Timed Subtitle Parsing**: Parses both YouTube TimedText JSON3 and XML formats, grouping contiguous subtitle segments into chronological timestamped blocks (`[00:00]`, `[01:00]`).
- **Structured Video Summary Format**:
  1. **### 1. One-line TL;DR**: Core thesis and major conclusion of the video.
  2. **### 2. Key Chapters & Timestamps**: Chronological chapter markers in `[MM:SS]` format with bold titles and contextual descriptions.
  3. **### 3. Five Key Takeaways**: 5 core concepts and takeaways with bold keywords.
  4. **### 4. What to Do Next**: Practical recommendations and action steps for viewers.
- **Interactive Clickable Timestamps**: Automatically converts all timestamp patterns (`[01:45]`, `01:45`) into interactive HTML button badges (`.yt-timestamp-btn`). Clicking any timestamp instantly seeks the active tab's `<video>` element to that exact second and resumes playback.

#### Slice 5: English / Hinglish Bilingual Toggle
- **One-Click Header Toggle**: Header pill switch (`EN` | `HI-EN`) providing instant language switching.
- **Persistent Language Preference**: Selected language persists automatically to `chrome.storage.local` across browser restarts.
- **Dynamic Prompt Conditioning**:
  - *English*: Concise, professional, standard vocabulary.
  - *Hinglish*: Conversational hybrid Hindi-in-Roman-script (e.g., "Yeh video explain karta hai ki...", "Pehle 3 key takeaways yeh hain..."). Strictly enforces Roman script (no Devanagari) and preserves technical terminology in English.
- **Dynamic Re-Summarization**: Toggling the language pill while a summary is open automatically re-generates the notes in the selected language.

### Phase 2: The Brain (Understand the Page & Screen)

#### Slice 6: Grounded Page Chat with Streaming & Anti-Hallucination
- **Grounded Conversational Interface (`sidepanel/tabs/chat.js`)**: Real-time interactive conversation grounded strictly in extracted DOM content or YouTube transcript data.
- **Strict Anti-Hallucination Guardrails**: Hardcoded system prompt directing:
  - *English*: `"You are Siddarth. Answer strictly based on the provided page context. If the answer is not contained in the text, explicitly state: 'This information is not available on the current page.'"`
  - *Hinglish*: `"You are Siddarth. Answer strictly based on the provided page context in conversational Roman Hinglish. If the answer is not contained in the text, explicitly state: 'Yeh information current page par available nahi hai.'"`
- **Server-Sent Events (SSE) Streaming**: Direct Gemini `streamGenerateContent?alt=sse` integration rendering tokens in real time with an animated blinking cursor and instant Markdown formatting.
- **Multi-Turn Context & History**: Maintains conversational memory across multiple turns while keeping the grounded `<page_context>` pinned.
- **Abort & Cancellation Support**: Integrated `AbortController` enabling users to stop streaming at any moment.
- **On-The-Fly Page Grounding**: If the user asks a question without summarizing first, Siddarth automatically extracts the active tab's DOM via Readability and grounds the chat.
- **Suggestion Chips**: One-click quick question chips ("Core Thesis", "3 Takeaways", "Next Steps") for immediate interaction.

#### Slice 7: Context-Menu Quick Actions (Explain, Translate, Draft a Reply)
- **Chrome Right-Click Integration (`background/service-worker.js`)**: Registers parent menu `Siddarth AI` and 3 sub-actions (`Explain this in plain language`, `Translate to Hindi / Hinglish`, `Draft a reply to this`) active on any highlighted text selection.
- **Cold-Boot & Lifecycle Resilience**: If the side panel is closed when a context menu is clicked, the background worker automatically opens the side panel (`chrome.sidePanel.open`) and persists the pending action in `chrome.storage.local` (`siddarth_pending_context_action`). Upon mount, the side panel immediately consumes the payload and runs the prompt.
- **Explain This**: Breaks down highlighted jargon into a 3-part guide (plain-language summary, key terms, and intuitive analogy).
- **Translate**: Translates text into clean English or conversational Roman Hinglish with cultural and technical nuances.
- **Draft a Reply**: Generates two response drafts: Option A (professional & structured) and Option B (friendly & conversational).
- **Interactive Multi-Turn Continuation**: Context action prompts and streamed replies are seamlessly added to the chat history, allowing users to ask follow-up questions.

#### Slice 8: Screenshot-and-Ask (Multimodal Vision)
- **Visible Tab Capture (`background/service-worker.js`)**: Communicates with the service worker using `chrome.tabs.captureVisibleTab(null, { format: 'png' })` to grab high-resolution PNG viewports of the active window.
- **Interactive Canvas Crop & Focus Selector (`sidepanel/tabs/chat.js`)**: Built-in canvas overlay allowing users to drag a bounding box directly on the captured image to focus on specific charts, tables, or error banners. Includes "Full View", "Reset Crop", and live dimension badges.
- **Multimodal Payload Builder (`utils/ai-client.js`)**: Formats Gemini Flash multimodal contents (`parts: [{ text: prompt }, { inlineData: { mimeType, data: cleanBase64 } }]`), automatically routing vision tasks to `gemini-flash-latest` (`gemini-2.0-flash`).
- **Real-Time Multimodal Streaming (`streamScreenshot`)**: Streams multimodal vision explanations token-by-token via SSE, rendering with live Markdown and copy actions.
- **Chat History & Thumbnail Previews**: Renders captured image thumbnails in user message bubbles alongside visual tags, preserving the multi-turn context for follow-up conversational reasoning.
- **Chart Reasoning Verification**: Verified against bar chart data (`sample-chart.html`) answering: *"Which month had the highest sales?"* -> Model accurately reads the chart image and identifies **March ($88,000)**.

#### Slice 9: Free-Tier Resilience & Fallback Engine
- **3-Stage Exponential Backoff with Jitter (`utils/ai-client.js`)**: Automatically intercepts rate limits (HTTP 429) and transient server errors (HTTP 500 / 503). Retries across 3 exponential intervals (`(2^attempt) * 1000ms + random_jitter`) to smoothly absorb burst rate limits.
- **Automatic Secondary Dispatch to Groq API**: When 3 retry stages are exhausted on Gemini (or if quota is spent), requests transparently failover to Groq Cloud (`llama-3.3-70b-versatile` / `openai/gpt-oss-120b`) with zero UI crash.
- **Real-Time Groq SSE Streaming (`streamGroqFallback`)**: In streaming mode, Groq SSE tokens stream into the side panel seamlessly, preserving blinking cursor animation and word-by-word rendering.
- **Multimodal Safety Guard**: Intelligently prevents image/multimodal payloads from routing to text-only Groq, ensuring appropriate error reporting for vision tasks.
- **Settings Fallback Management (`sidepanel/tabs/settings.js`)**: Interactive toggle for rate-limit fallback, custom Groq API key configuration, fallback model selector (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-120b`), and live fallback engine status badge (`⚡ Fallback Active`).

---

### Phase 3: The Hands (Interactive Autonomous Web Navigation & Execution)

#### Slice 10: Interactive Element Scanner & Visual Numbered Badging
- **DOM Element Scanner (`content/scanner.js`)**: Traverses the active viewport detecting clickable, typable, and selectable elements (`<a>`, `<button>`, `<input>`, `<textarea>`, `<select>`, and `[role="button"]`).
- **Visibility & Accessibility Filtering**: Computes bounding boxes, checks `getComputedStyle` (`display`, `visibility`, `opacity`), and ignores obscured or 0-area DOM elements.
- **Visual Highlighter & Badge Overlay (`content/highlighter.js`)**: Injects floating numbered badges (`#1`, `#2`, `#3`) over interactive elements using CSS transforms, high-contrast amber/indigo badges, and pulsating focus rings.
- **Auto-Sync & Viewport Tracking**: Re-computes element coordinates upon user scroll or resize, maintaining badge alignment without DOM corruption.
- **Sanitized Interactive Summary Payload**: Generates a compact JSON snapshot (`[{ index: 1, tag: 'input', type: 'text', name: 'email', label: 'Email Address' }]`) passed directly to the LLM agent planner.

#### Slice 11: Human-in-the-Loop Confirmation Drawer for Destructive Actions
- **Safety Classifier**: Evaluates planned actions and tags any potentially irreversible or consequential action (`submit`, `delete`, `remove`, `pay`, `purchase`, `checkout`, `transfer`).
- **Interactive Slide-Up Drawer (`sidepanel/tabs/agent.js`)**: Halts automated execution and slides up an attention-grabbing amber/crimson confirmation drawer.
- **Contextual Preview & Target Inspection**: Displays target element index, DOM selector, action verb, proposed input values, and safety rationale before execution.
- **Explicit User Controls**: Provides **"Approve & Execute"** and **"Cancel Action"** buttons. Execution never continues without explicit user authorization.

#### Slice 12: Natural Language Action Planner & Reasoning Loop
- **Multi-Step Agent Controller (`sidepanel/tabs/agent.js`)**: Orchestrates the autonomous perception-planning-action cycle (Scan -> Plan -> Confirm -> Execute -> Verify).
- **Structured JSON Action Schema**: Constrains model outputs to strict JSON:
  ```json
  {
    "thought": "I need to enter the user's search query into the search bar.",
    "action": "type",
    "targetIndex": 2,
    "value": "Gemini 2.0 Flash features",
    "isDestructive": false,
    "completed": false
  }
  ```
- **Live Agent State Machine**: Transitions cleanly across states (`IDLE`, `SCANNING`, `PLANNING`, `WAITING_CONFIRMATION`, `EXECUTING`, `COMPLETED`, `ERROR`, `PAUSED`).
- **Context Injection**: Dynamically injects the active page title, current URL, user profile memory, and interactive element list into each planning prompt.

#### Slice 13: Deterministic Action Execution Engine (Click, Fill, Scroll, Navigate)
- **DOM Action Executor (`content/executor.js`)**: Dispatches synthetic DOM events replicating real user interaction (`MouseEvent`, `FocusEvent`, `InputEvent`, `KeyboardEvent`, and `change`).
- **Keystroke Simulation & React/Vue Compatibility**: Overrides standard `HTMLInputElement.prototype.value` setter to trigger framework reactive bindings and input masks.
- **Action Primitives Supported**:
  - `click`: Dispatches pointerdown, mousedown, mouseup, and click sequence.
  - `type`: Focuses, clears, enters string character-by-character, and emits input/change.
  - `select`: Selects specified option value or label in `<select>` elements.
  - `scroll`: Smoothly scrolls active viewport vertically (`up` or `down`) or into specific element bounds.
  - `navigate`: Redirects active tab to specified destination URL.
- **Post-Action Verification**: Verifies element state changes and detects navigation triggers before prompting the agent for the subsequent step.

---

### Phase 4: Production Polish, Privacy & Release Packaging

#### Slice 14: Personal Profile & Auto-Fill Skills Engine
- **Local Profile Memory (`sidepanel/tabs/profile.js`)**: Persistent, local-first user profile store managing:
  - Personal details: Full Name, Email, Phone Number, College / University, Current Role, Graduation Year.
  - Links: GitHub Profile, LinkedIn URL, Portfolio Website.
  - Custom Bio, Skills list, and Tone preference (Professional, Casual, Academic, Concise).
- **Profile Injection in Autonomous Form Filling**: The agent automatically cross-references empty form inputs against local profile fields, filling applications in seconds without copy-pasting.
- **5 Reusable Production Skills**:
  1. **Exam Notes Generator**: Condenses articles/papers into high-yield revision cards with mnemonic anchors.
  2. **Explain in Hinglish**: Translates complex technical concepts into intuitive conversational Roman Hinglish.
  3. **Polite Email Reply**: Crafts structured professional responses with greeting, body, and call-to-action.
  4. **Form Auto-Fill**: Intelligently maps user profile details to active form fields.
  5. **Code Review & Bug Hunter**: Inspects visible code blocks and flags potential bugs, security flaws, and performance improvements.

#### Slice 15: Cross-Tab Resilience, Session Persistence & Execution Audit Log
- **Service Worker Lifecycle & State Recovery**: Active agent execution states, proposed actions, and task parameters persist in `chrome.storage.local`, surviving service worker suspension or side-panel closure.
- **Real-Time Cross-Tab Synchronization**: Listens to Chrome tab activation (`chrome.tabs.onActivated`) and tab update (`chrome.tabs.onUpdated`) events, automatically pausing or re-orienting the agent loop.
- **Dry-Run Simulation Mode**: One-click toggle in the Agent tab allowing users to preview planned actions—visualizing target highlights and reasoning steps—without firing real clicks or typing keystrokes.
- **Searchable Execution Audit Log**: Complete chronological recording of all actions taken, element selectors, parameters, timestamps, and status badges (`SUCCESS`, `SKIPPED`, `REJECTED`). Supports one-click **Export to JSON** for full accountability.

#### Slice 16: End-to-End Safety Guards, Domain Blocklist & Multi-Modal Verification
- **Deterministic Domain Blocklist (`utils/safety-guard.js`)**: Regex-enforced protection blocking automated execution on banking, financial, payment, and UPI portals (e.g. `pay.google.com`, `paypal.com`, `hdfcbank.com`, `icicibank.com`, `sbi.co.in`, `razorpay.com`, `stripe.com`).
- **Sensitive Field Interception**: Deterministically rejects any plan attempting to interact with `type="password"`, `type="hidden"`, OTP verification fields, CVV numbers, or credit card inputs.
- **Consequential Keyword Heuristics**: Flags actions containing destructive or financial keywords (`Submit`, `Pay`, `Confirm Order`, `Delete Account`, `Buy Now`) and mandates user confirmation.
- **Multi-Modal Page Verification**: Cross-references element presence and DOM state before and after actions, stopping execution immediately if an unexpected modal or security prompt appears.

#### Slice 17: Packaging, Documentation, Release ZIP & Landing Page
- **Clean Production Packaging (`scripts/build-release.js`)**: Automated build script isolating 31 runtime files into `dist/siddarth-browser-agent/`, strictly excluding developer secrets (`.env`), test scripts (`tests/`), and version control metadata (`.git`).
- **Direct ZIP Generation**: Automatically builds `dist/siddarth-browser-agent-v1.0.0.zip` ready for one-click distribution and Chrome Web Store upload.
- **Interactive Landing Site (`docs/index.html`)**: Single-page responsive marketing and documentation website featuring:
  - Hero section with direct ZIP download and GitHub link.
  - Interactive 3-Tab Extension Simulator (Chat & Read, Agent Loop, Profile & Skills).
  - 4-Phase Capabilities Grid across all 17 vertical slices.
  - Complete Security Architecture breakdown and 4-step installation walkthrough.
- **NPM Script Pipeline (`package.json`)**: Modern developer ergonomics with `npm run build`, `npm run package`, `npm test`, and `npm run test:phase4`.
- **Open-Source MIT License (`LICENSE`)**: Officially licensed for global open-source use.

---

## 3. System Architecture & Topology

```
+-----------------------------------------------------------------------------------------+
|                                      Google Chrome                                      |
|                                                                                         |
|  +------------------------------------+        +-------------------------------------+  |
|  |           Active Web Tab           |        |         Siddarth Side Panel         |  |
|  |                                    |        |                                     |  |
|  |  [Webpage DOM & Form Elements]     |        |   Tabs: Chat | Agent | Profile |    |  |
|  |                 ^                  |        |         Settings                    |  |
|  |                 |                  |        |                                     |  |
|  |  [Injected Content Scripts]        |        |   * Grounded Chat & SSE Streamer    |  |
|  |  * content/scanner.js (DOM nodes)  |        |   * Agent Planner & Reasoning Loop  |  |
|  |  * content/highlighter.js (#Badges)| <----> |   * Human Confirmation Drawer       |  |
|  |  * content/executor.js (Events)    |        |   * Profile Memory & Skills Engine  |  |
|  |  * content/readability-bundle.js   |        |   * Dry-Run Mode & Action Log       |  |
|  +------------------------------------+        +-------------------------------------+  |
|                   ^                                               ^                     |
|                   |                                               |                     |
|                   +-------------------+       +-------------------+                     |
|                                       |       |                                         |
|                       +---------------v-------v---------------+                         |
|                       |   Background Service Worker           |                         |
|                       |   * Context Menus & Tab Lifecycle     |                         |
|                       |   * Screenshot Capture (Multimodal)   |                         |
|                       +---------------+---------------+                                 |
|                                       |                                                 |
|                       +---------------v---------------+                                 |
|                       |      chrome.storage.local     |                                 |
|                       | Keys, Profiles, Audit Logs    |                                 |
|                       +---------------+---------------+                                 |
|                                       |                                                 |
|                       +---------------v---------------+                                 |
|                       |     utils/safety-guard.js     |                                 |
|                       | Banking Blocklist & Password  |                                 |
|                       | Deterministic Interceptor     |                                 |
|                       +---------------+---------------+                                 |
+---------------------------------------|-------------------------------------------------+
                                        |
                +-----------------------+-----------------------+
                | Direct Encrypted REST                         | Fallback REST
                v                                               v
    +-----------------------+                       +-----------------------+
    |   Google Gemini API   |                       |    Groq Cloud API     |
    |  gemini-2.0-flash /   |                       |  llama-3.3-70b-versat |
    |  gemini-flash-lite    |                       |  openai/gpt-oss-120b  |
    +-----------------------+                       +-----------------------+
```

---

## 4. Live Testing & Installation Guide

### Option A: Install from Release ZIP (Recommended)

1. Extract the release archive:
   ```
   dist/siddarth-browser-agent-v1.0.0.zip
   ```
2. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **"Load unpacked"** and select the extracted folder (or `dist/siddarth-browser-agent/`).
5. Click the Chrome toolbar **puzzle piece icon (🧩)** and click the **Pin (📌)** icon next to Siddarth.
6. Click the pinned **Siddarth icon** in your toolbar to open the Side Panel on any tab!

### Option B: Install Directly from Workspace Source

1. Navigate to `chrome://extensions` in Google Chrome with Developer Mode enabled.
2. Click **"Load unpacked"** and select:
   ```
   F:\ai browser masai live
   ```
3. The extension card will load with 0 errors and all permissions enabled.

### Option C: Offline Practice & Verification Pages

We provide offline test environments simulating real-world reading, navigation, and media scenarios:
1. **Mock Article Page**:
   ```
   file:///f:/ai%20browser%20masai%20live/assets/mock-practice-pages/sample-article.html
   ```
   - Open in Chrome -> Click **"Summarize Active Page"** -> Clean 3-part summary appears.
   - Click the language pill **"HI-EN"** -> Instant Roman Hinglish re-summary!
2. **Mock YouTube Video Page**:
   ```
   file:///f:/ai%20browser%20masai%20live/assets/mock-practice-pages/sample-youtube.html
   ```
   - Open in Chrome -> Click **"Summarize YouTube Video & Chapters"**.
   - Chronological chapter notes appear with clickable timestamps (`[01:45]`, `[04:30]`).
   - Click any timestamp badge (`[01:45]`) -> The video player immediately jumps to that exact second!
3. **Mock Sales Bar Chart Page (Slice 8 Multimodal Vision)**:
   ```
   file:///f:/ai%20browser%20masai%20live/assets/mock-practice-pages/sample-chart.html
   ```
   - Open in Chrome -> Click **"Capture Screenshot & Ask"**.
   - Drag to crop the chart or keep Full View.
   - Click suggestion chip **"Which month had highest sales?"** -> Gemini Flash analyzes the image and identifies **March ($88,000)**.
4. **Mock Job Application & Internship Form (Phase 3 & Phase 4 Agent Loop)**:
   ```
   file:///f:/ai%20browser%20masai%20live/assets/mock-practice-pages/sample-form.html
   ```
   - Open in Chrome -> Switch to the **Agent** tab in the side panel.
   - Type prompt: *"Fill out this application form with my profile details"* (or click **"Fill form from profile"** under Profile skills).
   - Watch the agent scan elements, highlight badges (`#1`, `#2`, `#3`), plan inputs, request confirmation on sensitive buttons, and execute accurately.

---

## 5. Automated Verification Test Suite (CLI)

The project includes an end-to-end verification test suite covering all 17 vertical slices across Phases 1, 2, 3, and 4:

### Run Complete End-to-End Test Suite:
```bash
npm test
```
*Or run individual slice test runners directly via Node.js:*

```bash
# Phase 1 & 2: Core Foundation, Summaries, Vision & Resilience
node tests/test-slice-2.js
node tests/test-slice-3.js
node tests/test-slice-4-5.js
node tests/test-slice-6.js
node tests/test-slice-7.js
node tests/test-slice-8.js
node tests/test-slice-9.js

# Phase 3: Interactive Agent Loop & Hands
node tests/test-slice-10.js
node tests/test-slice-11.js
node tests/test-slice-12.js
node tests/test-slice-13.js

# Phase 4: Profiles, Persistence, Safety & Packaging
node tests/test-slice-14.js
node tests/test-slice-15.js
node tests/test-slice-16.js
node tests/test-slice-17.js
```

### Build & Package Production Release:
```bash
npm run package
# Generates dist/siddarth-browser-agent/ and dist/siddarth-browser-agent-v1.0.0.zip
```

---

## 6. Project File Structure

```
f:\ai browser masai live\
├── manifest.json                  # Manifest V3 extension configuration & permissions
├── package.json                   # NPM scripts (build, package, test, test:phase4)
├── LICENSE                        # Official MIT License
├── README.md                      # Comprehensive project documentation & architecture
├── implementation-plan.md         # 17-Slice vertical roadmap and engineering plan
├── problemStatement.md            # Requirements, boundaries, and acceptance criteria
├── architecture.md                # System topology, state machine, and data flow
├── edge-case.md                   # 7-Category edge case mitigation matrix
├── .env                           # Local environment keys (ignored by git & packaging)
├── .env.example                   # Environment variable template
├── .gitignore                     # Git secret protection
├── assets/
│   ├── icons/                     # Extension branding icons (16, 32, 48, 128 px)
│   └── mock-practice-pages/       # Local test pages (sample-article, youtube, chart, form)
├── background/
│   └── service-worker.js          # Context menus, screenshot capture, tab sync, side-panel lifecycle
├── content/
│   ├── scanner.js                 # DOM interactive element scanner & classifier
│   ├── highlighter.js             # Visual numbered badge overlay & focus ring generator
│   ├── executor.js                # Synthetic DOM event dispatcher (click, type, select, scroll)
│   └── readability-bundle.js      # Injected Readability extractor script
├── lib/
│   ├── Readability.js             # Mozilla Readability algorithm implementation
│   └── marked.min.js              # Local Markdown-to-HTML parser bundle
├── sidepanel/
│   ├── index.html                 # Multi-view side panel layout (Chat, Agent, Profile, Settings)
│   ├── style.css                  # Responsive design tokens, chat bubbles, canvas crop overlay
│   ├── sidepanel.js               # Tab controller & event dispatcher
│   └── tabs/
│       ├── chat.js                # Grounded chat, vision analysis, crop canvas, summarizer
│       ├── agent.js               # Agent reasoning loop, confirmation drawer, audit log
│       ├── profile.js             # Local profile memory & 5 reusable auto-fill skills
│       └── settings.js            # API key testing, fallback config & token analytics
├── utils/
│   ├── ai-client.js               # Multi-model client (Gemini SSE, 3-stage backoff, Groq fallback)
│   ├── safety-guard.js            # Deterministic banking blocklist, password & OTP interceptor
│   ├── storage-manager.js         # Typed chrome.storage.local wrapper
│   └── youtube-parser.js          # YouTube URL, ID, transcript & timestamp parser
├── scripts/
│   └── build-release.js           # Automated packaging script generating dist/ release ZIP
├── docs/
│   └── index.html                 # GitHub Pages landing & interactive documentation site
├── dist/                          # Production release artifacts (ignored by git)
│   ├── siddarth-browser-agent/    # Clean unpacked runtime distribution
│   └── siddarth-browser-agent-v1.0.0.zip # Distributable production archive
└── tests/                         # End-to-end automated verification test suites (Slices 2-17)
```

---

## 7. Security & Safety Guarantees

1. **Deterministic Domain Blocklist**: Financial portals, UPI payment gateways, credit card processing domains, and net banking URLs are strictly blocked at the code level (`utils/safety-guard.js`) from automated interaction.
2. **Sensitive Element Protection**: Password inputs (`type="password"`), hidden credential fields, OTP codes, credit card numbers, and CVV fields are deterministically rejected with high-priority security alerts.
3. **Mandatory Human Confirmation**: Destructive actions (such as `Submit`, `Pay`, `Delete`, `Remove`) always trigger the slide-up Human-in-the-Loop Confirmation Drawer and never execute autonomously.
4. **Zero Third-Party Telemetry**: API keys, user profile information, and browsing history never leave your local browser sandbox. Data is stored solely in `chrome.storage.local`.
5. **Direct Encrypted Communication**: LLM requests travel directly between your browser and official Google Gemini Studio / Groq Cloud endpoints over TLS 1.3 encrypted HTTPS. No intermediate proxy servers are utilized.
6. **Isolated Release Packaging**: Automated packaging strictly verifies that developer credentials (`.env`), test suites, and internal metadata are excluded from production distributions.

---

## 8. License

Developed under the [MIT License](LICENSE) for educational and open-source development.

