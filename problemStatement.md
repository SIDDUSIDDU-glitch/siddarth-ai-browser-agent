# Problem Statement: Siddarth AI Browser Agent

## 1. Executive Summary & Project Overview
**Siddarth** is a context-aware Chrome side-panel AI agent designed to run locally inside Google Chrome (Manifest V3). It bridges the gap between passive conversational AI and active browser usage. Siddarth assists users in reading, comprehending, questioning, and safely interacting with web pages—without ever acting autonomously without explicit human-in-the-loop approval.

### Core Value Proposition
- **In-Browser Context Awareness**: Operates right inside the Chrome Side Panel next to the user's active browsing tab.
- **Content Understanding**: High-fidelity article extraction (using Mozilla Readability.js) and public YouTube video summarization with clickable timestamps.
- **Multilingual Support**: Real-time switching between English and Hinglish (natural Hindi-English hybrid).
- **Visual Intelligence**: Screenshot-and-ask capability for charts, diagrams, complex forms, and visual errors.
- **Action Grounding with Numbered Badges**: Scans interactive elements (inputs, buttons, links, selects), overlays visual numbered badges, and provides structured action proposals.
- **Human-in-the-Loop Safety**: Strict step-by-step approval loop (`Approve`, `Skip`, `Stop`) with dry-run capabilities.
- **Zero-Compromise Security**: Hardcoded deterministic guards preventing execution on banking, UPI, payment portals, and strictly blocking interaction with password, OTP, and credit card fields.
- **Local Persistence & Personalization**: Profile memory and reusable prompt skills stored exclusively in local browser storage (`chrome.storage.local`).
- **Free-Tier Resilience**: Intelligent fallback between Gemini 1.5/2.0 Flash-Lite, Gemini Flash, and Groq with exponential backoff on HTTP 429 rate limits.

---

## 2. Problem Statement
Modern AI assistants are separated from the live browser context where users read, research, apply for jobs, and shop. Users are forced into a fragmented workflow:
1. Copy-pasting text back and forth between tabs.
2. Manually describing web page structures, forms, or errors to the model.
3. Identifying interactive elements manually and doing repetitive typing.
4. Existing autonomous web agents either:
   - Rely on expensive cloud infra and proprietary paid subscriptions.
   - Run uncontrolled autonomous loops that risk accidental purchases, form submissions, or leaking private credentials.

**Siddarth** solves this by providing a controlled, assistive agent that:
- Understands the open page directly through DOM and visual capture.
- Reasons over a compact, numbered representation of interactive elements.
- Suggests exactly **one action at a time**, accompanied by clear reasoning.
- Never takes an action until the user clicks **Approve**.
- Operates locally, utilizing generous free-tier LLM endpoints.

---

## 3. Primary Goals & Key Capabilities

1. **Summarize Web & YouTube**:
   - Clean article summaries: 1-line TL;DR, 5 structured key takeaways, and "What to do next" recommendations.
   - Public YouTube video summaries with chapter notes and clickable timestamps that seek the video directly.
2. **Bilingual Output**: Instant toggle between standard English and conversational Hinglish.
3. **Grounded Page Chat**: Side-panel conversation grounded strictly in the active page's extracted DOM, explicitly admitting when requested details are missing.
4. **Context-Menu Quick Actions**: Highlight text on any page -> Right-click to `Explain this`, `Translate`, or `Draft a reply` directly in the side panel.
5. **Screenshot-and-Ask**: Capture visible viewport (`captureVisibleTab`), crop/focus on regions of interest, and ask multimodal visual questions.
6. **Find It For Me**: Natural language target search (e.g., "Where do I upload my resume?") highlighting the exact target element without clicking.
7. **Controlled Agent Action Loop**: Step-by-step assistance for multi-step workflows (e.g., filling mock job applications, filtering products) with strict JSON action schema:
   - Action types: `click`, `type`, `select`, `scroll`, `done`.
   - User controls: `Approve`, `Skip`, `Stop`, `Dry-Run`.
8. **Resilient State Persistence**: Survives Manifest V3 Service Worker sleep cycles by storing agent execution checkpoints in `chrome.storage.local`.
9. **Local Profile & One-Click Skills**: Store user details (name, college, skills, links, preferred tone) locally for quick form filling and draft generation; export/import reusable prompt recipes.
10. **Code-Enforced Safety Rails**: Deterministic regex-based blacklists for sensitive URLs (banks, payment gateways, UPI) and input element types (`password`, `cc-*`, `cvv`, `otp`).

---

## 4. Target Platform & Technology Stack

| Layer | Technology | Details / Purpose |
|---|---|---|
| **Platform** | Google Chrome (Desktop) | Chrome Extension Manifest V3 |
| **UI Container** | Chrome Side Panel API | Persistent side-by-side workspace (`chrome.sidePanel`) |
| **Page Scripting** | Content Scripts & `chrome.scripting` | DOM parsing, element tagging, badge overlays, synthetic events |
| **Screen Capture** | `chrome.tabs.captureVisibleTab` | Viewport screenshot capture for multimodal vision tasks |
| **Menus** | `chrome.contextMenus` | Right-click shortcuts for instant text explanation/translation |
| **Storage** | `chrome.storage.local` | API keys, user profile, skill recipes, agent session persistence |
| **Primary LLMs** | Google Gemini API (AI Studio) | `gemini-2.0-flash-lite` (default fast model), `gemini-2.0-flash` (vision & reasoning) |
| **Fallback LLM** | Groq API | Fast text fallback (`llama-3.3-70b-versatile` or `llama-3.1-8b-instant`) |
| **Content Extractor**| Mozilla Readability.js + DOMPurify | Distraction-free article text extraction |
| **Video Engine** | YouTube Player API / TimedText / Gemini Video | Timestamp extraction and deep video navigation |
| **Build & Styling** | Vanilla JS / Modular ES6 + Modern CSS | Zero bloated framework dependencies for speed and inspectability |

---

## 5. Scope & Boundaries

### In Scope
- Chrome Extension Manifest V3 running on modern desktop Chrome.
- User-supplied Gemini and Groq API keys entered via the Extension Settings UI.
- Clean text extraction excluding ads, sidebars, headers, and footers.
- Element indexing, badge rendering, and action dispatching on standard HTML web pages.
- Action validation against strict JSON schemas before user prompt presentation.
- Complete audit action log preserved in the side panel.
- Testing on representative mock environments (internship application forms, e-commerce filters, article blogs).

### Out of Scope (Non-Goals)
- Fully autonomous execution without human approval (explicit anti-goal).
- Automation or data entry on banking, UPI, payment, or authentication/login forms.
- Captcha bypassing, bot detection circumvention, or proof-of-work solvers.
- Mobile browsers (Chrome on iOS/Android).
- Hardcoding API credentials or distributing proprietary backend servers.
- Chrome Web Store deployment (distribution is handled via GitHub Release unpacked ZIP).

---

## 6. Functional Requirements (FR)

- **FR-1: Side Panel Interface**: Embedded UI loaded via `chrome.sidePanel` providing tabs for Chat, Actions/Agent, Profile, and Settings.
- **FR-2: Settings Management**: Secure local storage of Gemini/Groq API keys, model preferences, and language toggles without ever syncing externally.
- **FR-3: High-Fidelity Extraction**: Intelligent parsing of articles using Mozilla Readability, extracting title, author, lead image, clean text, and word count.
- **FR-4: Structured Summaries**: Generation of summaries formatted into 1-line TL;DR, 5 bullet points, and next steps; toggleable into Hinglish.
- **FR-5: YouTube Intelligence**: Parsing YouTube video URLs, fetching transcript/metadata, and rendering timestamped chapter anchors that seek the active video upon click.
- **FR-6: Grounded Page Chat**: Contextual question-answering limited strictly to the parsed page content; explicitly rejects hallucinations when content is absent.
- **FR-7: Right-Click Integration**: Context menu hooks to trigger `Explain`, `Translate`, or `Draft Reply` passing selection text to the side panel.
- **FR-8: Multimodal Screenshot Analysis**: Viewport capture and coordinate-based cropping allowing user-annotated visual inspection via Gemini Flash.
- **FR-9: DOM Element Scanner & Visual Badging**: Content script scanning interactive DOM nodes, assigning persistent sequential IDs (e.g., `#1`, `#2`), and projecting floating badges.
- **FR-10: Strict JSON Decision Engine**: LLM actions emitted exclusively matching a strict JSON schema (`{ "action": "...", "elementId": 12, "value": "...", "reason": "..." }`).
- **FR-11: Human-in-the-Loop Action Approval**: Three-button gate (`Approve`, `Skip`, `Stop`) with preview highlighting for every suggested atomic action.
- **FR-12: Service Worker Lifecycle Resilience**: Snapshotting active agent state to `chrome.storage.local` to resume seamlessly after Manifest V3 background idle termination.
- **FR-13: Local Profile Memory**: Reusable user schema (Name, College, Skills, GitHub/LinkedIn links, Tone) plugged dynamically into form-filling and drafting prompts.
- **FR-14: One-Click Skill Recipes**: Saved prompt templates executed with 1-click on active tab; importable/exportable as `.json` files.
- **FR-15: Deterministic Safety Engine**: Hard blocking of blacklisted domains (banking/UPI) and strict refusal to touch password, OTP, or CVV inputs.

---

## 7. Definition of Done (DoD)
The project is complete and ready for public release when:
1. Extension loads cleanly via Chrome `Load unpacked` with zero manifest warnings.
2. User can enter an AI Studio Gemini API key in settings and verify connectivity.
3. User can summarize articles and public YouTube links with working clickable timestamps.
4. Response output switches between English and Hinglish smoothly.
5. User can converse with page content in grounded chat without hallucination.
6. Context-menu actions (`Explain`, `Translate`, `Draft a reply`) populate the side panel.
7. Screenshot-and-ask works reliably on charts/visual elements.
8. Interactive elements are scanned and badges rendered accurately.
9. Agent loop suggests single-step actions via strict JSON, requiring user click on `Approve` before executing.
10. Agent actions respect `Dry-Run`, `Skip`, `Stop`, and maximum step thresholds.
11. State survives background worker suspension.
12. Safety engine deterministically blocks sensitive domains and password/card inputs.
13. User profile memory and saved skills function with export/import support.
14. GitHub release package (ZIP), comprehensive README, and landing page are prepared.
