# Implementation Plan: Siddarth AI Browser Agent

This plan organizes the development of Siddarth into 4 Phases and 17 Vertical Slices, matching the recommended execution order from the cohort specification. Each slice delivers an independently verifiable increment.

---

## Roadmap Overview

```
Phase 1: The Eyes (Read the Web)
├── Slice 1: Extension Shell + Side Panel + Settings
├── Slice 2: Gemini Text API Integration
├── Slice 3: Article Extraction & Structured Summary
├── Slice 4: Public YouTube Summary with Clickable Timestamps
└── Slice 5: English / Hinglish Bilingual Toggle

Phase 2: The Brain (Understand the Page & Screen)
├── Slice 6: Grounded Page Chat with Streaming
├── Slice 7: Context-Menu Quick Actions (Explain, Translate, Draft)
├── Slice 8: Screenshot-and-Ask with Visual Multimodal Reasoning
└── Slice 9: Free-Tier Resilience & Fallback Engine (Gemini / Groq)

Phase 3: The Hands (Act With User Approval)
├── Slice 10: Interactive Element Scanner & Visual Badge Overlay
├── Slice 11: Structured Element Selection ("Find It for Me")
├── Slice 12: Human-in-the-Loop Agent Action Loop (Approve / Skip / Stop)
└── Slice 13: Progress Persistence, Dry-Run Mode & Audit Action Log

Phase 4: Memory, Safety, and Shipping
├── Slice 14: Local Profile Memory & Auto-Form Filling
├── Slice 15: Reusable One-Click Skills with JSON Export / Import
├── Slice 16: Deterministic Safety Rails (Domain & Password / Card Guards)
└── Slice 17: Packaging, Documentation, Release ZIP & Landing Page
```

---

## Phase 1: The Eyes — Read the Web (Week 1)

### Slice 1: Extension Shell + Side Panel + Settings
- **Goal**: Build the Chrome Extension Manifest V3 foundation, wire the Side Panel API, configure storage for user settings, and enable successful `Load unpacked` installation.
- **Files**:
  - `manifest.json`: Manifest V3 config with permissions (`sidePanel`, `storage`, `activeTab`, `scripting`, `contextMenus`).
  - `background/service-worker.js`: Lifecycle listener opening side panel upon action icon click (`chrome.sidePanel.setPanelBehavior`).
  - `sidepanel/index.html`: Base shell with tabs (Chat, Actions, Profile, Settings) and responsive container.
  - `sidepanel/style.css`: Clean modern theme (dark/light neutral, typography, button states).
  - `sidepanel/sidepanel.js`: Main tab switcher and event dispatcher.
  - `sidepanel/tabs/settings.js`: UI to save/load Gemini and Groq API keys securely in `chrome.storage.local`.
  - `utils/storage-manager.js`: Typed wrapper around Chrome storage.
- **Verification**:
  - Extension loads in `chrome://extensions` with zero errors.
  - Clicking toolbar icon opens Side Panel.
  - Entering and saving an API key persists across browser restarts.

---

### Slice 2: Gemini Text API Integration
- **Goal**: Implement direct, secure calling of the Gemini API from the extension using the stored API key.
- **Files**:
  - `utils/ai-client.js`: Client for `gemini-2.0-flash-lite` with endpoint formatting, system prompts, error checking, and token usage tracking.
  - `sidepanel/tabs/settings.js`: "Test API Key" connection verification button.
- **Verification**:
  - "Test Connection" button sends a sample prompt ("Ping") and returns a verified "Connected successfully!" status indicator.

---

### Slice 3: Article Extraction & Structured Summary
- **Goal**: Extract readable content from web articles using Mozilla Readability, stripping ads/noise, and generating a 3-part structured summary.
- **Files**:
  - `lib/Readability.js`: Mozilla Readability library bundled locally.
  - `content/readability-bundle.js`: Content script extracting `{ title, byline, content, textContent, length }`.
  - `sidepanel/tabs/chat.js`: Summarize button calling extraction -> passing to Gemini with prompt requesting:
    1. **One-line TL;DR**
    2. **Five key points** (bullet list)
    3. **What to do next** (actionable takeaways)
  - `lib/marked.min.js`: Markdown parsing for crisp summary display.
- **Verification**:
  - Test on Wikipedia, Medium, or news articles: clean summary renders without headers, navbars, or cookie notices.

---

### Slice 4: Public YouTube Summary with Clickable Timestamps
- **Goal**: Detect YouTube watch URLs, extract video details and chapter/transcript data, and produce structured notes with clickable timestamps.
- **Files**:
  - `utils/youtube-parser.js`: Detects `youtube.com/watch?v=...` or `youtu.be/...`, parses video ID, extracts timed subtitles/captions or passes YouTube context to Gemini video understanding.
  - `sidepanel/tabs/chat.js`: Renders timestamp badges (e.g. `[02:15]`) that, when clicked, inject `chrome.scripting.executeScript` into the tab to set `videoElement.currentTime = seconds`.
- **Verification**:
  - Test on public YouTube tech talk: side panel shows chapter timestamps; clicking `01:45` jumps the YouTube video player immediately.

---

### Slice 5: English / Hinglish Bilingual Toggle
- **Goal**: Provide a seamless one-click switch between English and natural Hinglish for all AI responses.
- **Files**:
  - `sidepanel/index.html`: Language toggle pill (`EN` | `HI-EN`).
  - `utils/ai-client.js`: Dynamic prompt conditioning:
    - *English*: Concise, professional, standard vocabulary.
    - *Hinglish*: Conversational hybrid Hindi-in-Roman-script (e.g., "Yeh article explain karta hai ki...").
  - `sidepanel/sidepanel.js`: Saves selected language preference to `chrome.storage.local`.
- **Verification**:
  - Summarize an article in English, toggle to Hinglish, re-summarize: output switches to clear, authentic Roman Hinglish.

---

## Phase 2: The Brain — Understand Page and Screen (Week 2)

### Slice 6: Grounded Page Chat with Streaming
- **Goal**: Allow users to chat with the open web page, strictly grounded in extracted content with anti-hallucination guardrails and streaming output.
- **Files**:
  - `sidepanel/tabs/chat.js`: Chat history interface, message input, streaming response container.
  - `utils/ai-client.js`: Streaming SSE implementation using Gemini API `streamGenerateContent`.
  - System Prompt: "You are Siddarth. Answer strictly based on the provided page context. If the answer is not contained in the text, explicitly state: 'This information is not available on the current page.'"
- **Verification**:
  - Ask a question present on page -> correct answer streams in.
  - Ask an unrelated question (e.g. "What is the capital of France?" on a cooking blog) -> model politely refuses based on prompt rules.

---

### Slice 7: Context-Menu Quick Actions
- **Goal**: Add Chrome right-click menus for selected text: `Explain this`, `Translate`, `Draft a reply`.
- **Files**:
  - `background/service-worker.js`: `chrome.contextMenus.create` handlers for `siddarth-explain`, `siddarth-translate`, `siddarth-reply`.
  - `sidepanel/sidepanel.js`: Listens for menu activation messages, switches to Chat tab, and immediately initiates the corresponding prompt on the selected text.
- **Verification**:
  - Highlight jargon on a webpage -> Right-click -> "Siddarth: Explain this" -> Side panel opens and displays plain-language explanation.

---

### Slice 8: Screenshot-and-Ask (Multimodal Vision)
- **Goal**: Capture the visible browser tab and reason about visual content (charts, diagrams, errors) using Gemini Flash.
- **Files**:
  - `background/service-worker.js`: Handler for `chrome.tabs.captureVisibleTab(null, { format: 'png' })`.
  - `sidepanel/tabs/chat.js`: Screenshot preview with optional crop/focus selector and question input.
  - `utils/ai-client.js`: Multimodal payload builder sending inline image data to `gemini-2.0-flash`.
- **Verification**:
  - Capture screen with a bar chart, ask "Which month had the highest sales?" -> Model correctly reads the chart from the image.

---

### Slice 9: Free-Tier Resilience & Fallback Engine
- **Goal**: Gracefully survive rate limits (HTTP 429), implement retry with backoff, and seamlessly fallback to Groq for text tasks.
- **Files**:
  - `utils/ai-client.js`: Error interceptor catching 429 / 503; 3-stage exponential backoff with jitter; automatic secondary dispatch to Groq API (`llama-3.3-70b-versatile`).
  - `sidepanel/tabs/settings.js`: Groq API key configuration and fallback toggle.
- **Verification**:
  - Simulate Gemini 429 rate limit -> Client automatically retries, switches to Groq, and completes task with zero UI crash.

---

## Phase 3: The Hands — Act With User Approval (Week 3)

### Slice 10: Interactive Element Scanner & Badging
- **Goal**: Scan visible interactive elements (buttons, inputs, links, selects), assign stable numbers, and project visual badges over elements.
- **Files**:
  - `content/scanner.js`: Traverses DOM, checks visibility (`getBoundingClientRect`), assigns IDs `#1` to `#N` in natural reading order.
  - `content/content.css`: Floating badge styling (high contrast, non-interfering).
- **Verification**:
  - Clicking "Scan Elements" renders numbered badges above all actionable fields without displacing webpage layout.

---

### Slice 11: Structured Element Selection ("Find It for Me")
- **Goal**: Allow users to query page elements in natural language (e.g. "Where do I submit my resume?") and visually highlight the match.
- **Files**:
  - `sidepanel/tabs/agent.js`: "Find element" input.
  - `content/scanner.js`: Returns compact element map to side panel.
  - `utils/ai-client.js`: Gemini prompt with strict JSON output returning `{"targetId": 7, "reason": "Upload resume file input"}`.
  - `content/highlighter.js`: Draws prominent pulsing highlight around element `#7`.
- **Verification**:
  - On a job application page, asking "Where do I upload CV?" highlights the file input element.

---

### Slice 12: Approval-Based Agent Action Loop
- **Goal**: Implement one-step-at-a-time browser automation requiring explicit user click on `Approve` for each step.
- **Files**:
  - `sidepanel/tabs/agent.js`: Task input, step proposal card showing `Action`, `Target`, `Value`, `Reason`, and buttons `Approve`, `Skip`, `Stop`.
  - `content/executor.js`: Dispatches synthetic `click`, `type`, `select`, `scroll` on approved element.
  - Strict JSON Agent Prompt: Instructs LLM to return only 1 atomic action per iteration.
- **Verification**:
  - Provide task: "Fill out the internship form". Agent proposes Step 1 ("Type 'John' in input #1") -> User clicks Approve -> Field is typed -> Agent proposes Step 2.

---

### Slice 13: Persistence, Dry-Run Mode & Action Log
- **Goal**: Ensure the agent loop survives service worker suspension, supports non-executing dry-run simulation, and preserves an audit trail.
- **Files**:
  - `utils/storage-manager.js`: Saves active task state and action log to `chrome.storage.local`.
  - `sidepanel/tabs/agent.js`: Toggle for "Dry-Run Mode" (highlights element without clicking/typing); displays scrollable historical Action Log.
- **Verification**:
  - Run agent, close side panel mid-task, reopen -> Active proposed action and history are fully restored.
  - Enable Dry-Run -> Element highlights, but no real click or keystroke is dispatched.

---

## Phase 4: Memory, Safety, and Shipping (Week 4)

### Slice 14: Local Profile Memory
- **Goal**: Store local personal data (Name, College, Skills, Links, Preferred Tone) and use it for automatic form-filling and personalized drafting.
- **Files**:
  - `sidepanel/tabs/profile.js`: User profile editor (Name, College, Bio, Skills, GitHub/LinkedIn links, Tone).
  - Profile injection into agent reasoning prompt for form-filling tasks.
- **Verification**:
  - Enter profile details, click "Fill this form from profile" on a test form -> Agent fills matching fields accurately.

---

### Slice 15: One-Click Skills Import & Export
- **Goal**: Save reusable prompt recipes and allow sharing via `.json` import/export.
- **Files**:
  - `sidepanel/tabs/profile.js`: Skills manager (Add skill, Run on page, Export to file, Import from file).
  - Built-in default skills: "Exam notes", "Explain in Hinglish", "Reply to this email politely", "Fill form from profile".
- **Verification**:
  - Create a custom skill, export it to `siddarth-skills.json`, delete it, re-import -> Skill reappears and runs properly.

---

### Slice 16: Deterministic Safety Rails
- **Goal**: Enforce deterministic code-level guards blocking sensitive URLs and preventing password/OTP manipulation.
- **Files**:
  - `utils/safety-guard.js`:
    - Blocks banking / payment / UPI URLs deterministically.
    - Intercepts and rejects any attempt to interact with `type="password"`, `otp`, `cvv`, or credit card inputs.
    - Forces secondary confirmation modal for consequential action words (`Submit`, `Pay`, `Delete`).
- **Verification**:
  - Navigate to mock banking page -> Agent halts with safety alert: "Automated actions are disabled on banking/financial domains."
  - Try targeting a password field -> Action is rejected with security warning.

---

### Slice 17: Packaging, Documentation, Release ZIP & Landing Page
- **Goal**: Finalize production polish, build automated release package script, craft comprehensive README, and create GitHub Pages landing site.
- **Files**:
  - `README.md`: Architecture, installation steps, screenshot guides, security guarantees.
  - `package.json` / build script: Zips extension for direct `Load unpacked` installation.
  - `docs/index.html`: Modern, responsive single-page GitHub Pages landing site.
- **Verification**:
  - Extract release ZIP into fresh Chrome browser -> Installs cleanly, runs end-to-end workflow without any developer errors.

