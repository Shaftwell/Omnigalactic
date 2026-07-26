import React, { useState, useRef } from 'react';
import { FileText } from 'lucide-react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  titles: string[];
}

interface AutocompleteState {
  query: string;
  start: number; // index right after "[["
}

/** Plain-markdown editor with Obsidian-style [[wikilink]] autocomplete. */
export default function MarkdownEditor({ value, onChange, titles }: MarkdownEditorProps) {
  const [ac, setAc] = useState<AutocompleteState | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const matches = ac
    ? titles.filter(t => t.toLowerCase().includes(ac.query.toLowerCase())).slice(0, 6)
    : [];

  const updateAutocomplete = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const open = before.lastIndexOf('[[');
    if (open === -1) return setAc(null);
    const fragment = before.slice(open + 2);
    if (fragment.includes(']]') || fragment.includes('\n') || fragment.length > 60) return setAc(null);
    setAc({ query: fragment, start: open + 2 });
  };

  const insertLink = (title: string) => {
    const ta = taRef.current;
    if (!ta || !ac) return;
    const caret = ta.selectionStart;
    // Swallow a pre-existing closing "]]" right after the caret
    const after = value.slice(caret).replace(/^\]\]/, '');
    const next = `${value.slice(0, ac.start)}${title}]]${after}`;
    onChange(next);
    setAc(null);
    const newCaret = ac.start + title.length + 2;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  return (
    <div className="relative h-full flex flex-col">
      <textarea
        ref={taRef}
        // Matches the security rules' content.size() < 5000 cap; anything
        // longer would be accepted locally but rejected on sync (data loss).
        maxLength={4999}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          updateAutocomplete(e.target.value, e.target.selectionStart);
        }}
        onKeyUp={e => updateAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={e => {
          if (e.key === 'Escape') setAc(null);
          if (e.key === 'Enter' && ac && matches.length > 0) {
            e.preventDefault();
            insertLink(matches[0]);
          }
        }}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        placeholder={'Write in markdown…\n\n# Heading\n**bold**, *italic*, - lists\n- [ ] task\n[[Link to another note]] and #tags'}
        className="flex-1 w-full bg-transparent outline-none resize-none text-[15px] leading-relaxed text-slate-200 placeholder:text-slate-700 font-sans"
        spellCheck={false}
      />

      {ac && matches.length > 0 && (
        <div className="absolute top-2 right-2 left-2 sm:left-auto sm:w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-20">
          <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-800">
            Link to note {ac.query && <span className="text-indigo-400">"{ac.query}"</span>}
          </div>
          {matches.map(title => (
            <button
              key={title}
              onMouseDown={e => {
                e.preventDefault();
                insertLink(title);
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-indigo-600/20 hover:text-white flex items-center gap-2 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
