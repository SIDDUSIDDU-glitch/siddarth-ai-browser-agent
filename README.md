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

---

## 3. System Architecture & Topology

```
+-------------------------------------------------------------------------+
|                              Google Chrome                              |
|                                                                         |
|  +------------------------------+     +-------------------------------+ |
|  |       Active Web Tab         |     |      Siddarth Side Panel      | |
|  |                              |     |                               | |
|  | [Webpage DOM & Articles]     |     |  Tabs: Chat | Agent | Config  | |
|  |              ^               |     |                               | |
|  |              |               |     |  * Readability Extraction     | |
|  |              v               |     |  * Structured Summarizer      | |
|  | [Readability Bundle Script]  | <-> |  * Token Usage Tracker        | |
|  | [Noise & Cookie Stripper]    |     |  * Storage Synchronizer       | |
|  +------------------------------+     +-------------------------------+ |
|                 ^                                     ^                 |
|                 |                                     |                 |
|                 +---------------+   +-----------------+                 |
|                                 |   |                                   |
|                     +-----------v---v-----------+                       |
|                     | Background Service Worker |                       |
|                     | Context Menus & Lifecycle |                       |
|                     +-------------+-------------+                       |
|                                   |                                     |
|                       +-----------v-----------+                         |
|                       |  chrome.storage.local |                         |
|                       | Keys, Logs, & State   |                         |
|                       +-----------------------+                         |
+-----------------------------------+-------------------------------------+
                                    |
            +-----------------------+-----------------------+
            | Direct Encrypted REST                         | Fallback REST
            v                                               v
+-----------------------+                       +-----------------------+
|   Google Gemini API   |                       |    Groq Cloud API     |
| gemini-flash-lite-lat |                       |   openai/gpt-oss-120b |
+-----------------------+                       +-----------------------+
```

---

## 4. Live Testing & Installation Guide

### Option A: Install & Run in Google Chrome (Live UI)

1. Open Google Chrome and navigate to the extensions manager:
   ```
   chrome://extensions
   ```
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **"Load unpacked"** button in the top-left corner.
4. In the folder browser, select the project directory:
   ```
   F:\ai browser masai live
   ```
5. Click **Select Folder**. The **"Siddarth - Side-Panel AI Browser Agent"** extension card will appear.
6. Click the Chrome toolbar **puzzle piece icon (🧩)** and click the **Pin (📌)** icon next to Siddarth.
7. Click the pinned **Siddarth icon** in your toolbar to open the Side Panel on any tab!

### Option B: Test with Offline Mock Practice Page

We have created an offline test article page simulating a modern news portal with realistic navigation, banner ads, and cookie notices:
- **Test URL**:
  ```
  file:///f:/ai%20browser%20masai%20live/assets/mock-practice-pages/sample-article.html
  ```
1. Open the URL above in Chrome.
2. In the Siddarth Side Panel, switch to the **Chat** tab.
3. Click **"Summarize Active Page (TL;DR + 5 Points)"**.
4. Observe the clean extraction: header ads and cookie notices are stripped, and a structured summary is rendered in seconds!

---

## 5. Automated Verification Test Suite (CLI)

The project includes unit and integration test suites that can be executed directly via Node.js from the terminal:

### Run Slice 2 & Slice 3 Verification Suites:
```bash
node tests/test-slice-2.js
node tests/test-slice-3.js
```

### Run Live Key Verification Probe:
```bash
node tests/test-live-gemini.js
```

**Expected Test Output**:
```
--- Starting Slice 2 Verification Tests ---
Test 1: Verify supported models map...                     ✓ Passed
Test 2: Verify endpoint URL construction...                ✓ Passed
Test 3: Verify system prompt conditioning...               ✓ Passed
Test 4: Verify friendly API error formatting...            ✓ Passed
Test 5: Verify token usage tracking in storage...          ✓ Passed
Test 6: Verify testConnection sends "Ping" -> "Pong"...    ✓ Passed
Test 7: Verify testConnection error handling (400 key)...  ✓ Passed
Test 8: Verify generateText returns response & usage...    ✓ Passed
Test 9: Verify safety block detection (finishReason)...    ✓ Passed
Test 10: Verify HTTP 429 rate limit triggers Groq...       ✓ Passed
Test 11: Verify testGroqConnection sends "Ping"...         ✓ Passed
--- All Slice 2 Verification Tests Passed Successfully! ---

--- Starting Slice 3 Verification Tests ---
Test 1: Verify Readability strips noise (ads, cookies)...  ✓ Passed
Test 2: Verify fallback extraction for non-standard DOM... ✓ Passed
Test 3: Verify marked.min.js renders structured HTML...    ✓ Passed
Test 4: Verify text length clamping preserves cap...       ✓ Passed
Test 5: Verify 3-part summary prompt structure...          ✓ Passed
Test 6: Verify restricted internal browser URLs rejected.. ✓ Passed
--- All Slice 3 Verification Tests Passed Successfully! ---
```

---

## 6. Project File Structure

```
f:\ai browser masai live\
├── manifest.json                  # Manifest V3 extension configuration & permissions
├── README.md                      # Comprehensive project documentation & architecture
├── implementation-plan.md         # 17-Slice vertical roadmap and engineering plan
├── problemStatement.md            # Requirements, boundaries, and acceptance criteria
├── architecture.md                # System topology, state machine, and data flow
├── edge-case.md                   # 7-Category edge case mitigation matrix
├── .env                           # Local environment keys (ignored by git)
├── .env.example                   # Environment variable template
├── .gitignore                     # Git secret protection
├── assets/
│   ├── icons/                     # Extension branding icons (16, 32, 48, 128 px)
│   └── mock-practice-pages/       # Local test pages (sample-article.html)
├── background/
│   └── service-worker.js          # Side-panel trigger, context menus, message router
├── content/
│   └── readability-bundle.js      # Injected Readability extractor script
├── lib/
│   ├── Readability.js             # Mozilla Readability algorithm implementation
│   └── marked.min.js              # Local Markdown-to-HTML parser bundle
├── sidepanel/
│   ├── index.html                 # Multi-view side panel layout
│   ├── style.css                  # Responsive design tokens and dark UI theme
│   ├── sidepanel.js               # Tab controller & event dispatcher
│   └── tabs/
│       ├── chat.js                # Article summarization & grounded reading controller
│       └── settings.js            # API key testing, fallback config & token analytics
├── tests/
│   ├── test-slice-2.js            # Automated verification suite for Slice 2
│   ├── test-slice-3.js            # Automated verification suite for Slice 3
│   └── test-live-gemini.js        # Live probe test script for Gemini & Groq keys
└── utils/
    ├── ai-client.js               # Multi-model client (Gemini + Groq fallback)
    └── storage-manager.js         # Typed chrome.storage.local wrapper
```

---

## 7. Security & Safety Guarantees

1. **Deterministic Guardrails**: Financial portals, UPI payment gateways, and banking domains are strictly blocked from automated interactions.
2. **Sensitive Element Protection**: Password inputs, OTP codes, credit card numbers, and CVV fields are deterministically protected at the code level.
3. **Zero Third-Party Telemetry**: API keys and personal profile details never leave your local browser instance. Communication occurs directly between your client and Google/Groq APIs over encrypted HTTPS.
4. **Explicit Human Confirmation**: No form submissions or consequential actions occur without explicit user approval.

---

## 8. License

Developed under the MIT License for educational and development purposes.

