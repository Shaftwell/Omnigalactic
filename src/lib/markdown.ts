import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({ gfm: true, breaks: true });

const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g;
const TAG_RE = /(^|[\s(])#([A-Za-z][\w/-]*)/g;
const TASK_RE = /(^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[)( |x|X)(\])/gm;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function extractWikilinks(md: string): string[] {
  const out: string[] = [];
  for (const m of (md || '').matchAll(WIKILINK_RE)) out.push(m[1].trim());
  return out;
}

export function extractTags(md: string): string[] {
  const out = new Set<string>();
  for (const m of (md || '').matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

export function countWords(md: string): number {
  const plain = (md || '')
    .replace(WIKILINK_RE, (_, t, label) => label || t)
    .replace(/[#*_>`~[\]()|-]/g, ' ');
  return plain.split(/\s+/).filter(Boolean).length;
}

/** Quill stored notes as HTML; detect those so they can be converted once. */
export function looksLikeHtml(content: string): boolean {
  const c = content || '';
  return /^\s*</.test(c) && /<\/?(p|div|h\d|ul|ol|li|br|strong|em|b|i|u|s|blockquote|span|a)\b/i.test(c);
}

/** Best-effort conversion of legacy Quill HTML into markdown. */
export function htmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node: Node, listDepth = 0, ordered = false, index = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const children = (ld = listDepth, ord = ordered) =>
      Array.from(el.childNodes).map((c, i) => walk(c, ld, ord, i)).join('');

    switch (el.tagName) {
      case 'H1': return `# ${children()}\n\n`;
      case 'H2': return `## ${children()}\n\n`;
      case 'H3': case 'H4': case 'H5': case 'H6': return `### ${children()}\n\n`;
      case 'P': case 'DIV': {
        const inner = children();
        return inner.trim() ? `${inner}\n\n` : '';
      }
      case 'BR': return '\n';
      case 'STRONG': case 'B': return `**${children()}**`;
      case 'EM': case 'I': return `*${children()}*`;
      case 'S': case 'STRIKE': case 'DEL': return `~~${children()}~~`;
      case 'U': return children();
      case 'CODE': return el.closest('pre') ? children() : `\`${children()}\``;
      case 'PRE': return `\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`;
      case 'BLOCKQUOTE': {
        const inner = children().trim().split('\n').map(l => `> ${l}`).join('\n');
        return `${inner}\n\n`;
      }
      case 'A': {
        const href = el.getAttribute('href') || '';
        return href ? `[${children()}](${href})` : children();
      }
      case 'UL': return `${Array.from(el.children).map(li => walk(li, listDepth + 1, false)).join('')}\n`;
      case 'OL': return `${Array.from(el.children).map((li, i) => walk(li, listDepth + 1, true, i)).join('')}\n`;
      case 'LI': {
        const marker = ordered ? `${index + 1}.` : '-';
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        return `${indent}${marker} ${children().trim()}\n`;
      }
      default: return children();
    }
  };

  return walk(parsed.body).replace(/\n{3,}/g, '\n\n').trim();
}

/** Returns markdown content, converting legacy HTML notes on the fly. */
export function ensureMarkdown(content: string): { markdown: string; converted: boolean } {
  if (looksLikeHtml(content)) {
    return { markdown: htmlToMarkdown(content), converted: true };
  }
  return { markdown: content || '', converted: false };
}

/**
 * Renders markdown to sanitized HTML with Obsidian extras:
 * [[wikilinks]] (missing targets styled differently), #tags as chips,
 * and interactive task checkboxes carrying data-task-index.
 */
export function renderMarkdown(md: string, knownTitles: Set<string>): string {
  let pre = (md || '').replace(WIKILINK_RE, (_, target, label) => {
    const t = String(target).trim();
    const missing = !knownTitles.has(t.toLowerCase());
    return `<a class="wikilink${missing ? ' wikilink-missing' : ''}" data-wikilink="${escapeHtml(t)}">${escapeHtml((label || t).trim())}</a>`;
  });
  pre = pre.replace(TAG_RE, (_, lead, tag) => `${lead}<a class="mdtag" data-tag="${tag.toLowerCase()}">#${escapeHtml(tag)}</a>`);

  let html = marked.parse(pre) as string;

  let taskIndex = 0;
  html = html.replace(/<input([^>]*type="checkbox"[^>]*)>/g, (_, attrs: string) =>
    `<input${attrs.replace(/\s*disabled(="[^"]*")?/g, '')} data-task-index="${taskIndex++}">`);

  return DOMPurify.sanitize(html);
}

/** Flips the checked state of the nth task checkbox in the markdown source. */
export function toggleTask(md: string, index: number): string {
  let i = 0;
  return md.replace(TASK_RE, (full, open, state, close) => {
    const flipped = i === index ? (state === ' ' ? 'x' : ' ') : state;
    i++;
    return `${open}${flipped}${close}`;
  });
}
