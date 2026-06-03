import { describe, expect, it } from 'vitest';
import { sanitizePlainUserText, sanitizeRichEssayHtml, stripHtmlToText } from '../lib/sanitize';

describe('sanitizeRichEssayHtml', () => {
  it('removes script tags and script content', () => {
    const result = sanitizeRichEssayHtml('<p>Hello</p><script>alert("xss")</script><p>World</p>');

    expect(result).toContain('<p>Hello</p>');
    expect(result).toContain('<p>World</p>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('removes onerror, onload, and onclick attributes', () => {
    const result = sanitizeRichEssayHtml('<p onclick="steal()">Hi <span onload="x()">there</span><b onerror="x()">friend</b></p>');

    expect(result).toContain('<span>there</span>');
    expect(result).toContain('<b>friend</b>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onload');
    expect(result).not.toContain('onerror');
  });

  it('removes javascript URLs by removing unsupported link tags', () => {
    const result = sanitizeRichEssayHtml('<a href="javascript:alert(1)">click me</a>');

    expect(result).toBe('click me');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<a');
  });

  it('removes iframe, img, svg, object, and embed tags', () => {
    const result = sanitizeRichEssayHtml(`
      <iframe src="https://evil.test"></iframe>
      <img src=x onerror=alert(1)>
      <svg><circle onload="x()"></circle></svg>
      <object data="x"></object>
      <embed src="x">
      <p>Safe</p>
    `);

    expect(result).toContain('<p>Safe</p>');
    expect(result).not.toMatch(/iframe|img|svg|object|embed|circle/i);
  });

  it('preserves basic essay formatting tags', () => {
    const result = sanitizeRichEssayHtml('<p><strong>Bold</strong> <em>soft</em> <s>cut</s><br /></p>');

    expect(result).toContain('<strong>Bold</strong>');
    expect(result).toContain('<em>soft</em>');
    expect(result).toContain('<s>cut</s>');
    expect(result).toMatch(/<br\s*\/?>/);
  });

  it('preserves allowed highlight spans', () => {
    const result = sanitizeRichEssayHtml('<span style="background-color:#fef9c3">highlight</span>');

    expect(result).toContain('<span');
    expect(result).toContain('background-color:#fef9c3');
    expect(result).toContain('highlight');
  });

  it('removes disallowed CSS properties from highlight spans', () => {
    const result = sanitizeRichEssayHtml('<span style="background-color:#fef9c3;position:absolute;color:red">highlight</span>');

    expect(result).toContain('background-color:#fef9c3');
    expect(result).not.toContain('position');
    expect(result).not.toContain('color:red');
  });

  it('sanitizes hostile legacy essay HTML before returning it to an editor', () => {
    const legacy = '<div onclick="x()">Essay <img src=x onerror="x()"><span style="background-color:#dcfce7;filter:url(javascript:x)">kept</span><script>bad()</script></div>';
    const result = sanitizeRichEssayHtml(legacy);

    expect(result).toContain('<div>Essay');
    expect(result).toContain('background-color:#dcfce7');
    expect(result).toContain('kept');
    expect(result).not.toMatch(/onclick|img|onerror|script|bad|filter|javascript/i);
  });
});

describe('plain text sanitizers', () => {
  it('sanitizePlainUserText strips tags and keeps readable text', () => {
    const result = sanitizePlainUserText('<p>Hello <strong>reader</strong></p><div>Next line</div><script>bad()</script>');

    expect(result).toContain('Hello reader');
    expect(result).toContain('Next line');
    expect(result).not.toContain('<');
    expect(result).not.toContain('bad');
  });

  it('stripHtmlToText returns text suitable for word counts', () => {
    const result = stripHtmlToText('<div>One two</div><p>three<br>four</p>');

    expect(result).toBe('One two\nthree\nfour');
    expect(result.split(/\s+/).filter(Boolean)).toHaveLength(4);
  });
});
