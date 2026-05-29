window.ReadIn = window.ReadIn || {};

// Lightweight markdown → HTML for LLM responses
// Handles: ### headings, **bold**, * list items, numbered lists
function renderMarkdown(text) {
  return text
    // ### Heading → bold section label
    .replace(/^###\s*(.+)$/gm, '<strong style="display:block;margin-top:10px;margin-bottom:4px;font-size:13px;color:#1F2937;">$1</strong>')
    // **bold** → <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // * list item → bullet (must come after ** handling)
    .replace(/^\*\s+(.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0;"><span style="color:#9CA3AF;">•</span><span>$1</span></div>')
    // Numbered list: 1. item → styled
    .replace(/^\d+\.\s+(.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0;"><span style="color:#9CA3AF;">•</span><span>$1</span></div>')
    // Double newline → paragraph break
    .replace(/\n\n/g, '<br><br>')
    // Single newline → line break
    .replace(/\n/g, '<br>');
}

function formatTimeAgo(dateString) {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 14) return '1 week ago';
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 60) return '1 month ago';
    return `${Math.floor(diffDays / 30)} months ago`;
  } catch (e) {
    return '';
  }
}

const CARD_STYLES = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  :host {
    all: initial;
    position: absolute;
    z-index: 2147483645;
    width: 380px;
    max-height: 520px;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    pointer-events: none;
  }

  :host(.visible) {
    opacity: 1;
    transform: translateY(0);
    pointer-events: all;
  }

  .cl-card-inner {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border: 1px solid #E0E0E0;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
    overflow: hidden;
    max-height: 520px;
    overflow-y: auto;
  }
  .cl-card-inner::-webkit-scrollbar { width: 4px; }
  .cl-card-inner::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 4px; }

  .cl-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #F0F0F0;
    background: #FAFAFA;
  }
  .cl-category-label {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    color: #ffffff;
    background: #4F46E5;
    border-radius: 4px;
    padding: 2px 8px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .cl-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: #9CA3AF;
    border-radius: 4px;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .cl-close:hover { background: #F3F4F6; color: #374151; }

  .cl-body {
    display: block;
    padding: 14px 16px 10px 16px;
    min-height: 60px;
  }
  .cl-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #6B7280;
    font-size: 13px;
  }
  .cl-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid #E5E7EB;
    border-top-color: #4F46E5;
    border-radius: 50%;
    animation: cl-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes cl-spin { to { transform: rotate(360deg); } }

  .cl-answer {
    display: block;
    font-size: 14px;
    line-height: 1.65;
    color: #1F2937;
  }
  .cl-generic-def {
    display: block;
    font-size: 12px;
    line-height: 1.5;
    color: #9CA3AF;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed #E5E7EB;
    font-style: italic;
  }
  .cl-error {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #6B7280;
    padding: 10px 12px;
    background: #F9FAFB;
    border-radius: 8px;
    border: 1px solid #F3F4F6;
  }
  .cl-error-icon { font-size: 15px; color: #F59E0B; flex-shrink: 0; }

  .cl-actions-row {
    display: flex;
    gap: 8px;
    padding: 8px 16px 12px 16px;
    flex-wrap: wrap;
    background: #ffffff;
    position: relative;
    z-index: 1;
  }
  .cl-action-btn {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    border-radius: 8px;
    padding: 6px 14px;
    transition: all 0.12s ease;
    white-space: nowrap;
    background: #F9FAFB;
    color: #374151;
    border: 1px solid #E5E7EB;
  }
  .cl-action-btn:hover { background: #F3F4F6; border-color: #D1D5DB; }
  .cl-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .cl-usage-warning {
    display: block;
    font-size: 11px;
    color: #92400E;
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-radius: 6px;
    padding: 4px 14px;
    margin: 0 16px 6px 16px;
  }

  .cl-expansion {
    display: block;
    padding: 0 16px 12px 16px;
    border-top: 1px solid #F0F0F0;
    margin-top: 0;
    padding-top: 12px;
    background: #ffffff;
    position: relative;
    z-index: 1;
  }
  .cl-expansion-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #6B7280;
    font-size: 13px;
    padding-bottom: 8px;
  }
  .cl-expansion-answer {
    display: block;
    font-size: 13px;
    line-height: 1.65;
    color: #374151;
  }
  .cl-expansion-error {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #6B7280;
    padding: 6px 8px;
    background: #FEF3C7;
    border-radius: 6px;
    border: 1px solid #FDE68A;
  }
  .cl-citation {
    display: inline;
    color: #4F46E5;
    text-decoration: none;
    font-weight: 600;
    font-size: 11px;
    vertical-align: super;
    line-height: 0;
  }
  .cl-citation:hover { text-decoration: underline; }

  .cl-expansion-sources {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid #F0F0F0;
    padding-top: 10px;
    margin-top: 10px;
  }
  .cl-sources-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    color: #9CA3AF;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .cl-source-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    cursor: pointer;
    text-decoration: none;
    padding: 4px 6px;
    border-radius: 6px;
    transition: background 0.1s ease;
  }
  .cl-source-item:hover { background: #F9FAFB; }
  .cl-source-num {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    color: #4F46E5;
    background: #EEF2FF;
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .cl-source-title {
    display: -webkit-box;
    font-size: 12px;
    color: #374151;
    line-height: 1.4;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cl-source-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cl-source-date {
    display: block;
    font-size: 10px;
    color: #9CA3AF;
  }

  .cl-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
    border-top: 1px solid #F0F0F0;
    background: #ffffff;
    position: relative;
    z-index: 1;
  }
  .cl-new-tab {
    display: inline-block;
    font-family: inherit;
    font-size: 12px;
    color: #6B7280;
    text-decoration: none;
    cursor: pointer;
    transition: color 0.12s ease;
  }
  .cl-new-tab:hover { color: #4F46E5; }

  .hidden { display: none !important; }
`;

window.ReadIn.createCard = function (classification) {
  const card = document.createElement('div');
  card.id = 'readin-card';
  card.dataset.classification = classification;

  const shadow = card.attachShadow({ mode: 'open' });
  card._shadow = shadow;

  let actionButtonsHTML = `
      <button class="cl-action-btn" data-intent="deepdive">Deep dive</button>
      <button class="cl-action-btn" data-intent="news">Look up</button>`;

  shadow.innerHTML = `
    <style>${CARD_STYLES}</style>
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

window.ReadIn.showGenericDefinition = function (card, dictResult) {
  if (!dictResult) return;
  const el = card._shadow.querySelector('.cl-generic-def');
  const pos = dictResult.partOfSpeech ? `(${dictResult.partOfSpeech}) ` : '';
  const phonetic = dictResult.phonetic ? `${dictResult.phonetic} · ` : '';
  const safeDef = dictResult.definition.replace(/<[^>]*>/g, '');
  el.textContent = `${phonetic}${pos}${safeDef}`;
  el.classList.remove('hidden');
};

window.ReadIn.showAnswer = function (card, answer, searchKeywords) {
  card._shadow.querySelector('.cl-loading').classList.add('hidden');
  card._shadow.querySelector('.cl-answer').innerHTML = renderMarkdown(answer);
  card._shadow.querySelector('.cl-answer').classList.remove('hidden');
  card._shadow.querySelector('.cl-actions-row').classList.remove('hidden');
  card.dataset.intent1Answer = answer;
  card.dataset.searchKeywords = searchKeywords || '';
  window.ReadIn.logEvent('RENDER', { type: 'intent1', hasKeywords: !!searchKeywords, classification: card.dataset.classification });
};

window.ReadIn.showExpansionLoading = function (card) {
  const exp = card._shadow.querySelector('.cl-expansion');
  exp.classList.remove('hidden');
  exp.querySelector('.cl-expansion-loading').classList.remove('hidden');
  exp.querySelector('.cl-expansion-answer').classList.add('hidden');
  exp.querySelector('.cl-expansion-sources').classList.add('hidden');
  exp.querySelector('.cl-expansion-error').classList.add('hidden');
};

window.ReadIn.showExpansionAnswer = function (card, answer, sources) {
  const exp = card._shadow.querySelector('.cl-expansion');
  exp.querySelector('.cl-expansion-loading').classList.add('hidden');

  let html = answer;
  if (sources && sources.length > 0) {
    html = answer.replace(/\[(\d+)\]/g, (m, num) => {
      const s = sources.find(x => x.index === parseInt(num));
      return s ? `<a href="${s.url}" target="_blank" rel="noopener" class="cl-citation">[${num}]</a>` : m;
    });
  }

  exp.querySelector('.cl-expansion-answer').innerHTML = renderMarkdown(html);
  exp.querySelector('.cl-expansion-answer').classList.remove('hidden');

  if (sources && sources.length > 0) {
    const el = exp.querySelector('.cl-expansion-sources');
    el.innerHTML = '<div class="cl-sources-label">Sources</div>' +
      sources.map(s => {
        const dateStr = s.publishedDate ? formatTimeAgo(s.publishedDate) : '';
        const dateHTML = dateStr ? `<span class="cl-source-date">${dateStr}</span>` : '';
        return `
        <a class="cl-source-item" href="${s.url}" target="_blank" rel="noopener">
          <span class="cl-source-num">${s.index}</span>
          <span class="cl-source-meta">
            <span class="cl-source-title">${s.title}</span>
            ${dateHTML}
          </span>
        </a>`;
      }).join('');
    el.classList.remove('hidden');
  }

  exp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const buttons = card._shadow.querySelectorAll('.cl-action-btn');
  buttons.forEach(b => b.disabled = false);
  window.ReadIn.logEvent('RENDER', { type: 'expansion', hasSources: !!sources?.length, sourceCount: sources?.length || 0 });
};

window.ReadIn.showError = function (card, errorCode) {
  card._shadow.querySelector('.cl-loading').classList.add('hidden');
  card._shadow.querySelector('.cl-answer').classList.add('hidden');
  const msgs = {
    'RATE_LIMIT': 'Daily limit reached — resets in a few hours.',
    'NO_API_KEY': 'Add your API key in ReadIn settings.',
    'INVALID_KEY': 'Invalid API key. Check your key in settings.',
    'MODEL_NOT_FOUND': 'Model not found. Check your model name in settings.',
    'BAD_REQUEST': 'API request failed. Check your endpoint and model in settings.',
    'SAFETY_FILTERED': 'Couldn\'t generate an answer for this selection.',
    'NETWORK': 'Could not connect. Check your internet.',
    'DEFAULT': 'Something went wrong. Try again.'
  };
  const el = card._shadow.querySelector('.cl-error');
  el.innerHTML = `<span class="cl-error-icon">⚠</span><span>${msgs[errorCode] || msgs['DEFAULT']}</span>`;
  el.classList.remove('hidden');
  window.ReadIn.logEvent('RENDER', { type: 'error', errorCode, phase: 'intent1' });
};

window.ReadIn.showUsageWarning = function (card, warningCode) {
  const msgs = {
    'LLM_USAGE_HIGH': 'You\'ve used most of your daily lookups.',
    'TAVILY_USAGE_HIGH': 'You\'ve used most of your monthly web searches.'
  };
  if (!msgs[warningCode]) return;
  const row = card._shadow.querySelector('.cl-actions-row');
  if (!row) return;
  const warning = document.createElement('div');
  warning.className = 'cl-usage-warning';
  warning.textContent = msgs[warningCode];
  row.parentNode.insertBefore(warning, row.nextSibling);
};

window.ReadIn.showExpansionError = function (card, errorCode) {
  const exp = card._shadow.querySelector('.cl-expansion');
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

  const buttons = card._shadow.querySelectorAll('.cl-action-btn');
  buttons.forEach(b => b.disabled = false);
  window.ReadIn.logEvent('RENDER', { type: 'expansion_error', errorCode });
};
