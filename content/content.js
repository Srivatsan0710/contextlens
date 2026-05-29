(async function () {
  const CL = window.ReadIn;
  if (CL.isBlockedPage()) return;
  if (await CL.isUserBlockedDomain()) return;

  let triggerIcon = null;
  let card = null;
  let currentSelectedText = '';
  let savedSelectionRange = null;
  let currentPageContext = null;
  let currentSurroundingContext = '';

  function createTriggerIcon() {
    const icon = document.createElement('div');
    icon.id = 'readin-trigger';
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="#4F46E5"/>
      <path d="M5.5 8.5C5.5 8.5 6.5 10 8 10C9.5 10 10.5 8.5 10.5 8.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="6" cy="6.5" r="0.8" fill="white"/><circle cx="10" cy="6.5" r="0.8" fill="white"/>
    </svg>`;
    icon.title = 'Look up with ReadIn';
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

  function openCard(selectedText) {
    removeCard();
    CL.abortPending();

    const rect = savedSelectionRange.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const classification = CL.classify(selectedText);
    if (classification === 'skip') return;

    CL.logEvent('OPEN', { text: selectedText.slice(0, 60), classification, wordCount: selectedText.split(/\s+/).filter(Boolean).length });
    card = CL.createCard(classification);
    card.dataset.selectedText = selectedText;
    document.body.appendChild(card);

    const pos = CL.calculatePosition(rect);
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
    requestAnimationFrame(() => card.classList.add('visible'));

    card._shadow.querySelector('.cl-new-tab').href =
      `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;

    card._shadow.querySelector('.cl-close').addEventListener('click', removeCard);

    card._shadow.querySelectorAll('.cl-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleActionClick(btn.dataset.intent));
    });

    currentPageContext = CL.getPageContext();
    currentSurroundingContext = CL.getSurroundingContext(selectedText);

    if (classification === 'vocabulary' && selectedText.split(/\s+/).length === 1) {
      CL.fetchDictionaryDefinition(selectedText).then(dictResult => {
        if (card) CL.showGenericDefinition(card, dictResult);
      });
    }

    runContextualAnswer(selectedText);
  }

  async function runContextualAnswer(selectedText) {
    try {
      const result = await CL.runContextualQuery(selectedText, currentPageContext, currentSurroundingContext);
      if (card) {
        const hasKw = !!result.searchKeywords;
        CL.logEvent('INTENT1_OK', { hasKeywords: hasKw, keywords: result.searchKeywords });
        CL.showAnswer(card, result.answer, result.searchKeywords);
        if (result.usageWarning) CL.showUsageWarning(card, result.usageWarning);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      const code = err.message.includes('RATE_LIMIT') ? 'RATE_LIMIT'
        : err.message.includes('NO_API_KEY') ? 'NO_API_KEY'
        : err.message.includes('INVALID_KEY') ? 'INVALID_KEY'
        : err.message.includes('MODEL_NOT_FOUND') ? 'MODEL_NOT_FOUND'
        : err.message.includes('BAD_REQUEST') ? 'BAD_REQUEST'
        : err.message.includes('SAFETY_FILTERED') ? 'SAFETY_FILTERED'
        : 'DEFAULT';
      if (card) { CL.logEvent('ERROR', { code, phase: 'intent1', message: err.message }); CL.showError(card, code); }
    }
  }

  async function handleActionClick(intent) {
    if (!card) return;
    CL.logEvent('ACTION', { intent });
    card._shadow.querySelectorAll('.cl-action-btn').forEach(b => b.disabled = true);
    CL.showExpansionLoading(card);
    const selectedText = card.dataset.selectedText;
    const classification = card.dataset.classification;

    try {
      if (intent === 'news') {
        const searchKeywords = card.dataset.searchKeywords || '';
        const result = await CL.runNewsQuery(selectedText, currentPageContext, currentSurroundingContext, classification, searchKeywords);
        CL.showExpansionAnswer(card, result.answer, result.sources);
      } else if (intent === 'deepdive') {
        const previousAnswer = card.dataset.intent1Answer || '';
        const result = await CL.runDeepDiveQuery(selectedText, currentPageContext, currentSurroundingContext, previousAnswer, classification);
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
    if (e.target.closest('#readin-card') || e.target.closest('#readin-trigger')) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2) { hideTriggerIcon(); return; }
    if (card && card.dataset.selectedText === text) return;
    currentSelectedText = text;
    savedSelectionRange = sel.getRangeAt(0).cloneRange();
    CL.logEvent('SELECT', { text: text.slice(0, 80), wordCount: text.split(/\s+/).filter(Boolean).length });
    showTriggerIcon(savedSelectionRange.getBoundingClientRect());
    removeCard();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#readin-trigger')) {
      e.preventDefault(); e.stopPropagation();
      if (!currentSelectedText || !savedSelectionRange) return;
      hideTriggerIcon();
      openCard(currentSelectedText);
      return;
    }
    if (card && !e.target.closest('#readin-card')) { removeCard(); hideTriggerIcon(); }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { removeCard(); hideTriggerIcon(); } });
})();
