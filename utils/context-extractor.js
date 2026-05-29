window.ReadIn = window.ReadIn || {};

let _cachedPageContext = null;

window.ReadIn.getPageContext = function () {
  if (_cachedPageContext) return _cachedPageContext;

  _cachedPageContext = {
    title: document.title || '',
    domain: window.location.hostname.replace('www.', '')
  };
  return _cachedPageContext;
};

window.ReadIn.getSurroundingContext = function (selectedText) {
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
