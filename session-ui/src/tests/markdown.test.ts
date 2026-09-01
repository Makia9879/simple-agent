import { describe, expect, it } from 'vitest';
import { safeMarkdown } from '$lib/markdown';

describe('safeMarkdown', () => {
 it('escapes script payloads rather than rendering executable markup', () => {
  const html = safeMarkdown('<script>globalThis.pwned=true</script><img src=x onerror=alert(1)>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
 });
 it('retains safe code and emphasis as inert markup', () => {
  expect(safeMarkdown('**safe** `code`')).toContain('<strong>safe</strong>');
  expect(safeMarkdown('```<b>x</b>```')).toContain('&lt;b&gt;x&lt;/b&gt;');
 });
});
