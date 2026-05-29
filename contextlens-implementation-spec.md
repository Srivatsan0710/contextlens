# ContextLens — Chrome Extension Implementation Spec (v3)

**Version:** 3.0  
**Status:** Ready for engineering  
**Purpose:** Implementation brief for OpenCode. Build exactly as specified.

---

## What We're Building

A Chrome extension: select text → click icon → inline card with a context-aware AI answer. For vocabulary words, a generic dictionary definition renders instantly (~100ms) while the contextual AI answer loads (~1-2s). Action buttons let users go deeper (deep vocabulary or web news lookup). No sidebars, no new tabs.

---

## Three-Tier Lookup Pipeline

This is the core architecture. Requests are routed to the cheapest tier that can answer them.

```
User selects text → Classifier (local, 0ms, free)
       │
       ├── skip → do nothing
       │
       ├── vocabulary (single word)
       │     ├── Tier 0: Free Dictionary API (parallel, ~100ms, free)
       │     │   → renders generic definition as grey sub-line immediately
       │     └── Tier 1: Gemini (parallel, ~1-2s, low token cost)
       │         → renders contextual meaning as primary answer
       │
       ├── vocabulary (technical/jargon, not in dictionary)
       │     └── Tier 1: Gemini only → contextual meaning
       │
       ├── entity / phrase / paragraph
       │     └── Tier 1: Gemini only → contextual meaning
       │
       └── User clicks action button:
             ├── "Deep dive" → Tier 1: Gemini (richer prompt)
             └── "Look up" / "Latest news" → Tier 2: Tavily + Gemini
```

**Tier 0** — Free Dictionary API. Zero cost, no key, ~100ms. For generic definitions of common English words. Fires in parallel with Tier 1 for vocabulary-classified selections.

**Tier 1** — Gemini 2.5 Flash. Free tier (1,500 req/day). Context-aware answers using page title + domain + surrounding paragraph. Default for all Intent 1 queries and Intent 3 (deep dive).

**Tier 2** — Tavily + Gemini. Tavily free tier (1,000 credits/month). Only fires on explicit user click for Intent 2 (news/lookup). Never automatic.

---

## Cost Optimizations

**1. Session response cache.** Before any API call, check if `{pageURL}:{selectedText}:{intent}` exists in `chrome.storage.session`. If yes, return cached response instantly. Zero cost on re-lookups. Cache clears when browser closes.

**2. Page context: title + domain only.** Don't send page body content. `document.title` + `window.location.hostname` carry 80-90% of topic signal (~15-20 tokens). Surrounding paragraph (600 chars, ~100-150 tokens) provides local context. Total prompt: ~200-300 tokens per lookup.

**3. Free Dictionary API for generics.** Common English words get a dictionary definition without any LLM call. If user only needs the generic meaning, the LLM call's result is bonus, not required.

**4. Tier 2 only on explicit click.** Web search (Tavily) never fires automatically. Preserves credits for when user actually wants news.

**5. Parallel calls for vocabulary.** Free Dictionary API and Gemini fire simultaneously. Generic definition renders in ~100ms while contextual answer loads in ~1-2s. Progressive rendering — user sees value immediately.

---

## File Structure

```
contextlens/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── content.js          # Main orchestrator
│   ├── content.css          # All styles
│   ├── positioner.js        # Card positioning logic
│   └── classifier.js        # Selection classification
├── popup-card/
│   └── card-renderer.js     # Card DOM builder + updater
├── settings/
│   ├── settings.html
│   ├── settings.js
│   └── settings.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── utils/
    ├── api.js               # Gemini + Tavily + Free Dict + cache
    ├── context-extractor.js  # Page context (title + surrounding)
    └── blocklist.js          # Sensitive page detection
```

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "ContextLens",
  "version": "1.0.0",
  "description": "Select any text to get an instant, context-aware AI answer — without leaving the page.",
  "permissions": [
    "activeTab",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "utils/blocklist.js",
        "utils/context-extractor.js",
        "content/classifier.js",
        "utils/api.js",
        "popup-card/card-renderer.js",
        "content/positioner.js",
        "content/content.js"
      ],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "settings/settings.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "settings/settings.html"
}
```

---

## Module Specs

### 1. `utils/blocklist.js`

```javascript
const BLOCKED_URL_PATTERNS = [
  'login', 'signin', 'sign-in', 'sign_in', 'account', 'accounts',
  'bank', 'banking', 'checkout', 'payment', 'pay', 'password', 'passwd',
  'wallet', 'secure', 'auth', 'oauth', 'verify', 'verification'
];

window.ContextLens = window.ContextLens || {};

window.ContextLens.isBlockedPage = function () {
  const url = window.location.href.toLowerCase();
  if (BLOCKED_URL_PATTERNS.some(p => url.includes(p))) return true;
  if (document.querySelector('input[type="password"]')) return true;
  return false;
};

window.ContextLens.isUserBlockedDomain = async function () {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['blockedDomains'], (result) => {
      resolve((result.blockedDomains || []).includes(window.location.hostname));
    });
  });
};
```

---

### 2. `utils/context-extractor.js`

**Purpose:** Extracts page-level context (title + domain only — no body extraction) and surrounding paragraph.

```javascript
window.ContextLens = window.ContextLens || {};

// Page context: title + domain only. No body content extraction.
// Title carries 80-90% of topic signal. Domain adds implicit context.
// Cached as JS variable after first call — never re-extracted on same page.
let _cachedPageContext = null;

window.ContextLens.getPageContext = function () {
  if (_cachedPageContext) return _cachedPageContext;

  _cachedPageContext = {
    title: document.title || '',
    domain: window.location.hostname.replace('www.', '')
  };
  return _cachedPageContext;
};

// Surrounding context: text around the selection. Changes per lookup.
window.ContextLens.getSurroundingContext = function (selectedText) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  let contextElement = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container;

  while (contextElement && contextElement.tagName !== 'BODY') {
    const text = contextElement.innerText || contextElement.textContent || '';
    if (text.length > selectedText.length + 20) break;
    contextElement = contextElement.parentElement;
  }

  const fullText = contextElement?.innerText || contextElement?.textContent || '';
  return fullText.slice(0, 600);
};
```

---

### 3. `content/classifier.js`

Classifies selected text into vocabulary | entity | phrase | paragraph | skip. Classification only decides the button set, NOT the initial answer (which is always Intent 1).

```javascript
window.ContextLens = window.ContextLens || {};

const ENTITY_SIGNAL_WORDS = [
  'act', 'law', 'bill', 'regulation', 'ruling', 'lawsuit',
  'acquisition', 'merger', 'ipo', 'funding', 'election',
  'case', 'scandal', 'crisis', 'war', 'treaty', 'agreement',
  'launch', 'release', 'announcement', 'series a', 'series b',
  'series c', 'series d', 'spac', 'foundation', 'institute',
  'university', 'commission', 'agency', 'bureau', 'department',
  'ministry', 'inc', 'corp', 'ltd', 'llc'
];

const ENTITY_ACRONYMS = [
  'NASA', 'NATO', 'GDPR', 'WHO', 'UN', 'EU', 'FBI', 'CIA', 'SEC',
  'FTC', 'DOJ', 'NYSE', 'IMF', 'OPEC', 'FIFA', 'UNESCO', 'ASEAN'
];

window.ContextLens.classify = function (selectedText) {
  const text = selectedText.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const lowerText = text.toLowerCase();

  if (/^https?:\/\//.test(text) || /^[^\s@]+@[^\s@]+$/.test(text)) return 'skip';
  if (/^\$?[\d,.]+%?$/.test(text)) return 'skip';
  if (wordCount >= 30) return 'paragraph';

  if (wordCount === 1) {
    if (/^[A-Z]{2,6}$/.test(text)) {
      return ENTITY_ACRONYMS.includes(text) ? 'entity' : 'vocabulary';
    }
    if (/^[A-Z][a-z]/.test(text) && !isSentenceStart(text)) return 'entity';
    return 'vocabulary';
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const parent = selection.getRangeAt(0).commonAncestorContainer;
    const codeParent = (parent.nodeType === Node.TEXT_NODE ? parent.parentElement : parent)
      ?.closest('code, pre');
    if (codeParent) return 'vocabulary';
  }

  const words = text.split(/\s+/);
  const everyWordCapped = words.every(w => /^[A-Z]/.test(w));
  if (everyWordCapped && wordCount <= 6 && !isSentenceStart(text)) return 'entity';

  const hasEntitySignal = ENTITY_SIGNAL_WORDS.some(word => lowerText.includes(word));
  if (hasEntitySignal && wordCount <= 10) return 'entity';
  if (wordCount <= 4 && /^[a-z]/.test(text)) return 'vocabulary';

  return 'phrase';
};

function isSentenceStart(text) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return true;
  const range = selection.getRangeAt(0);
  const sc = range.startContainer;
  if (sc.nodeType === Node.TEXT_NODE) {
    const before = sc.textContent.slice(0, range.startOffset).trim();
    if (before.length === 0) return true;
    return ['.', '!', '?', ':', ';'].includes(before[before.length - 1]);
  }
  return true;
}
```

---

### 4. `utils/api.js`

**Purpose:** Three-tier lookup pipeline with session caching, Free Dictionary API, Gemini, and Tavily.

```javascript
window.ContextLens = window.ContextLens || {};

// ===================== OUTPUT SANITIZER =====================
// LLM responses could contain HTML/script tags. Strip everything except
// plain text. We inject our own citation links separately.

function sanitizeOutput(text) {
  // Strip all HTML tags
  const stripped = text.replace(/<[^>]*>/g, '');
  // Decode common HTML entities
  const decoded = stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return decoded;
}

// ===================== ABORT CONTROLLER =====================
// Prevents runaway API calls when user opens a new card before the
// previous one finishes loading.

let _activeAbortController = null;

window.ContextLens.abortPending = function () {
  if (_activeAbortController) {
    _activeAbortController.abort();
    _activeAbortController = null;
  }
};

function getAbortSignal() {
  _activeAbortController = new AbortController();
  return _activeAbortController.signal;
}

// ===================== USAGE COUNTER =====================
// Track daily Gemini calls and monthly Tavily calls.
// Warn at 80% of limits. Stored in chrome.storage.session.

async function incrementUsage(provider) {
  try {
    const key = `usage_${provider}`;
    const result = await chrome.storage.session.get([key]);
    const current = result[key] || { count: 0, resetDate: new Date().toDateString() };

    // Reset if day/month has changed
    const today = new Date();
    if (provider === 'gemini' && current.resetDate !== today.toDateString()) {
      current.count = 0;
      current.resetDate = today.toDateString();
    }
    if (provider === 'tavily') {
      const currentMonth = `${today.getFullYear()}-${today.getMonth()}`;
      if (current.resetDate !== currentMonth) {
        current.count = 0;
        current.resetDate = currentMonth;
      }
    }

    current.count += 1;
    await chrome.storage.session.set({ [key]: current });
    return current.count;
  } catch (e) {
    return 0; // fail silently
  }
}

async function checkUsageWarning(provider) {
  try {
    const key = `usage_${provider}`;
    const result = await chrome.storage.session.get([key]);
    const current = result[key];
    if (!current) return null;

    if (provider === 'gemini' && current.count >= 1200) return 'GEMINI_USAGE_HIGH'; // 80% of 1500
    if (provider === 'tavily' && current.count >= 800) return 'TAVILY_USAGE_HIGH';   // 80% of 1000
    return null;
  } catch (e) {
    return null;
  }
}

// ===================== SESSION CACHE =====================
// Key format: "{url}:{selectedText}:{intent}"
// Stored in chrome.storage.session (cleared on browser close)

const _memoryCache = {}; // In-memory fallback (chrome.storage.session is async)

function cacheKey(selectedText, intent) {
  const url = window.location.host + window.location.pathname;
  return `${url}::${selectedText}::${intent}`;
}

async function getFromCache(selectedText, intent) {
  const key = cacheKey(selectedText, intent);
  // Check in-memory first (fastest)
  if (_memoryCache[key]) return _memoryCache[key];
  // Then check chrome.storage.session
  try {
    const result = await chrome.storage.session.get([key]);
    if (result[key]) {
      _memoryCache[key] = result[key]; // warm memory cache
      return result[key];
    }
  } catch (e) { /* session storage may not be available in all contexts */ }
  return null;
}

async function setCache(selectedText, intent, value) {
  const key = cacheKey(selectedText, intent);
  _memoryCache[key] = value;
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (e) { /* fail silently, memory cache still works */ }
}

// ===================== FREE DICTIONARY API (Tier 0) =====================

window.ContextLens.fetchDictionaryDefinition = async function (word) {
  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!resp.ok) return null; // word not found — expected for jargon

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Extract first definition from first meaning
    const meanings = data[0].meanings || [];
    if (meanings.length === 0) return null;

    const firstMeaning = meanings[0];
    const partOfSpeech = firstMeaning.partOfSpeech || '';
    const definition = firstMeaning.definitions?.[0]?.definition || '';

    if (!definition) return null;

    return {
      word: data[0].word,
      partOfSpeech,
      definition,
      phonetic: data[0].phonetic || data[0].phonetics?.[0]?.text || ''
    };
  } catch (e) {
    return null; // network error → silently skip generic definition
  }
};

// ===================== GEMINI API (Tier 1) =====================

async function callGemini(prompt, geminiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  // NOTE: Verify the model string in Google AI Studio when you get your key.
  // If 2.5 Flash is available, use: gemini-2.5-flash
  // If not, gemini-2.0-flash works. Update the PRD to match whichever you use.
  const signal = getAbortSignal();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.3 }
    }),
    signal
  });

  if (response.status === 429) throw new Error('RATE_LIMIT');
  if (!response.ok) throw new Error(`GEMINI_ERROR_${response.status}`);

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Track usage + check Gemini safety filter refusal
  await incrementUsage('gemini');
  if (!raw && data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('SAFETY_FILTERED');
  }

  return sanitizeOutput(raw);
}

// ===================== TAVILY API (Tier 2) =====================

async function callTavily(query, tavilyKey) {
  const signal = getAbortSignal();

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tavilyKey}`
    },
    body: JSON.stringify({
      query, search_depth: 'basic', max_results: 5,
      include_answer: false, include_raw_content: false
    }),
    signal
  });

  if (response.status === 429) throw new Error('TAVILY_RATE_LIMIT');
  if (!response.ok) throw new Error(`TAVILY_ERROR_${response.status}`);

  await incrementUsage('tavily');

  const data = await response.json();
  return (data.results || []).slice(0, 5).map((r, i) => ({
    index: i + 1, title: r.title, url: r.url,
    snippet: r.content?.slice(0, 200) || ''
  }));
}

// ===================== PROMPT BUILDERS =====================

// Page context is title + domain only (~15-20 tokens)
// Surrounding context is the local paragraph (~100-150 tokens)

function buildContextualPrompt(selectedText, pageContext, surroundingContext) {
  return `You are a contextual reading assistant. The user is reading "${pageContext.title}" on ${pageContext.domain}.

They selected: "${selectedText}"

Surrounding text: "${surroundingContext}"

Give a brief, precise explanation of "${selectedText}" specifically in the context of what they are reading. Do NOT give a generic dictionary definition — focus on what it means HERE.

Rules:
- 2-4 sentences maximum
- Plain language, no fluff
- If it's an acronym, spell it out first then explain
- Do NOT start with "In the context of..." — just explain directly`;
}

function buildNewsPrompt(selectedText, pageContext, surroundingContext, tavilyResults) {
  const sourcesText = tavilyResults.map(r => `[${r.index}] ${r.title} — ${r.snippet}`).join('\n');

  return `You are a contextual reading assistant. The user is reading "${pageContext.title}" on ${pageContext.domain}.

They selected: "${selectedText}"

Surrounding text: "${surroundingContext}"

Web search results:
${sourcesText}

Synthesize a brief, factual answer using the search results above.

Rules:
- 3-5 sentences maximum
- Add source numbers in brackets like [1] [2] when using information
- Focus on what's most relevant to the article being read
- Prioritize recent information
- Do NOT start with "Based on the search results..."`;
}

function buildDeepVocabPrompt(selectedText, pageContext, surroundingContext, previousAnswer) {
  const prevContext = previousAnswer
    ? `\nThe user already saw this brief explanation: "${previousAnswer}"\n`
    : '';

  return `You are a vocabulary teaching assistant. The user encountered "${selectedText}" while reading "${pageContext.title}" on ${pageContext.domain}.

Surrounding text: "${surroundingContext}"
${prevContext}
Provide a deep vocabulary breakdown:

1. EXPANDED DEFINITION: Fuller explanation tailored to the domain the user is reading about.
2. USAGE EXAMPLES: 2-3 short example sentences in different but related contexts.
3. COMMONLY CONFUSED WITH: 1-2 similar terms people mix up, with one-sentence difference each. Skip if no common confusion.

Rules:
- Section headers: "Definition", "Examples", "Commonly confused with"
- 2-3 sentences per section max
- Do NOT repeat or rephrase the brief explanation shown above — go deeper`;
}

// ===================== QUERY RUNNERS =====================

async function getKeys() {
  return new Promise(resolve => chrome.storage.sync.get(['geminiKey', 'tavilyKey'], resolve));
}

// Intent 1: Contextual meaning (always runs on card open)
window.ContextLens.runContextualQuery = async function (selectedText, pageContext, surroundingContext) {
  const cached = await getFromCache(selectedText, 'contextual');
  if (cached) return cached;

  const keys = await getKeys();
  if (!keys.geminiKey) throw new Error('NO_GEMINI_KEY');

  const prompt = buildContextualPrompt(selectedText, pageContext, surroundingContext);
  const answer = await callGemini(prompt, keys.geminiKey);
  const usageWarning = await checkUsageWarning('gemini');
  const result = { answer, usageWarning };

  await setCache(selectedText, 'contextual', result);
  return result;
};

// Intent 2: News / web lookup (on explicit button click)
window.ContextLens.runNewsQuery = async function (selectedText, pageContext, surroundingContext) {
  const cached = await getFromCache(selectedText, 'news');
  if (cached) return cached;

  const keys = await getKeys();
  if (!keys.geminiKey) throw new Error('NO_GEMINI_KEY');
  if (!keys.tavilyKey) throw new Error('NO_TAVILY_KEY');

  const sources = await callTavily(selectedText, keys.tavilyKey);
  const prompt = buildNewsPrompt(selectedText, pageContext, surroundingContext, sources);
  const answer = await callGemini(prompt, keys.geminiKey);
  const usageWarning = await checkUsageWarning('tavily') || await checkUsageWarning('gemini');
  const result = { answer, sources, usageWarning };

  await setCache(selectedText, 'news', result);
  return result;
};

// Intent 3: Deep vocabulary (on explicit button click)
window.ContextLens.runDeepVocabQuery = async function (selectedText, pageContext, surroundingContext, previousAnswer) {
  const cached = await getFromCache(selectedText, 'deepvocab');
  if (cached) return cached;

  const keys = await getKeys();
  if (!keys.geminiKey) throw new Error('NO_GEMINI_KEY');

  const prompt = buildDeepVocabPrompt(selectedText, pageContext, surroundingContext, previousAnswer);
  const answer = await callGemini(prompt, keys.geminiKey);
  const usageWarning = await checkUsageWarning('gemini');
  const result = { answer, usageWarning };

  await setCache(selectedText, 'deepvocab', result);
  return result;
};
```

---

### 5. `content/positioner.js`

**Purpose:** Card positioning with sticky header detection, viewport edge handling. Only checks likely header candidates (not all DOM elements) for performance.

```javascript
window.ContextLens = window.ContextLens || {};

window.ContextLens.calculatePosition = function (selectionRect) {
  const CARD_WIDTH = 380;
  const CARD_ESTIMATED_HEIGHT = 300;
  const OFFSET = 12;
  const VIEWPORT_PADDING = 16;
  const vw = window.innerWidth, vh = window.innerHeight;
  const sy = window.scrollY, sx = window.scrollX;

  // Detect sticky/fixed headers — only check likely candidates, not all DOM elements.
  // Headers, navs, and divs that are direct children of body cover 99% of sticky headers.
  let stickyHeaderHeight = 0;
  const candidates = document.querySelectorAll('body > header, body > nav, body > div, [role="banner"], [role="navigation"]');
  for (const el of candidates) {
    const s = window.getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().top < 10) {
      const r = el.getBoundingClientRect();
      if (r.height < 200) stickyHeaderHeight = Math.max(stickyHeaderHeight, r.bottom);
    }
  }

  let top = selectionRect.bottom + sy + OFFSET;
  let left = selectionRect.left + sx;

  if ((selectionRect.bottom + OFFSET + CARD_ESTIMATED_HEIGHT) > vh)
    top = selectionRect.top + sy - CARD_ESTIMATED_HEIGHT - OFFSET;
  if ((top - sy) < stickyHeaderHeight + VIEWPORT_PADDING)
    top = sy + stickyHeaderHeight + VIEWPORT_PADDING;
  if (left + CARD_WIDTH > vw + sx - VIEWPORT_PADDING)
    left = vw + sx - CARD_WIDTH - VIEWPORT_PADDING;
  if (left < sx + VIEWPORT_PADDING)
    left = sx + VIEWPORT_PADDING;

  return { top, left };
};
```

---

### 6. `popup-card/card-renderer.js`

**Updated:** Card now has a `cl-generic-def` area for the Free Dictionary definition (grey sub-line).

```javascript
window.ContextLens = window.ContextLens || {};

window.ContextLens.createCard = function (classification) {
  const card = document.createElement('div');
  card.id = 'contextlens-card';
  card.dataset.classification = classification;

  let actionButtonsHTML = '';
  if (classification === 'vocabulary') {
    actionButtonsHTML = `
      <button class="cl-action-btn cl-action-primary" data-intent="deepdive">📖 Deep dive</button>
      <button class="cl-action-btn cl-action-secondary" data-intent="news">📰 Look up</button>`;
  } else if (classification === 'entity') {
    actionButtonsHTML = `
      <button class="cl-action-btn cl-action-primary" data-intent="news">📰 Latest news</button>
      <button class="cl-action-btn cl-action-secondary" data-intent="deepdive">📖 Deep dive</button>`;
  } else if (classification === 'phrase') {
    actionButtonsHTML = `
      <button class="cl-action-btn cl-action-secondary" data-intent="news">📰 Look up</button>`;
  }

  card.innerHTML = `
    <div class="cl-card-inner">
      <div class="cl-header">
        <span class="cl-category-label">${classification}</span>
        <button class="cl-close" aria-label="Close">✕</button>
      </div>
      <div class="cl-body">
        <div class="cl-loading">
          <div class="cl-spinner"></div>
          <span>Looking it up...</span>
        </div>
        <div class="cl-answer hidden"></div>
        <div class="cl-generic-def hidden"></div>
        <div class="cl-error hidden"></div>
      </div>
      <div class="cl-actions-row hidden">
        ${actionButtonsHTML}
      </div>
      <div class="cl-expansion hidden">
        <div class="cl-expansion-loading hidden">
          <div class="cl-spinner"></div>
          <span>Digging deeper...</span>
        </div>
        <div class="cl-expansion-answer hidden"></div>
        <div class="cl-expansion-sources hidden"></div>
        <div class="cl-expansion-error hidden"></div>
      </div>
      <div class="cl-footer">
        <a class="cl-new-tab" href="#" target="_blank" rel="noopener">Search in Google ↗</a>
      </div>
    </div>`;
  return card;
};

// Show the generic dictionary definition (grey sub-line, renders before Gemini)
window.ContextLens.showGenericDefinition = function (card, dictResult) {
  if (!dictResult) return; // no dictionary hit → don't show
  const el = card.querySelector('.cl-generic-def');
  const pos = dictResult.partOfSpeech ? `(${dictResult.partOfSpeech}) ` : '';
  const phonetic = dictResult.phonetic ? `${dictResult.phonetic} · ` : '';
  // Sanitize dictionary output — strip any HTML tags for safety
  const safeDef = dictResult.definition.replace(/<[^>]*>/g, '');
  el.textContent = `${phonetic}${pos}${safeDef}`;
  el.classList.remove('hidden');
};

// Show Intent 1 contextual answer + reveal action buttons
window.ContextLens.showAnswer = function (card, answer) {
  card.querySelector('.cl-loading').classList.add('hidden');
  card.querySelector('.cl-answer').innerHTML = answer;
  card.querySelector('.cl-answer').classList.remove('hidden');
  card.querySelector('.cl-actions-row').classList.remove('hidden');
  // Store answer for use in Deep Dive prompt (avoids repetition)
  card.dataset.intent1Answer = answer;
};

window.ContextLens.showExpansionLoading = function (card) {
  const exp = card.querySelector('.cl-expansion');
  exp.classList.remove('hidden');
  exp.querySelector('.cl-expansion-loading').classList.remove('hidden');
  exp.querySelector('.cl-expansion-answer').classList.add('hidden');
  exp.querySelector('.cl-expansion-sources').classList.add('hidden');
  exp.querySelector('.cl-expansion-error').classList.add('hidden');
};

window.ContextLens.showExpansionAnswer = function (card, answer, sources) {
  const exp = card.querySelector('.cl-expansion');
  exp.querySelector('.cl-expansion-loading').classList.add('hidden');

  let html = answer;
  if (sources && sources.length > 0) {
    html = answer.replace(/\[(\d+)\]/g, (m, num) => {
      const s = sources.find(x => x.index === parseInt(num));
      return s ? `<a href="${s.url}" target="_blank" rel="noopener" class="cl-citation">[${num}]</a>` : m;
    });
  }

  exp.querySelector('.cl-expansion-answer').innerHTML = html;
  exp.querySelector('.cl-expansion-answer').classList.remove('hidden');

  if (sources && sources.length > 0) {
    const el = exp.querySelector('.cl-expansion-sources');
    el.innerHTML = '<div class="cl-sources-label">Sources</div>' +
      sources.map(s => `
        <a class="cl-source-item" href="${s.url}" target="_blank" rel="noopener">
          <span class="cl-source-num">${s.index}</span>
          <span class="cl-source-title">${s.title}</span>
        </a>`).join('');
    el.classList.remove('hidden');
  }

  // Auto-scroll expansion into view within the card
  exp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.ContextLens.showError = function (card, errorCode) {
  card.querySelector('.cl-loading').classList.add('hidden');
  card.querySelector('.cl-answer').classList.add('hidden');
  const msgs = {
    'RATE_LIMIT': 'Daily limit reached — resets in a few hours.',
    'NO_GEMINI_KEY': 'Add your Gemini API key in ContextLens settings.',
    'SAFETY_FILTERED': 'Gemini couldn\'t generate an answer for this selection.',
    'NETWORK': 'Could not connect. Check your internet.',
    'DEFAULT': 'Something went wrong. Try again.'
  };
  const el = card.querySelector('.cl-error');
  el.innerHTML = `<span class="cl-error-icon">⚠</span><span>${msgs[errorCode] || msgs['DEFAULT']}</span>`;
  el.classList.remove('hidden');
};

// Usage warning — soft, non-blocking notice below action buttons
window.ContextLens.showUsageWarning = function (card, warningCode) {
  const msgs = {
    'GEMINI_USAGE_HIGH': 'You\'ve used most of your daily Gemini lookups.',
    'TAVILY_USAGE_HIGH': 'You\'ve used most of your monthly web searches.'
  };
  if (!msgs[warningCode]) return;
  const row = card.querySelector('.cl-actions-row');
  if (!row) return;
  const warning = document.createElement('div');
  warning.className = 'cl-usage-warning';
  warning.textContent = msgs[warningCode];
  row.parentNode.insertBefore(warning, row.nextSibling);
};

window.ContextLens.showExpansionError = function (card, errorCode) {
  const exp = card.querySelector('.cl-expansion');
  exp.querySelector('.cl-expansion-loading').classList.add('hidden');
  const msgs = {
    'RATE_LIMIT': 'Daily limit reached — resets in a few hours.',
    'NO_TAVILY_KEY': 'Add your Tavily API key in settings for web lookups.',
    'TAVILY_RATE_LIMIT': 'Search limit reached for this month.',
    'DEFAULT': 'Could not load. Try again.'
  };
  const el = exp.querySelector('.cl-expansion-error');
  el.innerHTML = `<span class="cl-error-icon">⚠</span><span>${msgs[errorCode] || msgs['DEFAULT']}</span>`;
  el.classList.remove('hidden');
};
```

---

### 7. `content/content.js`

**Updated:** Fires Free Dictionary API in parallel with Gemini for vocabulary selections. Handles progressive rendering.

```javascript
(async function () {
  const CL = window.ContextLens;
  if (CL.isBlockedPage()) return;
  if (await CL.isUserBlockedDomain()) return;

  let triggerIcon = null;
  let card = null;
  let currentSelectedText = '';
  let currentPageContext = null;
  let currentSurroundingContext = '';

  function createTriggerIcon() {
    const icon = document.createElement('div');
    icon.id = 'contextlens-trigger';
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="#4F46E5"/>
      <path d="M5.5 8.5C5.5 8.5 6.5 10 8 10C9.5 10 10.5 8.5 10.5 8.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="6" cy="6.5" r="0.8" fill="white"/><circle cx="10" cy="6.5" r="0.8" fill="white"/>
    </svg>`;
    icon.title = 'Look up with ContextLens';
    document.body.appendChild(icon);
    return icon;
  }

  function showTriggerIcon(rect) {
    if (!triggerIcon) triggerIcon = createTriggerIcon();
    triggerIcon.style.top = `${rect.bottom + window.scrollY + 4}px`;
    triggerIcon.style.left = `${rect.left + window.scrollX}px`;
    triggerIcon.classList.add('visible');
  }

  function hideTriggerIcon() { triggerIcon?.classList.remove('visible'); }

  function removeCard() {
    if (card) { card.classList.remove('visible'); setTimeout(() => { card?.remove(); card = null; }, 200); }
  }

  function openCard(selectionRect, selectedText) {
    removeCard();
    CL.abortPending(); // Cancel any in-flight API calls from previous card

    const classification = CL.classify(selectedText);
    if (classification === 'skip') return;

    card = CL.createCard(classification);
    card.dataset.selectedText = selectedText;
    document.body.appendChild(card);

    const pos = CL.calculatePosition(selectionRect);
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
    requestAnimationFrame(() => card.classList.add('visible'));

    card.querySelector('.cl-new-tab').href =
      `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;

    card.querySelector('.cl-close').addEventListener('click', removeCard);

    card.querySelectorAll('.cl-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleActionClick(btn.dataset.intent));
    });

    currentPageContext = CL.getPageContext();
    currentSurroundingContext = CL.getSurroundingContext(selectedText);

    // === THREE-TIER PARALLEL LAUNCH ===

    // For vocabulary: fire Free Dictionary API (Tier 0) AND Gemini (Tier 1) in parallel
    if (classification === 'vocabulary' && selectedText.split(/\s+/).length === 1) {
      // Tier 0: generic dictionary (fast, renders first)
      CL.fetchDictionaryDefinition(selectedText).then(dictResult => {
        if (card) CL.showGenericDefinition(card, dictResult);
      });
    }

    // Tier 1: contextual meaning (always fires)
    runContextualAnswer(selectedText);
  }

  async function runContextualAnswer(selectedText) {
    try {
      const result = await CL.runContextualQuery(selectedText, currentPageContext, currentSurroundingContext);
      if (card) {
        CL.showAnswer(card, result.answer);
        if (result.usageWarning) CL.showUsageWarning(card, result.usageWarning);
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // Card was closed, ignore
      const code = err.message.includes('RATE_LIMIT') ? 'RATE_LIMIT'
        : err.message.includes('NO_GEMINI_KEY') ? 'NO_GEMINI_KEY'
        : err.message.includes('SAFETY_FILTERED') ? 'SAFETY_FILTERED'
        : 'DEFAULT';
      if (card) CL.showError(card, code);
    }
  }

  async function handleActionClick(intent) {
    if (!card) return;
    card.querySelectorAll('.cl-action-btn').forEach(b => b.disabled = true);
    CL.showExpansionLoading(card);
    const selectedText = card.dataset.selectedText;

    try {
      if (intent === 'news') {
        const result = await CL.runNewsQuery(selectedText, currentPageContext, currentSurroundingContext);
        CL.showExpansionAnswer(card, result.answer, result.sources);
      } else if (intent === 'deepdive') {
        const previousAnswer = card.dataset.intent1Answer || '';
        const result = await CL.runDeepVocabQuery(selectedText, currentPageContext, currentSurroundingContext, previousAnswer);
        CL.showExpansionAnswer(card, result.answer, null);
      }
    } catch (err) {
      const code = err.message.includes('RATE_LIMIT') ? 'RATE_LIMIT'
        : err.message.includes('NO_TAVILY_KEY') ? 'NO_TAVILY_KEY'
        : err.message.includes('TAVILY_RATE_LIMIT') ? 'TAVILY_RATE_LIMIT' : 'DEFAULT';
      CL.showExpansionError(card, code);
    }
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#contextlens-card') || e.target.closest('#contextlens-trigger')) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2) { hideTriggerIcon(); return; }
    if (card && card.dataset.selectedText === text) return;
    currentSelectedText = text;
    showTriggerIcon(sel.getRangeAt(0).getBoundingClientRect());
    removeCard();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#contextlens-trigger')) {
      e.preventDefault(); e.stopPropagation();
      const sel = window.getSelection();
      if (!sel || !currentSelectedText) return;
      hideTriggerIcon();
      openCard(sel.getRangeAt(0).getBoundingClientRect(), currentSelectedText);
      return;
    }
    if (card && !e.target.closest('#contextlens-card')) { removeCard(); hideTriggerIcon(); }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { removeCard(); hideTriggerIcon(); } });
})();
```

---

### 8. `content/content.css`

**Updated:** Added `.cl-generic-def` style for the grey dictionary sub-line.

```css
/* =================== RESET =================== */
#contextlens-card, #contextlens-card * {
  all: initial;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

/* =================== TRIGGER ICON =================== */
#contextlens-trigger {
  all: initial; position: absolute; z-index: 2147483646;
  cursor: pointer; display: none; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: #4F46E5; border-radius: 50%;
  box-shadow: 0 2px 8px rgba(79,70,229,0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
#contextlens-trigger.visible { display: flex; }
#contextlens-trigger:hover { transform: scale(1.1); box-shadow: 0 4px 12px rgba(79,70,229,0.5); }
#contextlens-trigger svg { all: initial; display: block; }

/* =================== CARD =================== */
#contextlens-card {
  all: initial; position: absolute; z-index: 2147483645;
  width: 380px; max-height: 520px; overflow-y: auto;
  opacity: 0; transform: translateY(6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
}
#contextlens-card.visible { opacity: 1; transform: translateY(0); pointer-events: all; }
#contextlens-card::-webkit-scrollbar { width: 4px; }
#contextlens-card::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 4px; }

.cl-card-inner {
  display: flex; flex-direction: column;
  background: #ffffff; border: 1px solid #E5E7EB; border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
  overflow: hidden;
}

/* =================== HEADER =================== */
.cl-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #F3F4F6; background: #FAFAFA;
}
.cl-category-label {
  font-size: 10px; font-weight: 600; color: #9CA3AF;
  letter-spacing: 0.05em; text-transform: uppercase;
}
.cl-close {
  all: initial; cursor: pointer; font-family: inherit;
  font-size: 13px; color: #9CA3AF; padding: 2px 4px;
  border-radius: 4px; line-height: 1; transition: color 0.12s ease;
}
.cl-close:hover { color: #374151; }

/* =================== BODY =================== */
.cl-body { padding: 14px 14px 10px 14px; min-height: 60px; }
.cl-loading { display: flex; align-items: center; gap: 10px; color: #6B7280; font-size: 13px; }
.cl-spinner {
  width: 16px; height: 16px; border: 2px solid #E5E7EB; border-top-color: #4F46E5;
  border-radius: 50%; animation: cl-spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes cl-spin { to { transform: rotate(360deg); } }

.cl-answer { font-size: 13.5px; line-height: 1.6; color: #1F2937; }

/* Generic dictionary definition — grey sub-line, renders before Gemini */
.cl-generic-def {
  font-size: 12px; line-height: 1.5; color: #9CA3AF;
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E5E7EB;
  font-style: italic;
}

.cl-error {
  display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6B7280;
  padding: 8px 10px; background: #F9FAFB; border-radius: 8px; border: 1px solid #F3F4F6;
}
.cl-error-icon { font-size: 15px; color: #F59E0B; flex-shrink: 0; }

/* =================== ACTION BUTTONS =================== */
.cl-actions-row { display: flex; gap: 6px; padding: 6px 14px 10px 14px; flex-wrap: wrap; }
.cl-action-btn {
  all: initial; cursor: pointer; font-family: inherit;
  font-size: 11.5px; font-weight: 500; border-radius: 6px;
  padding: 5px 12px; transition: all 0.12s ease; white-space: nowrap;
}
.cl-action-primary { background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE; }
.cl-action-primary:hover { background: #E0E7FF; border-color: #A5B4FC; }
.cl-action-secondary { background: #F9FAFB; color: #6B7280; border: 1px solid #E5E7EB; }
.cl-action-secondary:hover { background: #F3F4F6; color: #374151; }
.cl-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Usage warning — soft amber notice */
.cl-usage-warning {
  font-size: 11px; color: #92400E; background: #FFFBEB;
  border: 1px solid #FDE68A; border-radius: 6px;
  padding: 4px 12px; margin: 0 14px 6px 14px;
}

/* =================== EXPANSION =================== */
.cl-expansion {
  padding: 0 14px 10px 14px; border-top: 1px solid #F3F4F6;
  margin-top: 4px; padding-top: 12px;
}
.cl-expansion-loading { display: flex; align-items: center; gap: 10px; color: #6B7280; font-size: 13px; padding-bottom: 8px; }
.cl-expansion-answer { font-size: 13px; line-height: 1.6; color: #374151; }
.cl-expansion-error {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6B7280;
  padding: 6px 8px; background: #FEF3C7; border-radius: 6px; border: 1px solid #FDE68A;
}
.cl-citation {
  color: #4F46E5; text-decoration: none; font-weight: 600;
  font-size: 11px; vertical-align: super; line-height: 0;
}
.cl-citation:hover { text-decoration: underline; }

.cl-expansion-sources { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #F3F4F6; padding-top: 10px; margin-top: 10px; }
.cl-sources-label { font-size: 10px; font-weight: 600; color: #9CA3AF; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
.cl-source-item {
  all: initial; display: flex; align-items: flex-start; gap: 6px;
  cursor: pointer; text-decoration: none; padding: 4px 6px;
  border-radius: 6px; transition: background 0.1s ease;
}
.cl-source-item:hover { background: #F9FAFB; }
.cl-source-num { font-size: 10px; font-weight: 700; color: #4F46E5; background: #EEF2FF; border-radius: 3px; padding: 1px 5px; flex-shrink: 0; margin-top: 1px; }
.cl-source-title { font-size: 12px; color: #374151; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* =================== FOOTER =================== */
.cl-footer {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 12px; border-top: 1px solid #F3F4F6;
}
.cl-new-tab {
  all: initial; font-family: inherit; font-size: 12px; color: #6B7280;
  text-decoration: none; cursor: pointer;
  transition: color 0.12s ease;
}
.cl-new-tab:hover { color: #4F46E5; }

.hidden { display: none !important; }
```

---

### 9. `settings/settings.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ContextLens Settings</title>
  <link rel="stylesheet" href="settings.css">
</head>
<body>
  <div class="cl-settings">
    <div class="cl-settings-header">
      <div class="cl-logo">
        <div class="cl-logo-icon">◎</div>
        <span>ContextLens</span>
      </div>
      <p class="cl-tagline">Context-aware lookup, right where you're reading.</p>
    </div>

    <div class="cl-section">
      <label class="cl-label">Gemini API Key <span class="cl-required">*</span></label>
      <p class="cl-hint">Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com</a> — no credit card.</p>
      <div class="cl-input-row">
        <input type="password" id="geminiKey" placeholder="AIza..." class="cl-input" />
        <button class="cl-show-btn" data-target="geminiKey">Show</button>
      </div>
    </div>

    <div class="cl-section">
      <label class="cl-label">Tavily API Key <span class="cl-optional">(for news lookups)</span></label>
      <p class="cl-hint">Get 1,000 free searches/month at <a href="https://tavily.com" target="_blank">tavily.com</a> — no credit card.</p>
      <div class="cl-input-row">
        <input type="password" id="tavilyKey" placeholder="tvly-..." class="cl-input" />
        <button class="cl-show-btn" data-target="tavilyKey">Show</button>
      </div>
    </div>

    <div class="cl-section">
      <label class="cl-label">Disabled Sites</label>
      <p class="cl-hint">Auto-disabled on login, banking, and payment pages. Add more below.</p>
      <div class="cl-input-row">
        <input type="text" id="newBlockedDomain" placeholder="e.g. example.com" class="cl-input" />
        <button class="cl-add-btn" id="addDomainBtn">Add</button>
      </div>
      <div id="blockedDomainsList" class="cl-tags"></div>
    </div>

    <div class="cl-actions">
      <button class="cl-save-btn" id="saveBtn">Save Settings</button>
      <span class="cl-save-status" id="saveStatus"></span>
    </div>

    <div class="cl-footer-note">
      ContextLens reads page text only when you trigger a lookup. Nothing is stored or sent beyond your API providers.
    </div>
  </div>
  <script src="settings.js"></script>
</body>
</html>
```

---

### 10. `settings/settings.js`

```javascript
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['geminiKey', 'tavilyKey', 'blockedDomains'], (result) => {
    if (result.geminiKey) document.getElementById('geminiKey').value = result.geminiKey;
    if (result.tavilyKey) document.getElementById('tavilyKey').value = result.tavilyKey;
    renderBlockedDomains(result.blockedDomains || []);
  });

  document.querySelectorAll('.cl-show-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
  });

  document.getElementById('addDomainBtn').addEventListener('click', () => {
    const input = document.getElementById('newBlockedDomain');
    const domain = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) return;

    chrome.storage.sync.get(['blockedDomains'], (result) => {
      const domains = result.blockedDomains || [];
      if (!domains.includes(domain)) {
        domains.push(domain);
        chrome.storage.sync.set({ blockedDomains: domains }, () => {
          renderBlockedDomains(domains);
          input.value = '';
        });
      }
    });
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const geminiKey = document.getElementById('geminiKey').value.trim();
    const tavilyKey = document.getElementById('tavilyKey').value.trim();
    chrome.storage.sync.set({ geminiKey, tavilyKey }, () => {
      const status = document.getElementById('saveStatus');
      status.textContent = 'Saved ✓';
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 2000);
    });
  });
});

function renderBlockedDomains(domains) {
  const container = document.getElementById('blockedDomainsList');
  container.innerHTML = domains.map(domain => `
    <div class="cl-tag">
      <span>${domain}</span>
      <button class="cl-tag-remove" data-domain="${domain}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.cl-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.storage.sync.get(['blockedDomains'], (result) => {
        const updated = (result.blockedDomains || []).filter(d => d !== btn.dataset.domain);
        chrome.storage.sync.set({ blockedDomains: updated }, () => renderBlockedDomains(updated));
      });
    });
  });
}
```

---

### 11. `settings/settings.css`

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: #ffffff;
  color: #1F2937;
  width: 360px;
  padding: 20px;
}

.cl-settings { display: flex; flex-direction: column; gap: 18px; }

.cl-settings-header { text-align: center; }
.cl-logo { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
.cl-logo-icon { font-size: 22px; color: #4F46E5; }
.cl-logo span { font-size: 18px; font-weight: 700; color: #1F2937; }
.cl-tagline { font-size: 12px; color: #9CA3AF; }

.cl-section { display: flex; flex-direction: column; gap: 6px; }
.cl-label { font-size: 13px; font-weight: 600; color: #374151; }
.cl-required { color: #EF4444; }
.cl-optional { font-weight: 400; color: #9CA3AF; font-size: 11px; }
.cl-hint { font-size: 11px; color: #9CA3AF; line-height: 1.4; }
.cl-hint a { color: #4F46E5; text-decoration: none; }
.cl-hint a:hover { text-decoration: underline; }

.cl-input-row { display: flex; gap: 6px; }
.cl-input {
  flex: 1; padding: 7px 10px; font-size: 13px;
  border: 1px solid #E5E7EB; border-radius: 6px;
  color: #374151; background: #F9FAFB; outline: none;
  transition: border-color 0.15s ease;
}
.cl-input:focus { border-color: #4F46E5; }

.cl-show-btn, .cl-add-btn {
  padding: 7px 12px; font-size: 12px; font-weight: 500;
  border: 1px solid #E5E7EB; border-radius: 6px;
  background: #ffffff; color: #374151; cursor: pointer;
  transition: background 0.12s ease;
}
.cl-show-btn:hover, .cl-add-btn:hover { background: #F3F4F6; }

.cl-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.cl-tag {
  display: flex; align-items: center; gap: 4px;
  background: #F3F4F6; border-radius: 4px; padding: 3px 8px;
  font-size: 12px; color: #374151;
}
.cl-tag-remove {
  background: none; border: none; color: #9CA3AF; cursor: pointer;
  font-size: 13px; padding: 0 2px; line-height: 1;
}
.cl-tag-remove:hover { color: #EF4444; }

.cl-actions { display: flex; align-items: center; gap: 10px; }
.cl-save-btn {
  padding: 8px 20px; font-size: 13px; font-weight: 600;
  background: #4F46E5; color: #ffffff; border: none;
  border-radius: 6px; cursor: pointer;
  transition: background 0.12s ease;
}
.cl-save-btn:hover { background: #4338CA; }
.cl-save-status {
  font-size: 12px; color: #10B981; opacity: 0;
  transition: opacity 0.2s ease;
}
.cl-save-status.visible { opacity: 1; }

.cl-footer-note {
  font-size: 10px; color: #D1D5DB; text-align: center;
  line-height: 1.4; margin-top: 4px;
}
```

---

### 12. `background/service-worker.js`

```javascript
chrome.runtime.onInstalled.addListener((details) => {
  // Set defaults on first install
  chrome.storage.sync.get(['blockedDomains'], (result) => {
    if (!result.blockedDomains) {
      chrome.storage.sync.set({ blockedDomains: [] });
    }
  });

  // Auto-open settings page on first install so user can enter API keys
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'settings/settings.html' });
  }
});
```

---

### 13. Icons

The spec requires `icons/icon16.png`, `icons/icon48.png`, and `icons/icon128.png`. OpenCode cannot generate PNG files.

**Options (pick one):**
- Tell OpenCode to create SVG versions and you convert to PNG manually using any online SVG-to-PNG converter.
- Create simple icons yourself: an indigo (#4F46E5) circle with a white magnifying glass or lens shape, on a transparent background, at 16x16, 48x48, and 128x128.
- Use a placeholder: tell OpenCode to create a simple canvas-generated PNG script that outputs the icons.

---

## Testing Checklist

**Three-tier pipeline:**
- [ ] Select common word ("call") on a tech article → generic definition appears in ~100ms (grey line), contextual meaning appears in ~1-2s (primary)
- [ ] Select jargon word ("tokenizer") → no grey line (dictionary returns nothing), contextual meaning appears
- [ ] Select entity ("Anthropic") → no grey line, contextual meaning appears
- [ ] Select full sentence → contextual analysis, no grey line

**Session cache:**
- [ ] Select "SLA" → get answer → select "SLA" again → answer appears instantly (no loading spinner)
- [ ] Select "SLA" → navigate to different article → select "SLA" → new answer loads (different URL = cache miss)
- [ ] Close browser completely → reopen → select "SLA" → fresh API call (session cache cleared)

**Action buttons + expansion:**
- [ ] Click "Deep dive" → expansion loads below, original answer stays
- [ ] Click "Latest news" → expansion loads with citations + sources
- [ ] Expansion fails → error in expansion area, original answer untouched

**Card positioning:**
- [ ] Selection near top of page → card appears below
- [ ] Selection near bottom of viewport → card appears above
- [ ] Selection on page with sticky header → card clears the header
- [ ] Selection near right edge → card anchors left

**Blocklist:**
- [ ] Visit a page with "login" in URL → extension stays dormant (no icon appears)
- [ ] Visit a page with `input[type="password"]` → extension stays dormant
- [ ] Add a domain to blocklist in settings → visit that domain → extension dormant
- [ ] Remove domain from blocklist → visit again → extension active

**Error states:**
- [ ] Delete Gemini key from settings → trigger lookup → card shows "Add your Gemini API key" error
- [ ] Tavily key missing → click "Look up" → expansion shows Tavily key error; Intent 1 answer still visible
- [ ] Rate limit hit → card shows "Daily limit reached" message with Google escape hatch

**Escape hatches:**
- [ ] "Search in Google ↗" link → opens Google search in new tab with selected text as query
- [ ] Press Escape → card closes
- [ ] Click outside card → card closes
- [ ] Select new text while card is open → card closes, new trigger icon appears

**Onboarding:**
- [ ] Install extension for the first time → settings page auto-opens in new tab

**Guardrails:**
- [ ] LLM response with HTML tags → tags are stripped, only plain text renders
- [ ] Select text, then quickly select new text before first answer loads → first call aborted, no duplicate cards
- [ ] Gemini refuses answer (safety filter) → card shows "Couldn't generate an answer" message, not a crash
- [ ] Make 1,200+ Gemini calls in a day → usage warning appears: "You've used most of your daily lookups"
- [ ] Extension on a page with hidden prompt injection text → surrounding context uses innerText (skips hidden elements)

---

## What NOT to Build in V1

Do not add any of these. They are explicitly deferred:

- Reading history / lookup history
- Session memory across selections
- Page summarization, translation, rewriting
- Conversational follow-up threading
- PDF support
- Firefox / Safari port
- Cloud sync of lookups
- User accounts
- Any analytics or telemetry
- Right-click context menu alternative
- Keyboard shortcut alternative trigger

---

## Notes for OpenCode

- Do not use any build tools, bundlers, or npm packages. Vanilla JS + CSS only. No React, no Webpack, no TypeScript.
- The `all: initial` CSS reset on `#contextlens-card *` is critical. Without it, host page styles bleed into the card. Do not remove.
- z-index values (2147483645/46) are intentional — near max safe integer value. Ensures card renders above most page elements.
- All API calls happen from content scripts directly (host_permissions in manifest allow it in Manifest V3).
- `chrome.storage.session` requires Manifest V3. Already set in manifest.
- The Free Dictionary API at `api.dictionaryapi.dev` has no CORS restrictions — works from content scripts.
- The in-memory cache (`_memoryCache`) is per-tab. Each tab has its own content script instance.
- Don't confuse `chrome.storage.session` (volatile, per-session) with `chrome.storage.sync` (persistent, synced). API keys go in `sync`, response cache goes in `session`.
- For icons: create SVG files with an indigo (#4F46E5) circle and a white lens/search shape. Convert to PNG at 16x16, 48x48, and 128x128 manually or via an online converter.
- Test on at minimum: a Substack article, a Wikipedia page, a news article (NYT/Guardian), and a GitHub README.
