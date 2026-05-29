window.ReadIn = window.ReadIn || {};

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

const COMMON_SENTENCE_WORDS = new Set([
  'a','about','after','all','also','an','and','any','are','as','at','back',
  'be','because','been','before','being','between','both','but','by','came',
  'can','come','could','day','did','do','down','each','end','even','every',
  'few','find','first','for','from','get','give','go','going','good','got',
  'great','had','has','have','he','her','here','him','his','how','however',
  'i','if','in','into','is','it','its','just','know','last','let','life',
  'like','long','look','made','make','many','may','me','might','more','most',
  'much','must','my','never','new','next','no','not','now','of','off','old',
  'on','once','one','only','or','other','our','out','over','own','part',
  'people','place','point','same','say','she','should','show','since','so',
  'some','something','still','such','take','tell','than','that','the','their',
  'them','then','there','these','they','thing','think','this','those','three',
  'through','time','to','too','turn','two','under','up','upon','us','use',
  'very','want','was','way','we','well','went','were','what','when','where',
  'which','while','who','why','will','with','without','work','world','would',
  'year','yet','you','your'
]);

window.ReadIn.classify = function (selectedText) {
  const text = selectedText.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const lowerText = text.toLowerCase();
  const CL = window.ReadIn;

  if (/^https?:\/\//.test(text) || /^[^\s@]+@[^\s@]+$/.test(text)) {
    CL.logEvent('CLASSIFY', { text, classification: 'skip', reason: 'url or email' });
    return 'skip';
  }
  if (/^\$?[\d,.]+%?$/.test(text)) {
    CL.logEvent('CLASSIFY', { text, classification: 'skip', reason: 'number only' });
    return 'skip';
  }
  if (wordCount >= 50) {
    CL.logEvent('CLASSIFY', { text, classification: 'paragraph', reason: 'wordCount >= 50', wordCount });
    return 'paragraph';
  }

  if (wordCount === 1) {
    if (/^[A-Z]{2,6}$/.test(text)) {
      const classification = ENTITY_ACRONYMS.includes(text) ? 'entity' : 'vocabulary';
      CL.logEvent('CLASSIFY', { text, classification, reason: `acronym-${classification}` });
      return classification;
    }
    if (/^[A-Z][a-z]/.test(text)) {
      if (!isSentenceStart(text)) {
        CL.logEvent('CLASSIFY', { text, classification: 'entity', reason: 'capitalized, not sentence start' });
        return 'entity';
      }
      if (!COMMON_SENTENCE_WORDS.has(text.toLowerCase())) {
        CL.logEvent('CLASSIFY', { text, classification: 'entity', reason: 'capitalized, not common word' });
        return 'entity';
      }
    }
    CL.logEvent('CLASSIFY', { text, classification: 'vocabulary', reason: 'single word default' });
    return 'vocabulary';
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const parent = selection.getRangeAt(0).commonAncestorContainer;
    const codeParent = (parent.nodeType === Node.TEXT_NODE ? parent.parentElement : parent)
      ?.closest('code, pre');
    if (codeParent) {
      CL.logEvent('CLASSIFY', { text, classification: 'vocabulary', reason: 'in code block' });
      return 'vocabulary';
    }
  }

  const words = text.split(/\s+/);
  const everyWordCapped = words.every(w => /^[A-Z]/.test(w));
  if (everyWordCapped && wordCount <= 6 && (wordCount > 1 || !isSentenceStart(text))) {
    CL.logEvent('CLASSIFY', { text, classification: 'entity', reason: `every word capped${wordCount === 1 ? ', not sentence start' : ''}` });
    return 'entity';
  }

  const hasEntitySignal = ENTITY_SIGNAL_WORDS.some(word => lowerText.includes(word));
  if (hasEntitySignal && wordCount <= 10) {
    CL.logEvent('CLASSIFY', { text, classification: 'entity', reason: 'entity signal word', signalWords: ENTITY_SIGNAL_WORDS.filter(w => lowerText.includes(w)) });
    return 'entity';
  }
  if (wordCount <= 4 && /^[a-z]/.test(text)) {
    CL.logEvent('CLASSIFY', { text, classification: 'vocabulary', reason: 'short lowercase' });
    return 'vocabulary';
  }

  CL.logEvent('CLASSIFY', { text, classification: 'phrase', reason: 'default' });
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
