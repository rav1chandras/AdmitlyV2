import sanitizeHtml from 'sanitize-html';

const HIGHLIGHT_COLORS = [
  /^#fef9c3$/i,
  /^#dcfce7$/i,
  /^#fce7f3$/i,
  /^transparent$/i,
  /^rgb\(\s*254\s*,\s*249\s*,\s*195\s*\)$/i,
  /^rgb\(\s*220\s*,\s*252\s*,\s*231\s*\)$/i,
  /^rgb\(\s*252\s*,\s*231\s*,\s*243\s*\)$/i,
  /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i,
];

function coerceInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  return String(input);
}

export function sanitizeRichEssayHtml(input: unknown): string {
  return sanitizeHtml(coerceInput(input), {
    allowedTags: ['b', 'strong', 'i', 'em', 's', 'strike', 'u', 'br', 'p', 'div', 'span'],
    allowedAttributes: {
      span: ['style'],
    },
    allowedStyles: {
      span: {
        'background-color': HIGHLIGHT_COLORS,
      },
    },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    parser: {
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  }).trim();
}

export function stripHtmlToText(input: unknown): string {
  const readableHtml = sanitizeHtml(coerceInput(input), {
    allowedTags: ['br', 'p', 'div'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  });

  return readableHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<(p|div)\b[^>]*>/gi, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizePlainUserText(input: unknown, maxLength = Number.MAX_SAFE_INTEGER): string {
  const text = stripHtmlToText(input);
  const limit = Math.max(0, maxLength);
  return text.slice(0, limit);
}

export function wordCountFromHtml(input: unknown): number {
  return stripHtmlToText(input).split(/\s+/).filter(Boolean).length;
}
