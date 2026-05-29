const DEFAULT_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/chat/completions'
};

const DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini'
};

const KEY_HINTS = {
  gemini: 'Get a free key at aistudio.google.com — no credit card required.',
  openai: 'Paste your OpenAI API key or any OpenAI-compatible provider key.'
};

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['llmProvider', 'llmEndpoint', 'llmModel', 'llmKey', 'tavilyKey', 'blockedDomains', 'geminiKey'], (result) => {
    const provider = result.llmProvider || 'gemini';
    document.getElementById('llmProvider').value = provider;

    const endpoint = result.llmEndpoint || DEFAULT_ENDPOINTS[provider];
    document.getElementById('llmEndpoint').value = endpoint;

    const model = result.llmModel || result.llmKey
      ? (result.llmModel || DEFAULT_MODELS[provider])
      : '';
    document.getElementById('llmModel').value = model;

    const key = result.llmKey || result.geminiKey || '';
    document.getElementById('llmKey').value = key;

    if (result.tavilyKey) document.getElementById('tavilyKey').value = result.tavilyKey;
    renderBlockedDomains(result.blockedDomains || []);

    updateHint(provider);
  });

  document.getElementById('llmProvider').addEventListener('change', (e) => {
    const provider = e.target.value;
    const endpointEl = document.getElementById('llmEndpoint');
    const modelEl = document.getElementById('llmModel');

    if (!endpointEl.dataset.userModified) {
      endpointEl.value = DEFAULT_ENDPOINTS[provider];
    }
    if (!modelEl.dataset.userModified) {
      modelEl.value = DEFAULT_MODELS[provider];
    }

    updateHint(provider);
    updateModelExample(provider);
  });

  document.getElementById('llmEndpoint').addEventListener('input', (e) => {
    e.target.dataset.userModified = 'true';
  });

  document.getElementById('llmModel').addEventListener('input', (e) => {
    e.target.dataset.userModified = 'true';
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
    const llmProvider = document.getElementById('llmProvider').value;
    const llmEndpoint = document.getElementById('llmEndpoint').value.trim();
    const llmModel = document.getElementById('llmModel').value.trim();
    const llmKey = document.getElementById('llmKey').value.trim();
    const tavilyKey = document.getElementById('tavilyKey').value.trim();

    chrome.storage.sync.set({
      llmProvider, llmEndpoint, llmModel, llmKey, tavilyKey
    }, () => {
      const status = document.getElementById('saveStatus');
      status.textContent = 'Saved ✓';
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 2000);
    });
  });

  updateModelExample(document.getElementById('llmProvider').value);
});

function updateHint(provider) {
  const el = document.getElementById('apiKeyHint');
  if (provider === 'gemini') {
    el.innerHTML = 'Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com</a> — no credit card required.';
  } else {
    el.innerHTML = 'Paste your OpenAI API key or any OpenAI-compatible provider key.';
  }
}

function updateModelExample(provider) {
  const el = document.getElementById('modelExample');
  el.textContent = DEFAULT_MODELS[provider];
}

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
