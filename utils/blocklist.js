const BLOCKED_URL_PATTERNS = [
  'login', 'signin', 'sign-in', 'sign_in', 'account', 'accounts',
  'bank', 'banking', 'checkout', 'payment', 'pay', 'password', 'passwd',
  'wallet', 'secure', 'auth', 'oauth', 'verify', 'verification'
];

window.ReadIn = window.ReadIn || {};

window.ReadIn.isBlockedPage = function () {
  const url = window.location.href.toLowerCase();
  if (BLOCKED_URL_PATTERNS.some(p => url.includes(p))) return true;
  if (document.querySelector('input[type="password"]')) return true;
  return false;
};

window.ReadIn.isUserBlockedDomain = async function () {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['blockedDomains'], (result) => {
      resolve((result.blockedDomains || []).includes(window.location.hostname));
    });
  });
};
