// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  extractWikilinks,
  extractTags,
  countWords,
  toggleTask,
  ensureMarkdown,
  looksLikeHtml,
} from './markdown';

describe('renderMarkdown', () => {
  it('strips dangerous HTML (XSS)', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world', new Set());
    expect(html).not.toContain('<script>');
    expect(html).toContain('Hello');
  });

  it('renders a known wikilink without the missing marker', () => {
    const html = renderMarkdown('See [[Recipes]]', new Set(['recipes']));
    expect(html).toContain('data-wikilink="Recipes"');
    expect(html).not.toContain('wikilink-missing');
  });

  it('marks an unknown wikilink as missing', () => {
    const html = renderMarkdown('See [[Ghost]]', new Set());
    expect(html).toContain('wikilink-missing');
  });

  it('renders tags as clickable chips', () => {
    const html = renderMarkdown('a #chores b', new Set());
    expect(html).toContain('data-tag="chores"');
  });

  it('numbers task checkboxes for interaction', () => {
    const html = renderMarkdown('- [ ] one\n- [x] two', new Set());
    expect(html).toContain('data-task-index="0"');
    expect(html).toContain('data-task-index="1"');
  });
});
describe('markdown helpers', () => {
  it('extracts wikilinks and tags', () => {
    expect(extractWikilinks('[[A]] and [[B|label]]')).toEqual(['A', 'B']);
    expect(extractTags('#one #Two/sub')).toEqual(['one', 'two/sub']);
  });

  it('counts words ignoring markdown punctuation', () => {
    expect(countWords('# Title\n**bold** word')).toBe(3);
  });

  it('toggles the nth task', () => {
    expect(toggleTask('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
  });

  it('detects and converts legacy Quill HTML', () => {
    expect(looksLikeHtml('<p>hi</p>')).toBe(true);
    expect(ensureMarkdown('<p>hi</p>').converted).toBe(true);
    expect(ensureMarkdown('plain text').converted).toBe(false);
  });
});
