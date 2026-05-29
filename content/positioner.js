window.ReadIn = window.ReadIn || {};

window.ReadIn.calculatePosition = function (selectionRect) {
  const CARD_WIDTH = 380;
  const CARD_ESTIMATED_HEIGHT = 300;
  const OFFSET = 12;
  const VIEWPORT_PADDING = 16;
  const vw = window.innerWidth, vh = window.innerHeight;

  let stickyHeaderHeight = 0;
  const candidates = document.querySelectorAll('body > header, body > nav, body > div, [role="banner"], [role="navigation"]');
  for (const el of candidates) {
    const s = window.getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().top < 10) {
      const r = el.getBoundingClientRect();
      if (r.height < 200) stickyHeaderHeight = Math.max(stickyHeaderHeight, r.bottom);
    }
  }

  let top = selectionRect.bottom + OFFSET;
  let left = selectionRect.left;

  if ((selectionRect.bottom + OFFSET + CARD_ESTIMATED_HEIGHT) > vh)
    top = selectionRect.top - CARD_ESTIMATED_HEIGHT - OFFSET;
  if (top < stickyHeaderHeight + VIEWPORT_PADDING)
    top = stickyHeaderHeight + VIEWPORT_PADDING;
  if (left + CARD_WIDTH > vw - VIEWPORT_PADDING)
    left = vw - CARD_WIDTH - VIEWPORT_PADDING;
  if (left < VIEWPORT_PADDING)
    left = VIEWPORT_PADDING;

  return { top, left };
};
