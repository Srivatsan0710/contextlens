# ReadIn

Select any text on a webpage → click the indigo icon → get a context-aware AI answer in an inline card. No sidebars, no new tabs, no context switching.

---

## How It Works

**Select text** on any page, click the indigo icon that appears, and ReadIn shows an inline card anchored to your selection. The card knows what page you're on and tailors the answer to the reading context.

For vocabulary words, a generic dictionary definition renders instantly (~100ms) while the contextual AI answer loads (~1-2s). Two action buttons let you go deeper — deep vocabulary or web lookup — with one click.

### Three-Tier Pipeline

| Tier | Service | When | Cost |
|---|---|---|---|
| **0** | Free Dictionary API | Vocabulary words, parallel with Tier 1 | Free, no key |
| **1** | Gemini (model-agnostic) | Always for Intent 1, on click for Deep Dive | Free tier, ~200-300 tokens/call |
| **2** | Tavily + Gemini | Only on explicit "Look up" click | Tavily: 1 credit. Gemini: ~400 tokens |

### Three Intents

1. **Contextual Meaning** (auto) — "What does this mean here?" Page title + domain + surrounding paragraph produce a context-aware answer.
2. **Deep Dive** (on click) — Expanded definition, usage examples, and commonly confused terms for vocabulary. Argument/context/implications analysis for phrases.
3. **Look Up** (on click) — Web search via Tavily + Gemini synthesis with inline numbered citations and up to 5 ranked sources.

---

## Features

- **Inline anchored card** — appears right next to your selection, not a sidebar
- **Context-aware answers** — every query includes page title, domain, and surrounding paragraph
- **Auto-intent routing** — classification heuristics decide if text is vocabulary, entity, phrase, or paragraph
- **Progressive rendering** — dictionary definition in ~100ms, AI answer in ~1-2s
- **Session cache** — same word + same page = instant re-lookup
- **Sensitive page protection** — auto-disabled on login, banking, and payment pages
- **Model-agnostic LLM** — supports Gemini and OpenAI-compatible providers
- **Observability** — structured console logs at every decision point for debugging

---

## Installation

1. Download or clone this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `contextlens/` directory

---

## Setup

1. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) — no credit card required
2. (Optional) Get a Tavily API key from [tavily.com](https://tavily.com) for web lookup features — 1,000 free searches/month
3. Click the ReadIn extension icon → enter your keys → save
4. Select text on any page and click the indigo icon

---

## Project Structure

```
contextlens/
├── manifest.json
├── background/
│   └── service-worker.js        # Onboarding, defaults
├── content/
│   ├── content.js                # Main orchestrator
│   ├── content.css               # Trigger icon + card host positioning
│   ├── classifier.js             # Selection classification (local heuristics)
│   └── positioner.js             # Viewport-relative card positioning
├── popup-card/
│   └── card-renderer.js          # Shadow DOM card builder + markdown renderer
├── settings/
│   ├── settings.html
│   ├── settings.js
│   └── settings.css
├── utils/
│   ├── api.js                    # LLM, Tavily, Free Dictionary, cache, prompts
│   ├── blocklist.js              # Sensitive page detection
│   ├── context-extractor.js      # Page title + surrounding paragraph
│   └── observability.js          # Structured console logging
└── icons/
    ├── icon16.png / icon48.png / icon128.png
    └── icon16.svg / icon48.svg / icon128.svg
```

---

## Observability

Open DevTools Console on any page and filter by `[ReadIn` to see the full decision trace for every lookup:

```
[ReadIn:SELECT]       text="2022 Eliminator" wordCount=2
[ReadIn:CLASSIFY]     "2022 Eliminator" → entity (everyWordCapped)
[ReadIn:CACHE]        intent=contextual → MISS
[ReadIn:LLM_REQ]      provider=gemini promptLen=287
[ReadIn:LLM_RES]      latency=1340ms
[ReadIn:KEYWORDS]     hasKeywords=true "IPL 2022 Eliminator RCB vs LSG"
[ReadIn:RENDER]       type=intent1 hasKeywords=true
[ReadIn:ACTION]       intent=news
[ReadIn:TAVILY_REQ]   query="IPL 2022 Eliminator" topic=news
[ReadIn:RENDER]       type=expansion hasSources=true sourceCount=5
```

---

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no bundlers, no frameworks)
- Shadow DOM for CSS isolation
- Gemini API (model-agnostic, supports OpenAI-compatible)
- Tavily Search API
- Free Dictionary API
