window.ContextLens = window.ContextLens || {};

// ===================== OUTPUT SANITIZER =====================

function sanitizeOutput(text) {
  const stripped = text.replace(/<[^>]*>/g, '');
  const decoded = stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return decoded;
}

// ===================== ABORT CONTROLLER =====================

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

async function incrementUsage(provider) {
  try {
    const key = `usage_${provider}`;
    const result = await chrome.storage.session.get([key]);
    const current = result[key] || { count: 0, resetDate: new Date().toDateString() };

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
    return 0;
  }
}

async function checkUsageWarning(provider) {
  try {
    const key = `usage_${provider}`;
    const result = await chrome.storage.session.get([key]);
    const current = result[key];
    if (!current) return null;

    if (provider === 'gemini' && current.count >= 1200) return 'LLM_USAGE_HIGH';
    if (provider === 'tavily' && current.count >= 800) return 'TAVILY_USAGE_HIGH';
    return null;
  } catch (e) {
    return null;
  }
}

// ===================== SESSION CACHE =====================

const _memoryCache = {};

function cacheKey(selectedText, intent) {
  const url = window.location.host + window.location.pathname;
  return `${url}::${selectedText}::${intent}`;
}

async function getFromCache(selectedText, intent) {
  const key = cacheKey(selectedText, intent);
  if (_memoryCache[key]) {
    window.ContextLens.logEvent('CACHE', { intent, key: key.slice(0, 60), hit: true, source: 'memory' });
    return _memoryCache[key];
  }
  try {
    const result = await chrome.storage.session.get([key]);
    if (result[key]) {
      _memoryCache[key] = result[key];
      window.ContextLens.logEvent('CACHE', { intent, key: key.slice(0, 60), hit: true, source: 'session' });
      return result[key];
    }
  } catch (e) {}
  window.ContextLens.logEvent('CACHE', { intent, key: key.slice(0, 60), hit: false });
  return null;
}

async function setCache(selectedText, intent, value) {
  const key = cacheKey(selectedText, intent);
  _memoryCache[key] = value;
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (e) {}
}

// ===================== FREE DICTIONARY API (Tier 0) =====================

window.ContextLens.fetchDictionaryDefinition = async function (word) {
  try {
    window.ContextLens.logEvent('DICT_REQ', { word });
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!resp.ok) {
      window.ContextLens.logEvent('DICT_RES', { word, found: false, status: resp.status });
      return null;
    }

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      window.ContextLens.logEvent('DICT_RES', { word, found: false, reason: 'empty response' });
      return null;
    }

    const meanings = data[0].meanings || [];
    if (meanings.length === 0) {
      window.ContextLens.logEvent('DICT_RES', { word, found: false, reason: 'no meanings' });
      return null;
    }

    const firstMeaning = meanings[0];
    const partOfSpeech = firstMeaning.partOfSpeech || '';
    const definition = firstMeaning.definitions?.[0]?.definition || '';

    if (!definition) {
      window.ContextLens.logEvent('DICT_RES', { word, found: false, reason: 'no definition text' });
      return null;
    }

    const result = {
      word: data[0].word,
      partOfSpeech,
      definition,
      phonetic: data[0].phonetic || data[0].phonetics?.[0]?.text || ''
    };
    window.ContextLens.logEvent('DICT_RES', { word: result.word, found: true, partOfSpeech, definition: result.definition.slice(0, 80) });
    return result;
  } catch (e) {
    window.ContextLens.logEvent('DICT_RES', { word, found: false, error: e.message });
    return null;
  }
};

// ===================== LLM CONFIG (Model-Agnostic) =====================

async function getLLMConfig() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['llmProvider', 'llmEndpoint', 'llmModel', 'llmKey', 'geminiKey'], (result) => {
      resolve({
        provider: result.llmProvider || 'gemini',
        endpoint: result.llmEndpoint || '',
        model: result.llmModel || 'gemini-2.0-flash',
        key: result.llmKey || result.geminiKey || ''
      });
    });
  });
}

// ===================== LLM API CALL (Model-Agnostic) =====================

async function callLLM(prompt) {
  const config = await getLLMConfig();
  if (!config.key) throw new Error('NO_API_KEY');

  window.ContextLens.logEvent('LLM_REQ', { provider: config.provider, model: config.model, promptLength: prompt.length });
  window.ContextLens.logTimerStart('llm');

  const signal = getAbortSignal();
  let response;

  if (config.provider === 'gemini') {
    const baseEndpoint = config.endpoint || 'https://generativelanguage.googleapis.com/v1beta/models';
    const url = `${baseEndpoint}/${config.model}:generateContent?key=${config.key}`;
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.3 }
      }),
      signal
    });
  } else {
    const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.key}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.3
      }),
      signal
    });
  }

  if (response.status === 429) throw new Error('RATE_LIMIT');
  if (response.status === 400) throw new Error('BAD_REQUEST');
  if (response.status === 401 || response.status === 403) throw new Error('INVALID_KEY');
  if (response.status === 404) throw new Error('MODEL_NOT_FOUND');
  if (!response.ok) throw new Error(`LLM_ERROR_${response.status}`);

  const data = await response.json();
  let raw;

  if (config.provider === 'gemini') {
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    await incrementUsage('gemini');
    if (!raw && data.candidates?.[0]?.finishReason === 'SAFETY') {
      throw new Error('SAFETY_FILTERED');
    }
  } else {
    raw = data.choices?.[0]?.message?.content || '';
    await incrementUsage('gemini');
  }

  const latency = window.ContextLens.logTimerEnd('llm', 'LLM_RES', { responseLength: raw.length });
  return sanitizeOutput(raw);
}

// ===================== TAVILY API (Tier 2) =====================

const EXCLUDED_DOMAINS = [
  'twitter.com', 'x.com', 'reddit.com', 'facebook.com',
  'instagram.com', 'tiktok.com', 'pinterest.com', 'quora.com',
  'threads.net', 'linkedin.com'
];

async function callTavily(query, tavilyKey, classification) {
  const signal = getAbortSignal();
  const isNewsMode = (classification === 'entity');

  const body = {
    query,
    search_depth: 'basic',
    max_results: 5,
    include_answer: false,
    include_raw_content: false,
    exclude_domains: EXCLUDED_DOMAINS
  };

  if (isNewsMode) {
    body.topic = 'news';
    body.days = 30;
  }

  window.ContextLens.logEvent('TAVILY_REQ', { query, topic: body.topic || 'general', days: body.days || null });
  window.ContextLens.logTimerStart('tavily');

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tavilyKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (response.status === 429) throw new Error('TAVILY_RATE_LIMIT');
  if (!response.ok) throw new Error(`TAVILY_ERROR_${response.status}`);

  await incrementUsage('tavily');

  const data = await response.json();
  const results = (data.results || []).slice(0, 5).map((r, i) => ({
    index: i + 1,
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 200) || '',
    publishedDate: r.published_date || null
  }));

  window.ContextLens.logTimerEnd('tavily', 'TAVILY_RES', { resultCount: results.length, titles: results.map(r => r.title), dates: results.map(r => r.publishedDate) });
  return results;
}

// ===================== PROMPT BUILDERS =====================

function buildContextualPrompt(selectedText, pageContext, surroundingContext) {
  return `You are a contextual reading assistant. The user is reading "${pageContext.title}" on ${pageContext.domain}.

They selected: "${selectedText}"

Surrounding text: "${surroundingContext}"

Give a brief, precise explanation of "${selectedText}" specifically in the context of what they are reading. Do NOT give a generic dictionary definition — focus on what it means HERE.

Rules:
- 2-4 sentences maximum
- Plain language, no fluff
- If it's an acronym, spell it out first then explain
- Do NOT start with "In the context of..." — just explain directly
- After your answer, on a new line write KEYWORDS: followed by 3-5 search terms that would find the most relevant web results about this topic in this context. These keywords are used for search — make them specific and contextual.`;
}

function parseKeywordsFromAnswer(rawAnswer) {
  const keywordsMatch = rawAnswer.match(/KEYWORDS:\s*(.+)$/im);
  if (keywordsMatch) {
    const answer = rawAnswer.replace(/\n?KEYWORDS:\s*.+$/im, '').trim();
    const keywords = keywordsMatch[1].trim();
    return { answer, keywords };
  }
  return { answer: rawAnswer.trim(), keywords: null };
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

function buildDeepAnalysisPrompt(selectedText, pageContext, surroundingContext, previousAnswer) {
  const prevContext = previousAnswer
    ? `\nThe user already saw this brief explanation: "${previousAnswer}"\n`
    : '';

  return `You are a reading analysis assistant. The user is reading "${pageContext.title}" on ${pageContext.domain}.

They selected this passage: "${selectedText}"

Surrounding text: "${surroundingContext}"
${prevContext}
Provide a deeper analysis of this passage:

1. ARGUMENT: What claim or point is the author making here? What is the underlying logic?
2. CONTEXT: Why does this matter in the broader article? What came before and what does it set up?
3. IMPLICATIONS: What are the consequences or takeaways of this statement? What should the reader think about?

Rules:
- Section headers: "Argument", "Context", "Implications"
- 2-3 sentences per section max
- Do NOT repeat the brief explanation the user already saw — go deeper
- If the passage is a quote, identify who said it and why it matters`;
}

function truncateForSearch(text) {
  const words = text.split(/\s+/);
  if (words.length <= 12) return text;
  return words.slice(0, 10).join(' ');
}

// ===================== QUERY RUNNERS =====================

async function getTavilyKey() {
  return new Promise(resolve => chrome.storage.sync.get(['tavilyKey'], resolve));
}

// Intent 1: Contextual meaning (always runs on card open)
window.ContextLens.runContextualQuery = async function (selectedText, pageContext, surroundingContext) {
  window.ContextLens.logEvent('INTENT1_START', { selectedText: selectedText.slice(0, 60), domain: pageContext.domain });
  const cached = await getFromCache(selectedText, 'contextual');
  if (cached) {
    window.ContextLens.logEvent('INTENT1_DONE', { source: 'cache', hasKeywords: !!cached.searchKeywords, keywords: cached.searchKeywords });
    return cached;
  }

  const prompt = buildContextualPrompt(selectedText, pageContext, surroundingContext);
  const rawAnswer = await callLLM(prompt);

  const parsed = parseKeywordsFromAnswer(rawAnswer);
  window.ContextLens.logEvent('KEYWORDS', { hasKeywords: !!parsed.keywords, keywords: parsed.keywords });

  const usageWarning = await checkUsageWarning('gemini');
  const result = { answer: parsed.answer, searchKeywords: parsed.keywords, usageWarning };

  await setCache(selectedText, 'contextual', result);
  window.ContextLens.logEvent('INTENT1_DONE', { source: 'api', hasKeywords: !!result.searchKeywords, keywords: result.searchKeywords });
  return result;
};

// Intent 2: News / web lookup (on explicit button click)
window.ContextLens.runNewsQuery = async function (selectedText, pageContext, surroundingContext, classification, searchKeywords) {
  window.ContextLens.logEvent('NEWS_START', { selectedText: selectedText.slice(0, 40), searchKeywords });
  const cached = await getFromCache(selectedText, 'news');
  if (cached) {
    window.ContextLens.logEvent('NEWS_DONE', { source: 'cache', sourceCount: cached.sources?.length });
    return cached;
  }

  const keys = await getTavilyKey();
  if (!keys.tavilyKey) throw new Error('NO_TAVILY_KEY');

  const searchQuery = searchKeywords || truncateForSearch(selectedText);
  const sources = await callTavily(searchQuery, keys.tavilyKey, classification);
  const prompt = buildNewsPrompt(selectedText, pageContext, surroundingContext, sources);
  const answer = await callLLM(prompt);
  const usageWarning = await checkUsageWarning('tavily') || await checkUsageWarning('gemini');
  const result = { answer, sources, usageWarning };

  await setCache(selectedText, 'news', result);
  window.ContextLens.logEvent('NEWS_DONE', { source: 'api', sourceCount: sources.length });
  return result;
};

// Intent 3: Deep dive (on explicit button click)
window.ContextLens.runDeepDiveQuery = async function (selectedText, pageContext, surroundingContext, previousAnswer, classification) {
  window.ContextLens.logEvent('DEEP_START', { classification, selectedText: selectedText.slice(0, 40) });
  const cached = await getFromCache(selectedText, 'deepdive');
  if (cached) {
    window.ContextLens.logEvent('DEEP_DONE', { source: 'cache' });
    return cached;
  }

  const prompt = (classification === 'vocabulary' || classification === 'entity')
    ? buildDeepVocabPrompt(selectedText, pageContext, surroundingContext, previousAnswer)
    : buildDeepAnalysisPrompt(selectedText, pageContext, surroundingContext, previousAnswer);

  const answer = await callLLM(prompt);
  const usageWarning = await checkUsageWarning('gemini');
  const result = { answer, usageWarning };

  await setCache(selectedText, 'deepdive', result);
  window.ContextLens.logEvent('DEEP_DONE', { source: 'api' });
  return result;
};
