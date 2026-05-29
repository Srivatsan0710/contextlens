chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(['blockedDomains'], (result) => {
    if (!result.blockedDomains) {
      chrome.storage.sync.set({ blockedDomains: [] });
    }
  });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'settings/settings.html' });
  }
});
