# PRD: ContextLens

**Author:** Srivatsan  
**Date:** May 28, 2026  
**Version:** 1.0  
**Status:** Building

---

## Problem

When reading articles, blogs, or documentation online, readers frequently encounter unfamiliar words, acronyms, referenced events, or quoted claims they want to understand better. The current workflow is: select text → copy → open new tab → paste into Google → read results → switch back to the original tab. This workflow breaks reading flow every time it happens. The cognitive cost of context-switching is well-documented — each switch fragments comprehension and makes it harder to return to the reading state.

The problem isn't that search is hard. It's that the act of leaving the page to search is disproportionately expensive for what is usually a 5-second question.

---

## Users

Primary: anyone who reads long-form content online — Substack posts, technical documentation, news articles, research papers — and frequently encounters terms or references they don't fully know. Curious, self-directed learners who currently rely on "open new tab and Google it" as their primary learning tool.

---

## Solution

A Chrome extension that lets you select any text on a webpage, click a small icon that appears near the selection, and see an AI-generated contextual answer in an inline card — anchored right next to what you selected. The card knows what page you're on and tailors its answer to the reading context.

For common English words, a generic dictionary definition appears instantly (~100ms) while the contextual AI answer loads (~1-2s). Action buttons let users go deeper — deep vocabulary or web news lookup — with one click.

---

## Core Experience

**Step 1: Select text.** Highlight anything — a word, a phrase, a sentence. A small indigo icon appears near the selection.

**Step 2: Click the icon.** An inline card appears, anchored to the selection. For vocabulary words, two things happen in parallel: a generic dictionary definition renders instantly from the Free Dictionary API (grey sub-line), and a contextual meaning query runs against Gemini. The contextual answer appears in 1-2 seconds above the generic definition.

**Step 3: Optionally go deeper.** Below the answer, two action buttons always appear — same labels, same order, same visual style, every time:

- **📖 Deep dive** (always left) → for vocabulary/entities: expanded definition, usage examples, commonly confused terms. For phrases/paragraphs: deeper analysis of the author's argument, context, and implications. The prompt routes intelligently behind the scenes.
- **📰 Look up** (always right) → web search via Tavily + Gemini synthesis with inline numbered citations and up to 5 ranked sources. Long selections are auto-truncated for better search results.

A "Search in Google ↗" escape hatch is always available to open a full search in a new tab.

---

## Three Intents

**Intent 1 — Contextual Meaning (always runs first).** "What does this mean here?" Uses page title, domain, and surrounding paragraph to produce a context-aware explanation. Powered by Gemini. No web search needed.

**Intent 2 — News / Web Lookup (triggered by action button).** "What's the current situation around this?" Runs a web search via Tavily, synthesizes results with Gemini, returns an answer with inline numbered citations and up to 5 ranked sources.

**Intent 3 — Deep Vocabulary (triggered by action button).** "Teach me this word properly." Returns an expanded definition tailored to the reading domain, 2-3 usage examples in different contexts, and commonly confused terms.

---

## Three-Tier Lookup Pipeline (Architecture)

```
Tier 0: Free Dictionary API — zero cost, no key, ~100ms
        For generic definitions of common English words.
        Fires in parallel with Tier 1 for vocabulary words.

Tier 1: Gemini Flash — free tier, 1,500 req/day, ~1-2s
        (Verify model string in AI Studio: gemini-2.5-flash or gemini-2.0-flash)
        Context-aware answers using page title + domain + surrounding paragraph.
        Used for Intent 1 (contextual meaning) and Intent 3 (deep dive).

Tier 2: Tavily + Gemini — Tavily free tier, 1,000 credits/month, ~2-3s
        Web search + LLM synthesis. Used for Intent 2 (news/lookup).
        Only fires on explicit user click. Never automatic.
```

For vocabulary words, Tier 0 and Tier 1 fire simultaneously. The generic definition renders in ~100ms (instant value), and the contextual AI answer renders in ~1-2s (full value). Progressive rendering.

---

## Cost Optimizations

**Session response cache.** Before any API call, check if `{pageURL}:{selectedText}:{intent}` exists in `chrome.storage.session`. If yes, return instantly. Re-looking up the same word on the same page costs nothing. Cache clears when browser closes.

**Page context: title + domain only.** No page body extraction. `document.title` + hostname = ~15-20 tokens per prompt. Surrounding paragraph = ~100-150 tokens. Total ~200-300 tokens per lookup, not 500-800.

**Free Dictionary for generics.** Common English words get a dictionary definition without any LLM call. If the user only needs the generic meaning, the LLM result is bonus.

**Tier 2 only on explicit click.** Web search never fires automatically. Tavily credits preserved for when the user actually wants news.

---

## Classification Logic

| Selection type | Examples | Default answer | Action buttons (always same) |
|---|---|---|---|
| Vocabulary | "SLA", "tokenizer", "call" | Contextual meaning + generic definition | 📖 Deep dive (vocab) · 📰 Look up · Google |
| Entity | "Anthropic", "EU AI Act", "Biden" | Contextual meaning | 📖 Deep dive (vocab) · 📰 Look up · Google |
| Phrase (5-49 words) | "precisely because they could not afford a professional" | Contextual analysis | 📖 Deep dive (analysis) · 📰 Look up · Google |
| Paragraph (50+ words) | Full paragraph selection | Contextual analysis | 📖 Deep dive (analysis) · 📰 Look up · Google |

Every classification shows the same two buttons in the same order with the same visual style. The difference is invisible to the user: "Deep dive" routes to a vocabulary prompt for words/entities and an analysis prompt for phrases/paragraphs. "Look up" truncates long queries for better results.

Classification uses local heuristics (not ML): capitalization pattern, word count, entity signal word list, code block detection, sentence-start punctuation checking. Zero cost, zero latency.

---

## UX Differentiator: Inline Card (Not a Sidebar)

Every major competitor opens a sidebar panel (Perplexity, Monica, Sider, MaxAI). Sidebars consume 30-40% of screen width, push page content over, and feel like a second application.

ContextLens uses an inline anchored card — a small popup appearing directly adjacent to the selected text. Inspired by Atlassian's inline knowledge cards in Confluence/Jira. Dismisses on click-outside, Escape key, or new selection.

---

## Context-Awareness

Every query includes: page title (from `document.title`), domain (from hostname), and surrounding paragraph (~600 characters around the selection). This means selecting "SLA" on an AI infrastructure article gives a response about service agreements between AI providers and customers, not a generic definition.

---

## Sensitive Page Protection

Auto-disabled on URLs matching: login, signin, account, bank, checkout, payment, password, wallet, auth, verify. Also auto-disabled on pages containing `input[type="password"]` fields. User can add domains to blocklist from settings.

---

## Error Handling

| Failure | User sees |
|---|---|
| Gemini rate limit | Calm inline error: "Daily limit reached — resets in a few hours." + Google escape hatch |
| Tavily rate limit | Error in expansion area only. Intent 1 answer preserved. |
| Tavily key missing | Expansion error. Intent 1 still works. |
| Gemini key missing | Card body error: "Add your Gemini API key in settings." |
| Free Dictionary returns nothing | No generic definition line. Contextual meaning still loads. |
| Network error | "Could not connect. Check your internet." |

Critical principle: expansion failures (Intent 2/3) never destroy the original Intent 1 answer.

---

## Guardrails & Safety

**Output sanitization (XSS prevention).** LLM responses are stripped of all HTML tags before rendering. The card only injects our own citation links, which are generated from known-safe source URLs. This prevents malicious or malformed LLM output from executing scripts in the host page.

**Prompt injection mitigation.** The extension extracts surrounding context using `innerText`, which excludes hidden elements, invisible text, and display:none content. This reduces (but does not eliminate) the risk of a malicious page embedding hidden instructions that get sent to the LLM. For a personal project this is an acceptable level of protection. A production version would need server-side prompt filtering.

**Request abort on new selection.** When the user opens a new card before the previous API call completes, the in-flight `fetch` is aborted via `AbortController`. This prevents runaway API calls, duplicate responses, and wasted quota.

**Usage tracking and soft warnings.** The extension tracks Gemini calls per day and Tavily calls per month in `chrome.storage.session`. When usage hits 80% of the free tier limit (1,200 Gemini calls/day or 800 Tavily credits/month), a soft amber warning appears below the answer: "You've used most of your daily lookups." This prevents surprise rate limit errors.

**Content safety (LLM safety filters).** Gemini has built-in safety filters that refuse to answer certain queries. When Gemini returns a `SAFETY` finish reason, the card shows "Couldn't generate an answer for this selection" instead of an empty or broken card. No additional content filtering is applied — adding a custom filter would create false positives for legitimate educational lookups (medical, legal, historical terms).

**API key storage.** Keys are stored in `chrome.storage.sync`, which is encrypted at rest by Chrome. Keys are transmitted in API requests (Gemini via URL parameter, Tavily via header) — standard for these APIs. For a personal project this is acceptable. A production extension would proxy through a backend so keys never leave the browser.

**DOM isolation.** The card uses Shadow DOM (`attachShadow`) for complete CSS isolation — the same approach used by Atlassian, Grammarly, and every production Chrome extension. Host page styles cannot leak into the card, and card styles cannot affect the page. Z-index values near the maximum safe integer ensure the card renders above page elements.

**Sensitive page auto-disable.** URL pattern matching + password field detection. Documented in detail above.

### Known Limitations

These are accepted risks that are documented, not hidden:

- **Prompt injection is mitigated, not eliminated.** A sophisticated attacker could craft visible text that doubles as an LLM instruction. Full mitigation requires server-side prompt classification, which is out of scope for V1.
- **API keys are in the browser.** Anyone who inspects the extension's storage can see the keys. This is inherent to a client-side-only architecture with no backend.
- **Privacy: lookups are sent to Google and Tavily.** The selected text, surrounding paragraph, and page title are transmitted to these providers with every non-cached lookup. This is disclosed in the settings page but there's no way to avoid it without running a local model.
- **No content moderation layer.** The extension relies entirely on Gemini's built-in safety filters. If Gemini produces a wrong or misleading answer, there's no fact-checking mechanism.
- **Usage counter is per-session, not persistent.** If the user closes and reopens Chrome mid-day, the Gemini counter resets to zero (even though the actual API quota is still partially consumed). This could lead to an unexpected rate limit in edge cases.

---

## Observability

Every decision point in the extension pipeline is instrumented with structured console logs. This serves three purposes: debugging during development, validating that classification and routing behave correctly on real pages, and demonstrating the internal decision flow in portfolio demos.

**Design principle:** Log at every state transition, not just errors. The log trace for a single lookup should tell a complete story — what was selected, how it was classified (and why), whether cache hit, what was sent to each API, what came back, and what was rendered. Each log line is tagged and prefixed with `[ContextLens:TAG]` for easy console filtering.

**Log points in execution order:**

| Tag | Where | What it shows |
|---|---|---|
| SELECT | content.js mouseup | text, wordCount |
| CLASSIFY | classifier.js each return | text, classification, reason (e.g. "everyWordCapped, notSentenceStart") |
| OPEN | content.js openCard | text, classification, wordCount |
| DICT_REQ / DICT_RES | api.js dictionary | word, found, definition, status |
| CACHE | api.js getFromCache | intent, hit/miss, source (memory/session) |
| LLM_REQ / LLM_RES | api.js callGemini | provider, model, promptLength, latency, responseLength |
| KEYWORDS | api.js runContextualQuery | hasKeywords, keywords text |
| INTENT1_START / INTENT1_DONE | api.js runContextualQuery | selectedText, source (cache/api), hasKeywords |
| INTENT1_OK | content.js runContextualAnswer | hasKeywords, keywords |
| RENDER (intent1) | card-renderer.js showAnswer | type, hasKeywords, classification |
| ACTION | content.js handleActionClick | intent (news/deepdive) |
| NEWS_START / NEWS_DONE | api.js runNewsQuery | selectedText, searchKeywords, sourceCount |
| TAVILY_REQ / TAVILY_RES | api.js callTavily | query, topic, days, resultCount, titles, latency |
| DEEP_START / DEEP_DONE | api.js runDeepDiveQuery | classification, selectedText, source (cache/api) |
| RENDER (expansion/error) | card-renderer.js | type, hasSources/sourceCount/errorCode |
| ERROR | content.js catch | code, phase |

**Example trace for a single lookup** (what you'd see in DevTools Console):

```
[ContextLens:SELECT]       text="2022 Eliminator" wordCount=2
[ContextLens:CLASSIFY]     "2022 Eliminator" → entity (everyWordCapped, notSentenceStart)
[ContextLens:OPEN]         text="2022 Eliminator" classification=entity
[ContextLens:CACHE]        intent=contextual → MISS
[ContextLens:INTENT1_START] "2022 Eliminator"
[ContextLens:LLM_REQ]      provider=gemini model=flash promptLen=287
[ContextLens:LLM_RES]      latency=1340ms responseLen=198
[ContextLens:KEYWORDS]     hasKeywords=true "IPL 2022 Eliminator RCB vs LSG playoff"
[ContextLens:INTENT1_DONE] source=api hasKeywords=true
[ContextLens:INTENT1_OK]   hasKeywords=true keywords="IPL 2022 Eliminator RCB vs LSG playoff"
[ContextLens:RENDER]       type=intent1 classification=entity hasKeywords=true
[ContextLens:ACTION]       intent=news
[ContextLens:NEWS_START]   searchKeywords="IPL 2022 Eliminator RCB vs LSG playoff"
[ContextLens:TAVILY_REQ]   query="IPL 2022 Eliminator RCB vs LSG playoff" topic=news days=30
[ContextLens:TAVILY_RES]   resultCount=5 latency=890ms
[ContextLens:LLM_REQ]      provider=gemini model=flash promptLen=412
[ContextLens:LLM_RES]      latency=1620ms responseLen=245
[ContextLens:NEWS_DONE]    sourceCount=5
[ContextLens:RENDER]       type=expansion hasSources=true sourceCount=5
```

**No sensitive data is logged.** Page URLs and titles appear in logs (visible in DevTools which the user already has open), but no API keys, no page body content, and nothing is transmitted externally. All logs are `console.log` — they exist only in the browser's developer tools and disappear when the tab closes.

---

## Competitive Landscape

| | Perplexity | Monica | MaxAI | Sider | Google Dict | **ContextLens** |
|---|---|---|---|---|---|---|
| UX | Sidebar | Sidebar | Sidebar | Sidebar | Popup | **Inline card** |
| Context-aware | Partial | Yes | Yes | Yes | No | **Yes** |
| Intent routing | None | None | User picks | None | Def. only | **Auto + override** |
| Deep vocab mode | No | No | No | No | Basic | **Yes** |
| Progressive rendering (instant + AI) | No | No | No | No | Instant only | **Yes (100ms + 1-2s)** |
| Price | Free/$20 | Free/$17 | Free/paid | Free/$4 | Free | **Free (BYOK)** |

**Honest assessment:** ContextLens will not match Perplexity or Monica on raw answer quality. The differentiation is in product design decisions: inline card UX, auto intent routing, progressive rendering (generic + contextual), deep vocabulary mode.

---

## Out of Scope (V1)

Page summarization, translation, rewriting. Conversational follow-up threading (V2 candidate). Reading history. Session-level memory. PDF support. Firefox/Safari. User accounts, cloud sync. Analytics. Right-click context menu. Keyboard shortcuts.

---

## V2 Ideas

- Session reading memory — track lookups, connect related concepts across selections
- Reading difficulty score — estimate unknown terms before you start an article
- Lookup dashboard — weekly summary of concepts explored

---

---

# Appendix: Design Decisions & Thinking Log

This appendix documents every significant design decision made during the product design process — the options considered, tradeoffs evaluated, and reasoning behind each choice. It's organized chronologically by the conversation flow.

---

## Decision 1: Where Does the Answer Appear?

**Options evaluated:**

| Option | Pros | Cons |
|---|---|---|
| **New tab** (status quo) | Familiar, full-screen results | Defeats the purpose — this IS the problem |
| **Sidebar panel** | Easy to build, stable across layouts | Pushes page content, feels like separate app, every competitor does this |
| **Inline anchored card** | Contextual, lightweight, novel UX | Hardest to build — position calculation, z-index conflicts, scroll behavior |

**Decision:** Inline anchored card.

**Reasoning:** The sidebar is the safe choice and what every competitor (Perplexity, Monica, MaxAI, Sider) uses. But sidebars take up 30-40% of screen width and feel like opening a second application. The inline card, inspired by Atlassian's knowledge popups in Confluence, appears right where you're reading. It requires careful engineering (viewport edge handling, sticky header detection, Shadow DOM for CSS isolation) but the strongest portfolio demo and the most differentiated UX. If we build a sidebar, we're building a worse Perplexity. The inline card is the reason to exist.

---

## Decision 2: Trigger Mechanism

**Options evaluated:**

| Option | Pros | Cons |
|---|---|---|
| Auto-trigger (popup on selection) | Fastest, zero friction | Fires on accidental selections, copy-paste, text for other purposes |
| Keyboard shortcut | Power-user friendly, least intrusive | Not discoverable for demo/portfolio, requires memorizing |
| **Click on icon** | Intentional, low false-positive, discoverable | One extra click |

**Decision:** Icon appears on text selection, user clicks to trigger.

**Reasoning:** Auto-trigger has too many false positives — people select text to copy, to highlight, to drag. A popup appearing every time would be annoying within minutes. Keyboard shortcut is undiscoverable in a portfolio demo (nobody sees you press Cmd+Shift+E). The icon-on-click pattern is the same one Google Translate, Grammarly, and Atlassian use. Standard, intentional, balanced.

---

## Decision 3: Mode Selection — User Picks vs. Auto-Route vs. Auto-Route + Override

**The question:** When a user selects text, should they tell the extension what kind of answer they want (definition, news, analysis)?

**Options evaluated:**

| Option | Latency | Error rate | Friction | Complexity |
|---|---|---|---|---|
| User picks mode before seeing answer | Zero routing errors | Zero | High — extra step every time | Low |
| Auto-route, no override | Minimal | ~15-20% wrong mode | Low | Medium |
| **Auto-route + override** | Minimal | Recoverable | Very low | Medium |

**Initial decision:** Auto-route with override pills at top of card.

**Revised decision (after further analysis):** Answer-first architecture with conditional action buttons below the answer. The user never picks a mode. They always see Intent 1 (contextual meaning) first. Then they can expand into deeper modes with one click.

**Why the revision:** The pills-at-top design was still asking the user to pick before seeing value. The answer-first design gives value immediately and lets the user go deeper only if they want to. Zero decisions before first value.

---

## Decision 4: Three Intents — What They Are and How They Differ

**The insight:** A user selecting text could want three very different things, and they look identical from the input (just highlighted text). The intents were defined through first-principles analysis:

**Intent 1 — Contextual Meaning.** "What does this mean here?" The word "call" on a programming blog means function invocation. On a telecom article it means a phone conversation. The same word, different contexts, different answers. This is always the right starting point.

**Intent 2 — News/Web Lookup.** "What's happening with this?" A sentence about "Anthropic stopping subscriptions" needs current web results, not a definition. Originally this was restricted to named entities only. It was expanded to be available for all selection types after identifying that phrases and sentences can also reference news events.

**Intent 3 — Deep Vocabulary.** "Teach me this word properly." Beyond a definition — usage examples, common confusions, etymology. Like how Google's vocabulary card works but tailored to the reading context. No competitor offers this as a distinct mode.

---

## Decision 5: Generic + Contextual Definition (Both, Not Either)

**The question:** If someone selects "call" on a tech blog, do they want the programming meaning or the English meaning?

**Options evaluated:**

| Option | Pros | Cons |
|---|---|---|
| Only contextual meaning | Cleaner, one answer | Sometimes user genuinely wants the plain English meaning |
| Only generic dictionary | Fast, free, always correct | Defeats the purpose — no context awareness |
| **Both: contextual (primary) + generic (grey sub-line)** | User gets both perspectives | Slightly more visual complexity |

**Decision:** Show both. Contextual meaning as the primary answer. Generic dictionary definition as a grey, muted sub-line below it.

**Reasoning:** A non-native English speaker reading a tech blog might want the generic meaning of "call" first, then realize "oh, in this context it means something specific." Showing both lets the user compare. The generic line is visually secondary — if you don't need it, you don't notice it.

**Key engineering insight:** The generic definition should NOT come from the LLM. It comes from the Free Dictionary API — zero cost, no API key, ~100ms response time. This becomes the first tier of the three-tier lookup pipeline.

---

## Decision 6: Classification — How to Detect What the User Selected

**The question:** How does the extension know if "Apple" is a company (entity) or a fruit (vocabulary)?

**Approach:** Local heuristics, not ML. No API call for classification.

**Signals used:**
- Capitalization pattern — every word capitalized + not sentence-start = likely entity
- All-caps 2-6 chars = acronym (entity if in curated list, vocabulary otherwise)
- Entity signal words — "Act", "Inc", "Foundation", "Series B"
- Code block detection — selection inside `<code>` or `<pre>` = always vocabulary
- Sentence-start detection — checks punctuation before selection to avoid false entity classification
- Word count — 30+ = paragraph, 5-29 = phrase, 1-4 = vocabulary or entity

**Why not ML/LLM for classification?** An LLM call to classify would add 1-2 seconds of latency and cost tokens BEFORE the actual answer call. For a feature that's supposed to feel instant, that's unacceptable. Local heuristics run in 0ms and are correct 85-90% of the time.

**Accepted errors:** "Series B" may misclassify as phrase (doesn't contain entity signal words unless we add financial terms — which we did). "Apple" at sentence start is assumed vocabulary (sentence-start check catches this). These are recoverable via action buttons — if the classification is wrong, the user can still access the other intents.

---

## Decision 7: Page Context — How Much of the Page to Send

**The question:** Should the extension read the entire page to give the LLM full context?

**Options evaluated:**

| Option | Token cost | Latency | Accuracy | Engineering complexity |
|---|---|---|---|---|
| Nothing (just the selected word) | ~5 tokens | None | 70-80% | None |
| **Title + domain only** | ~15-20 tokens | None (already in DOM) | 85-90% | None |
| Title + first 3 paragraphs | ~150-200 tokens | None (already in DOM) | 90-92% | Low |
| LLM-summarize full page, cache | ~50 tokens (cached) | +2s on first lookup | 95%+ | High |

**Decision:** Title + domain + surrounding paragraph (600 chars).

**Reasoning:** The page title carries 80-90% of the topic signal. "Anthropic Claude Study: AI Startup Playbook" tells the LLM everything it needs to contextualize most terms. The surrounding paragraph handles local context. Together they're ~200-300 tokens, not 500-800.

The "first 3 paragraphs" option was rejected because many articles start with anecdotes, hooks, or personal stories that don't reflect the article's actual topic. A Substack post might not reach its thesis until paragraph 5 or 6. The title is a more reliable topic signal.

The "LLM summarize full page" option was rejected because it costs an extra Gemini call per page (before the user even asks anything), adds 2 seconds of latency to the first lookup, and creates a dependency chain. On free tier (1,500 req/day), burning calls on page summarization means fewer actual lookups.

**The page title is cached** in a JS variable after the first extraction. All subsequent lookups on the same page reuse it without re-reading the DOM.

---

## Decision 8: Cost Architecture — Three-Tier Pipeline

**The problem:** Calling Gemini for every single selection, even common words like "the" or "call", is wasteful. Production AI systems use tiered routing.

**Architecture designed:**

| Tier | What | When | Cost | Latency |
|---|---|---|---|---|
| 0 | Free Dictionary API | Vocabulary words, in parallel with Tier 1 | Free, no key | ~100ms |
| 1 | Gemini 2.5 Flash | Always (Intent 1), on button click (Intent 3) | Free tier, ~200-300 tokens/call | ~1-2s |
| 2 | Tavily + Gemini | Only on explicit "Look up" / "Latest news" click | Tavily: 1 credit. Gemini: ~400 tokens | ~2-3s |

**Key decisions:**

- Tier 0 and Tier 1 fire in **parallel** for vocabulary words. The dictionary definition renders in 100ms while Gemini is still processing. Progressive rendering — user sees value immediately.
- Tier 2 **never fires automatically**. Web search only happens when the user explicitly clicks an action button. This preserves Tavily credits (1,000/month) for when the user actually wants news.
- **Session response cache** checks before any API call. Same word + same page + same intent = instant return from cache. Re-lookups cost nothing. Cache key: `{pageURL}:{selectedText}:{intent}`. Stored in `chrome.storage.session` (clears on browser close).

---

## Decision 9: Sensitive Page Exclusion

**Options evaluated:**

| Option | Accuracy | UX impact | Complexity |
|---|---|---|---|
| URL pattern matching | Moderate (false positives on news about banking) | Invisible when right | Low |
| Password field detection | High for login pages | Invisible | Low |
| Per-page permission prompt | Very high | Unusable — prompt on every page | High |
| **URL patterns + password field detection** | Good combined | Invisible | Low |

**Decision:** Both URL pattern matching AND password field detection. No per-page prompts.

**Blocked URL patterns:** login, signin, account, bank, checkout, payment, password, wallet, auth, verify. Plus user can manually add domains from settings.

---

## Decision 10: API Provider Selection

**LLM — Gemini 2.5 Flash via Google AI Studio**

Evaluated: Groq (fastest, but open-source models only), OpenRouter (aggregator, complex pricing), Anthropic (no free tier without credit card), OpenAI (no free tier).

Winner: Gemini. 1,500 requests/day free, no credit card, no expiry, frontier-quality model, 1M context window.

**Web Search — Tavily**

Evaluated: Google Custom Search (100/day free, raw SERP data requiring extra parsing), Serper (2,500 free queries but trial expires), SerpAPI (100/month free, expensive after).

Winner: Tavily. 1,000 credits/month free, no credit card. Returns AI-optimized citation-ready results — much less parsing than raw SERP data. Risk noted: Tavily acquired by Nebius in Feb 2026, possible pricing changes. Acceptable for personal portfolio project.

**Generic Dictionary — Free Dictionary API**

No alternatives evaluated — it's the only free, no-key, no-rate-limit English dictionary API. `api.dictionaryapi.dev`. Returns definitions, phonetics, parts of speech. Silent failure for jargon (expected, handled gracefully).

---

## Decision 11: Error Resilience — Expansion Failures Must Not Destroy Original Answer

**Principle:** If the user has already received their Intent 1 answer and then clicks "Look up" (Intent 2) which fails — the Intent 1 answer must stay visible. The error only appears in the expansion area below.

**Why this matters:** The user already got value. Taking that value away because a follow-up action failed is a terrible experience. This was designed as a hard constraint, not a nice-to-have.

---

## Decision 12: Why Not Add Page Summarization, Translation, Rewriting?

**The question:** Competitors (Monica, Sider, MaxAI) offer these features. Should we?

**Decision:** No. Explicitly out of scope.

**Reasoning:** Adding those features turns ContextLens into "Monica but worse." The competitive moat is in the focused, novel UX — inline card, intent routing, progressive rendering. Every feature added beyond the core reading-assist use case dilutes the story. For a portfolio project, focus beats breadth. The blog post writes itself as "Why every AI extension gets the UX wrong" — not "I built another generic AI companion."

V2 features should extend the reading-assist thesis (session memory, reading difficulty score), not add unrelated capabilities.

---

## Decision 13: News Intent for Phrases and Sentences

**Original design:** News mode only available for entity-classified selections (proper nouns, named events).

**Challenge raised:** A full sentence like "AI cost being over the horizon and company has stopped the subscription" could reference a news event. News intent should be available for any selection type.

**Revised design:** News/"Look up" action button appears for all classification types (vocabulary, entity, phrase). Only excluded for paragraphs (30+ words). The button is primary (larger) for entities, secondary (smaller) for vocabulary and phrases. This way it's always reachable but doesn't dominate when it's unlikely to be the user's primary intent.

---

## Decision 14: Why Not a Local Dictionary Instead of LLM?

**The question:** Should we pre-load a dictionary and skip the LLM for common words?

**Evaluation:**

A local dictionary answers "what does 'call' mean in English." But our product promises "what does 'call' mean HERE." If the page is about programming, a local dictionary answering "a verbal communication" is wrong. The context-awareness IS the product — stripping it out for cost savings undermines the core value.

**Decision:** Use the Free Dictionary API for the generic meaning (grey sub-line) and Gemini for the contextual meaning (primary answer). The user gets both. The dictionary is the cheap, fast layer. The LLM is the smart, slower layer. They serve different purposes and are not substitutes for each other.

---

## Competitive Research Findings

Perplexity's Chrome extension opens a sidebar, uses right-click as trigger, and treats every query as a web search. Monica auto-reads pages and offers multi-model access (GPT-5, Claude 4.5, Gemini) in a sidebar. MaxAI is the closest competitor in spirit — it pre-fills prompts with selected text and offers contextual actions. Sider provides an always-visible sidebar panel. Google Dictionary does inline popup definitions but is not AI-powered and not context-aware.

No existing extension combines: inline anchored card (not sidebar), auto intent routing (not user-picks), progressive rendering (generic + contextual), and deep vocabulary mode. These are the four product differentiators.

---

## Decision 15: Guardrails — What to Protect Against and How

**The question:** What can go wrong when a Chrome extension sends user-selected text + page content to an LLM, and renders the LLM's response as HTML in the host page?

**Threats identified and mitigations:**

| Threat | Severity | Mitigation | Residual risk |
|---|---|---|---|
| XSS via LLM output | High | Strip all HTML tags from LLM response before rendering | None — only our own citation links are injected |
| Prompt injection from page content | Medium | Use `innerText` (excludes hidden elements), cap context at 600 chars | Visible text can still contain instructions — mitigated, not eliminated |
| Runaway API calls | Medium | AbortController cancels in-flight fetches when new card opens | None |
| Surprise rate limits | Medium | Usage counter + soft warning at 80% of limits | Counter resets on browser close (known limitation) |
| Gemini safety filter refusal | Low | Detect `SAFETY` finish reason, show graceful message | None |
| API key exposure | Low | chrome.storage.sync is encrypted at rest; keys in transit are standard HTTPS | Inspector-visible, acceptable for personal project |
| Host page CSS breaking card | Low | Shadow DOM (`attachShadow`) provides complete CSS isolation | None — shadow boundary prevents all style leakage |

**Design principles applied:**

We didn't build a custom content moderation layer on top of Gemini's. That would be over-engineering for a personal project and would create false positives. We also didn't build a backend proxy for API keys — that's the right call for a published extension but unnecessary here. Every guardrail was chosen for the simplest effective mitigation at the current project scope.

---

## Decision 16: Self-Review — Issues Found and Fixed Before Implementation

Before sending the spec to engineering, a full review of both documents surfaced 11 issues across three severity levels. After initial implementation testing revealed the `all: initial` CSS approach broke the card layout entirely (resetting `display` to `inline` on all elements), the architecture was upgraded to Shadow DOM — the same isolation method used by Atlassian, Grammarly, and every production Chrome extension.

**Critical fixes:**
- **CSS isolation upgraded from `all: initial` to Shadow DOM.** The `all: initial` approach reset `display` to `inline` on all div elements, causing the card content to bleed into the page with no visible background or borders. Shadow DOM provides complete CSS isolation — host page styles cannot enter the card, and card styles cannot leak out. All card HTML and CSS now live inside `attachShadow({ mode: 'open' })`.
- Settings files (HTML, JS, CSS) and service worker were referenced as "see v2 spec" but v2 no longer existed. Inlined all four files into the final spec so engineering has everything in one document.
- The follow-up input field said "Ask a follow-up..." but actually opened Google search in a new tab. This deceptive UX was replaced with a single centered "Search in Google ↗" link. Follow-up conversations are a V2 feature.
- Gemini model string mismatch between PRD and code was flagged with a verification note.

**Quality fixes:**
- The positioner iterated ALL DOM elements (`querySelectorAll('*')`) — 5,000-15,000 elements on complex pages. Scoped to `body > header, body > nav, body > div, [role="banner"], [role="navigation"]` which covers 99% of sticky headers.
- Cache key used `pathname` only. Added `hostname` to prevent cross-site cache collisions.
- Deep Dive prompt told the LLM "don't repeat the definition" but didn't include the definition. Now passes the Intent 1 answer into the Deep Dive prompt for genuine non-repetition.
- After expansion content renders, auto-scrolls it into view within the card (prevents below-the-fold invisible results).

**Polish fixes:**
- Dictionary API output now sanitized (consistent with LLM output sanitization).
- Service worker auto-opens settings page on first install (onboarding).
- Added icon generation guidance for OpenCode.
- Reframed competitive table row from "Generic + contextual" to "Progressive rendering (instant + AI)" — more accurate and defensible.

**Why this matters for the portfolio:** This review round demonstrates the discipline of reviewing your own work before handing off. Finding 11 issues in your own spec — including a deceptive UX pattern and a performance bottleneck — before engineering touches it is a PM skill that's hard to fake.

---

## Decision 17: Button Consistency, Paragraph Threshold, and Deep Dive for Long Selections

Three connected design questions surfaced during review:

**Question 1: Should buttons change between selections?**

The original design showed different buttons for each classification — vocabulary got two, phrases got one, paragraphs got zero. Later revision made buttons always-present but swapped the primary/secondary order per classification. Both approaches had the same fundamental problem: the card layout or button hierarchy shifted between selections, preventing muscle memory.

**Decision (after two revisions):** Fully consistent. Same two buttons, same labels, same order, same visual style — every time, for every classification. No primary/secondary distinction. Position is the hierarchy: left = Deep dive, right = Look up. The intelligence belongs in the prompt routing, not in the button layout. This is the same principle behind Google not rearranging search result types per query — predictability IS the feature.

```
[📖 Deep dive]    [📰 Look up]    [Search in Google ↗]
 always left        always right     always bottom
```

**Question 2: What defines a paragraph?**

The original threshold was 30 words. But 30 words is ~2 sentences — that's a long phrase, not a paragraph.

**Decision:** Raised to 50 words (~3-4 sentences).

**Question 3: Why shouldn't paragraphs have Look up or Deep dive?**

The original design hid buttons for paragraphs. This was paternalistic — the user should decide if they want to search, not the extension.

**Decision:** All classifications get both buttons. For Look up on long selections, the search query is truncated to the first 10 words. For Deep dive, the prompt routes to an analysis prompt for phrases/paragraphs.

**Prompt routing (invisible to user):**

| Classification | "Deep dive" prompt | "Look up" behavior |
|---|---|---|
| Vocabulary / Entity | Vocab: definition, examples, confusions | Web search, full query |
| Phrase / Paragraph | Analysis: argument, context, implications | Web search, query truncated to 10 words |

---

## Decision 18: Bugs Found During Live Testing

Three issues surfaced during real-world testing on live webpages.

**Bug 1: Markdown rendered as raw text.** Gemini returns `### Definition`, `**bold**`, and `* list items` as raw markdown. The card uses `innerHTML` which doesn't parse markdown — so users saw literal `###` and `**` in the answer. Telling the LLM to stop using markdown is fragile (ignored 10-20% of the time). Instead, added a lightweight `renderMarkdown()` converter that handles headings, bold, list items, and numbered lists. Applied to both the main answer and expansion content.

**Bug 2: Buttons permanently disabled after click.** Both action buttons disabled when either was clicked (to prevent double-clicks during loading) but never re-enabled. The user couldn't click "Look up" after reading a "Deep dive" result. Fix: re-enable both buttons after expansion renders successfully or with an error. The user can now switch between expansion types freely.

**Bug 3: Proper nouns at sentence start misclassified as vocabulary.** "Cummins" at the start of a sentence was classified as vocabulary because `isSentenceStart()` returned true, and the classifier assumed all capitalized words at sentence start are regular English capitalization. Fix: added a `COMMON_SENTENCE_WORDS` set (~130 common English words). If a capitalized word at sentence start is NOT in this set, it's classified as entity. "Cummins", "Tesla", "Anthropic" → not common → entity. "Cricket", "March", "The" → common → vocabulary. This heuristic is imperfect (common words that are also proper nouns like "Jordan" will misclassify) but handles the vast majority of cases.

---

## Decision 19: Search Quality — News vs General, Social Media Exclusion, Recency

**Problem observed:** The "Look up" button returned Wikipedia pages and social media links for entity queries where the user expected recent news. Selecting "Cummins" on a cricket article returned a Twitter thread and a Wikipedia biography instead of recent match reports.

**Root cause:** Tavily was called with default parameters for all classifications — general web search with no topic filter, no recency filter, and no domain exclusions.

**Three fixes applied:**

**Fix 1 — Topic routing by classification.** Tavily's `topic` parameter determines what kind of results it prioritizes. Entity lookups now use `topic: 'news'` which tells Tavily to prioritize journalism sources. All other classifications use `topic: 'general'` which returns explainer articles, Wikipedia, documentation — the right content for understanding a concept.

**Fix 2 — Recency filter for entities.** Entity lookups add `days: 30` to only return content from the last 30 days. This prevents stale results. Non-entity lookups don't have a recency filter because a 2019 Wikipedia article explaining "tokenizer" is perfectly valid.

**Fix 3 — Social media exclusion for all lookups.** `exclude_domains` blocks twitter.com, x.com, reddit.com, facebook.com, instagram.com, tiktok.com, pinterest.com, quora.com, threads.net, and linkedin.com. These are user-generated, often unverified, and never useful for "explain what this means" or "what's the latest news." Applied to all lookups regardless of classification.

**Bonus — Published dates on news sources.** Tavily returns `published_date` for news results. Entity lookup sources now show relative dates ("2 days ago", "1 week ago") next to the source title, so users see freshness at a glance. Non-news results don't have dates and gracefully skip the display.

| Classification | Tavily `topic` | `days` filter | Social media excluded | Dates shown |
|---|---|---|---|---|
| Entity | `news` | 30 | Yes | Yes |
| Vocabulary | `general` | None | Yes | No (not returned) |
| Phrase | `general` | None | Yes | No |
| Paragraph | `general` | None | Yes | No |

---

## Decision 20: Context-Aware Search Queries for Look Up

**Problem observed:** Selecting "2022 Eliminator" on a cricbuzz IPL page and clicking "Look up" returned results about mountain bikes, boats, and fantasy baseball. Tavily received the raw text "2022 Eliminator" with zero page context, so it had no idea this was about cricket.

The irony: Intent 1 already produced a perfect contextual answer about the IPL playoff match. The LLM already understood the context. We just weren't sharing that understanding with the search step.

**Four options evaluated:**

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A — Append title keywords** | Extract nouns from page title, append to query. "2022 Eliminator" → "2022 Eliminator Rajat Patidar stratosphere" | Zero cost, instant | Keyword extraction from titles is noisy — "stratosphere" hurts the query |
| **B — LLM query rewrite (extra call)** | Separate Gemini call before Tavily: "generate a 3-5 word search query for this in context" | Highest quality queries | +1 API call per Look up (~0.5-1s latency, burns quota) |
| **C — Append domain name** | "2022 Eliminator cricbuzz" | Zero cost, instant | Biases results to one site. "medium.com" and "substack.com" are meaningless signals |
| **D — Piggyback on Intent 1** | Add "KEYWORDS:" instruction to the existing Intent 1 prompt. Parse keywords from the same response. Cache them. Use for Look up. | Zero extra cost, zero extra latency, context-aware | LLM sometimes ignores the instruction (~10-15% fallback to raw text) |

**Decision: Option D.**

Reasoning: The Intent 1 LLM call already has full context and already runs before Look up is ever clicked. Asking it to produce 3-5 search keywords is ~10 extra output tokens within the existing 400-token budget. No new API calls. No new latency. The keywords are cached with the Intent 1 result, so re-lookups are instant.

The fallback is clean: if the LLM omits the KEYWORDS line, we use the raw selected text (with truncation for long selections). The feature degrades gracefully, never breaks.

For "2022 Eliminator" on cricbuzz, Intent 1 now returns:
```
The 2022 Eliminator refers to the IPL playoff match where RCB 
defeated LSG...

KEYWORDS: IPL 2022 Eliminator RCB vs LSG playoff
```

The answer renders in the card (KEYWORDS line stripped). The keywords are stored silently. When the user clicks Look up, Tavily searches "IPL 2022 Eliminator RCB vs LSG playoff" instead of raw "2022 Eliminator" — getting cricket results, not mountain bikes.

**Why not Option B:** It's the highest quality but costs an extra API call per Look up. At 1,500 free Gemini calls/day, doubling the call count for every Look up significantly reduces effective daily quota. Option D achieves 85-90% of the quality improvement at zero additional cost.

---

## What I'd Do Differently Next Time

1. I would validate the inline card positioning on 20+ real websites before writing the spec, not after. Z-index and CSS isolation issues are the highest-risk engineering problem.

2. I would prototype the three-tier pipeline latency on real API calls before committing to the architecture. If Gemini Flash latency turns out to be 3-4 seconds instead of 1-2, the progressive rendering argument weakens.

3. I would talk to 5-10 real users about whether they actually look up words while reading, how often, and whether the "new tab" friction is their actual pain point or just my assumption.
