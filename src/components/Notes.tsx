import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StickyNote, Plus, Trash2, X, Search, ChevronLeft, BookOpen, Edit3, GitFork, Link2, FileText } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, setDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Note } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useSettings } from '../contexts/SettingsContext';
import { formatFullToET } from '../lib/timeUtils';
import { renderMarkdown, extractWikilinks, extractTags, countWords, ensureMarkdown, toggleTask } from '../lib/markdown';
import MarkdownEditor from './notes/MarkdownEditor';
import GraphView from './notes/GraphView';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Draft {
  title: string;
  content: string;
}

function snippet(md: string): string {
  const line = (md || '')
    .split('\n')
    .map(l => l.replace(/^[#>\-*+\s[\]x]+/i, '').replace(/[*_`[\]#]/g, '').trim())
    .find(l => l.length > 0);
  return line ? line.slice(0, 90) : 'Empty note';
}

export default function Notes() {
  const { timeFormat } = useSettings();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [showGraph, setShowGraph] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [error, setError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Ids of notes created locally whose snapshot hasn't landed in `notes` yet;
  // keeps the sync effect from closing a brand-new note as "deleted".
  const pendingCreates = useRef<Set<string>>(new Set());
  // What persist() last wrote, so the sync effect can tell the echo of our
  // own write apart from a genuine remote edit. Without this, the echo's
  // normalized title (trimmed, or defaulted to "Untitled") would clobber the
  // live draft mid-composition — e.g. eating the trailing space the user
  // just typed.
  const lastWrittenRef = useRef<{ id: string; title: string; content: string } | null>(null);
  draftRef.current = draft;
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const q = query(collection(userRoot(), 'notes'), orderBy('createdAt', 'desc'));
    const source = 'notes';
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      const noteList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(noteList);
      setError(null);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error("Firestore onSnapshot error:", err);
      setError("Failed to load notes. You might not have permission.");
      try {
        handleFirestoreError(err, OperationType.LIST, 'notes');
      } catch (e) {
        // handleFirestoreError throws
      }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, []);

  // Markdown for every note (legacy Quill HTML converted transparently)
  const mdCache = useMemo(
    () => new Map(notes.map(n => [n.id!, ensureMarkdown(n.content).markdown])),
    [notes]
  );

  const titles = useMemo(() => notes.map(n => n.title), [notes]);
  const titleSet = useMemo(() => new Set(titles.map(t => t.toLowerCase())), [titles]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const n of notes) for (const t of extractTags(mdCache.get(n.id!) || '')) tags.add(t);
    return [...tags].sort();
  }, [notes, mdCache]);

  const selectedNote = notes.find(n => n.id === selectedId) || null;

  const backlinks = useMemo(() => {
    if (!selectedNote) return [];
    const target = selectedNote.title.toLowerCase();
    return notes.filter(n =>
      n.id !== selectedNote.id &&
      extractWikilinks(mdCache.get(n.id!) || '').some(t => t.toLowerCase() === target)
    );
  }, [notes, mdCache, selectedNote]);

  const { graphNodes, graphLinks } = useMemo(() => {
    const titleToId = new Map(notes.map(n => [n.title.toLowerCase(), n.id!]));
    const links: { source: string; target: string }[] = [];
    for (const n of notes) {
      for (const t of extractWikilinks(mdCache.get(n.id!) || '')) {
        const target = titleToId.get(t.toLowerCase());
        if (target && target !== n.id) links.push({ source: n.id!, target });
      }
    }
    return {
      graphNodes: notes.map(n => ({
        id: n.id!,
        title: n.title,
        hasTags: extractTags(mdCache.get(n.id!) || '').length > 0,
      })),
      graphLinks: links,
    };
  }, [notes, mdCache]);

  // ---- Autosave plumbing ----

  // Local-first: the write lands in the on-device cache immediately and is
  // durable across restarts, syncing when back online — so it counts as
  // "saved" right away. Never await the server ack (offline it never
  // arrives, and the status bar used to hang on "Saving…" in-store). Only a
  // real rejection (permission/validation) marks the draft unsaved.
  const persist = (id: string, d: Draft) => {
    const title = d.title.trim() || 'Untitled';
    lastWrittenRef.current = { id, title, content: d.content };
    trackWrite(updateDoc(doc(userRoot(), 'notes', id), {
      title,
      content: d.content,
      updatedAt: new Date().toISOString()
    })).catch((err: any) => {
      console.error("Failed to save note:", err);
      dirtyRef.current = true;
      setSaveState('unsaved');
      setError("Failed to save note. You might not have permission, or the note may be too large.");
    });
    dirtyRef.current = false;
    setSaveState('saved');
  };

  const queueSave = (id: string, d: Draft) => {
    dirtyRef.current = true;
    setSaveState('unsaved');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(id, d), 800);
  };

  const flushSave = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (dirtyRef.current && selectedIdRef.current && draftRef.current) {
      persist(selectedIdRef.current, draftRef.current);
    }
  };

  useEffect(() => () => flushSave(), []);

  // Keep the draft in sync with remote edits when we have no local changes
  useEffect(() => {
    if (!selectedId) return;
    const note = notes.find(n => n.id === selectedId);
    if (!note) {
      // A locally created note may not be in the snapshot yet — don't treat
      // it as deleted, just wait for the cache to emit it.
      if (pendingCreates.current.has(selectedId)) return;
      setSelectedId(null);
      setDraft(null);
      return;
    }
    pendingCreates.current.delete(selectedId);
    if (!dirtyRef.current) {
      const markdown = mdCache.get(selectedId) ?? '';
      // The echo of our own last write is not a remote edit — leave the live
      // draft (with its un-normalized title) alone.
      const lw = lastWrittenRef.current;
      if (lw && lw.id === selectedId && lw.title === note.title && lw.content === markdown) return;
      setDraft(prev =>
        prev && prev.title === note.title && prev.content === markdown
          ? prev
          : { title: note.title, content: markdown }
      );
    }
  }, [notes, selectedId, mdCache]);

  // ---- Navigation & actions ----

  const openNote = (id: string | null, startInEdit = false) => {
    flushSave();
    setShowGraph(false);
    setSelectedId(id);
    if (id) {
      const note = notes.find(n => n.id === id);
      if (note) {
        const { markdown, converted } = ensureMarkdown(note.content);
        setDraft({ title: note.title, content: markdown });
        setMode(startInEdit ? 'edit' : 'read');
        if (converted) {
          // Persist the one-time HTML -> markdown migration
          queueSave(id, { title: note.title, content: markdown });
        } else {
          dirtyRef.current = false;
          setSaveState('saved');
        }
      }
    } else {
      setDraft(null);
    }
  };

  // Local-first create: doc() hands back the id synchronously and the write
  // is saved on-device immediately, so the editor opens with no network.
  const createNote = (title: string, content = ''): string | null => {
    if (!auth.currentUser) return null;
    setError(null);
    const now = new Date().toISOString();
    const ref = doc(collection(userRoot(), 'notes'));
    pendingCreates.current.add(ref.id);
    trackWrite(setDoc(ref, {
      title,
      content,
      createdBy: auth.currentUser.uid,
      authorName: auth.currentUser.displayName || 'Explorer',
      createdAt: now,
      updatedAt: now
    })).catch((err: any) => {
      console.error("Failed to create note:", err);
      setError("Failed to create note. You might not have permission.");
    });
    return ref.id;
  };

  const handleNewNote = () => {
    flushSave();
    const id = createNote('Untitled');
    if (id) {
      setShowGraph(false);
      setSelectedId(id);
      setDraft({ title: 'Untitled', content: '' });
      setMode('edit');
      dirtyRef.current = false;
      setSaveState('saved');
    }
  };

  const handleDeleteNote = () => {
    if (!selectedId) return;
    if (!confirm(`Delete "${draft?.title || 'this note'}"?`)) return;
    dirtyRef.current = false; // never save into a deleted doc
    // Local-first: close the note immediately; the delete syncs when online
    trackWrite(deleteDoc(doc(userRoot(), 'notes', selectedId))).catch(err => {
      console.error("Failed to delete note:", err);
      setError("Failed to delete note. You might not have permission.");
    });
    setSelectedId(null);
    setDraft(null);
  };

  const followWikilink = (target: string) => {
    const existing = notes.find(n => n.title.toLowerCase() === target.toLowerCase());
    if (existing) {
      openNote(existing.id!);
    } else {
      // Obsidian behavior: clicking an unresolved link creates the note
      flushSave();
      const id = createNote(target);
      if (id) {
        setSelectedId(id);
        setDraft({ title: target, content: '' });
        setMode('edit');
        dirtyRef.current = false;
        setSaveState('saved');
      }
    }
  };

  const updateDraft = (next: Draft) => {
    setDraft(next);
    if (selectedId) queueSave(selectedId, next);
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wikilink = target.closest('[data-wikilink]') as HTMLElement | null;
    if (wikilink?.dataset.wikilink) {
      e.preventDefault();
      followWikilink(wikilink.dataset.wikilink);
      return;
    }
    const tagEl = target.closest('[data-tag]') as HTMLElement | null;
    if (tagEl?.dataset.tag) {
      e.preventDefault();
      setTagFilter(tagEl.dataset.tag);
      openNote(null);
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined && draft) {
      updateDraft({ ...draft, content: toggleTask(draft.content, Number(target.dataset.taskIndex)) });
    }
  };

  // ---- Derived list ----

  const filteredNotes = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    return notes
      .filter(note => {
        const md = mdCache.get(note.id!) || '';
        if (tagFilter && !extractTags(md).includes(tagFilter)) return false;
        if (!searchLower) return true;
        return note.title.toLowerCase().includes(searchLower) || md.toLowerCase().includes(searchLower);
      })
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }, [notes, mdCache, searchQuery, tagFilter]);

  const noteTags = draft ? extractTags(draft.content) : [];
  const wordCount = draft ? countWords(draft.content) : 0;
  const showSidebar = !selectedId && !showGraph;

  return (
    <div className="flex h-full overflow-hidden text-slate-200">
      {/* Sidebar: vault file list */}
      <aside className={cn(
        "w-full md:w-72 lg:w-80 shrink-0 flex-col border-r border-slate-800/60 bg-slate-900/30 min-h-0",
        showSidebar ? "flex" : "hidden md:flex"
      )}>
        <div className="p-3 border-b border-slate-800/60 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2 pl-1">
              <StickyNote className="w-4 h-4 text-amber-400" />
              Notes
              <span className="text-[10px] text-slate-600 font-bold">{notes.length}</span>
            </h1>
            <div className="flex gap-1">
              <button
                onClick={() => { flushSave(); setShowGraph(true); setSelectedId(null); setDraft(null); }}
                aria-label="Graph view"
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 transition-colors"
              >
                <GitFork className="w-4 h-4" />
              </button>
              <button
                onClick={handleNewNote}
                aria-label="New note"
                className="p-2 bg-amber-500/90 hover:bg-amber-500 rounded-lg text-white transition-colors shadow-lg shadow-amber-900/20"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            <input
              type="text"
              placeholder="Search notes..."
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all text-white placeholder:text-slate-600"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all",
                    tagFilter === tag
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : "bg-indigo-900/20 text-indigo-300 border-indigo-500/20 hover:bg-indigo-900/40"
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="m-3 p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs font-medium">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredNotes.length === 0 ? (
            <p className="text-xs text-slate-600 italic text-center py-8">
              {notes.length === 0 ? 'No notes yet — create your first one' : 'No matches'}
            </p>
          ) : (
            filteredNotes.map(note => (
              <button
                key={note.id}
                onClick={() => openNote(note.id!)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-xl transition-colors group",
                  selectedId === note.id ? "bg-indigo-600/15 ring-1 ring-indigo-500/30" : "hover:bg-slate-800/60"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    "text-sm font-bold truncate",
                    selectedId === note.id ? "text-indigo-300" : "text-white"
                  )}>
                    {note.title}
                  </span>
                  <span className="text-[9px] text-slate-600 font-bold shrink-0 tabular-nums">
                    {formatFullToET(note.updatedAt || note.createdAt, timeFormat)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{snippet(mdCache.get(note.id!) || '')}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main pane */}
      <main className={cn(
        "flex-1 flex-col min-w-0 min-h-0",
        showSidebar ? "hidden md:flex" : "flex"
      )}>
        {showGraph ? (
          <>
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/40 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowGraph(false)} className="md:hidden p-2 -ml-2 hover:bg-slate-800 rounded-full">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <GitFork className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-black text-white uppercase tracking-wider">Graph view</span>
                <span className="text-[10px] text-slate-600 font-bold">{graphNodes.length} notes · {graphLinks.length} links</span>
              </div>
              <button onClick={() => setShowGraph(false)} className="hidden md:block p-2 hover:bg-slate-800 rounded-full">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {graphNodes.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-600">No notes to graph yet</div>
              ) : (
                <GraphView nodes={graphNodes} links={graphLinks} onSelect={id => openNote(id)} />
              )}
            </div>
          </>
        ) : selectedId && draft ? (
          <>
            {/* Note toolbar */}
            <div className="px-3 md:px-6 py-2 flex items-center gap-1 border-b border-slate-800/40 shrink-0">
              <button onClick={() => openNote(null)} className="md:hidden p-2 hover:bg-slate-800 rounded-full">
                <ChevronLeft className="w-5 h-5 text-slate-400" />
              </button>
              <div className="flex-1" />
              <div className="flex bg-slate-950/70 p-0.5 rounded-lg border border-slate-800">
                <button
                  onClick={() => setMode('read')}
                  aria-label="Reading view"
                  className={cn("p-1.5 rounded-md transition-all", mode === 'read' ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-300")}
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMode('edit')}
                  aria-label="Editing view"
                  className={cn("p-1.5 rounded-md transition-all", mode === 'edit' ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-300")}
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={handleDeleteNote}
                aria-label="Delete note"
                className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Note body */}
            <div className={cn(
              "flex-1 min-h-0 px-4 md:px-8 pt-4",
              mode === 'read' ? "overflow-y-auto pb-6" : "flex flex-col pb-4"
            )}>
              <div className="max-w-3xl mx-auto w-full flex-1 min-h-0 flex flex-col">
                <input
                  type="text"
                  maxLength={199}
                  value={draft.title}
                  onChange={e => updateDraft({ ...draft, title: e.target.value })}
                  placeholder="Untitled"
                  className="w-full text-2xl md:text-3xl font-black tracking-tight bg-transparent text-white outline-none placeholder:text-slate-700 shrink-0"
                />

                {noteTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 shrink-0">
                    {noteTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => { setTagFilter(tag); openNote(null); }}
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-900/30 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-900/50 transition-colors"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                {mode === 'read' ? (
                  <>
                    <div
                      className="markdown-body mt-5"
                      onClick={handlePreviewClick}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.content, titleSet) }}
                    />
                    {draft.content.trim() === '' && (
                      <button onClick={() => setMode('edit')} className="mt-4 text-sm text-slate-600 italic hover:text-slate-400 transition-colors text-left">
                        Empty note — tap to start writing
                      </button>
                    )}

                    {backlinks.length > 0 && (
                      <div className="mt-12 pt-4 border-t border-slate-800/60">
                        <h4 className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3">
                          <Link2 className="w-3 h-3" /> Linked mentions ({backlinks.length})
                        </h4>
                        <div className="space-y-1">
                          {backlinks.map(bl => (
                            <button
                              key={bl.id}
                              onClick={() => openNote(bl.id!)}
                              className="w-full text-left px-3 py-2 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:border-indigo-500/30 transition-all group"
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span className="text-sm font-bold text-white truncate group-hover:text-indigo-300 transition-colors">{bl.title}</span>
                              </div>
                              <p className="text-[11px] text-slate-500 truncate mt-0.5 ml-5.5">{snippet(mdCache.get(bl.id!) || '')}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex-1 min-h-0 mt-4">
                    <MarkdownEditor
                      value={draft.content}
                      onChange={content => updateDraft({ ...draft, content })}
                      titles={titles.filter(t => t !== draft.title)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Status bar */}
            <div className="px-4 md:px-8 py-2 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500 font-medium shrink-0 bg-slate-900/30">
              <span>
                {backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''} · {wordCount} word{wordCount !== 1 ? 's' : ''}
              </span>
              <span className={cn(
                "font-bold uppercase tracking-wider text-[9px]",
                saveState === 'saved' ? "text-slate-600" : saveState === 'saving' ? "text-indigo-400" : "text-amber-400"
              )}>
                {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Unsaved'}
              </span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <StickyNote className="w-8 h-8 text-slate-700" />
            <div>
              <p className="text-sm font-bold text-slate-500">Select a note to read or edit</p>
              <p className="text-xs text-slate-600 mt-1">Link notes together with [[wikilinks]] and explore the graph</p>
            </div>
            <button
              onClick={handleNewNote}
              className="bg-amber-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 hover:bg-amber-600 transition-colors shadow-lg shadow-amber-900/20"
            >
              <Plus className="w-4 h-4" /> New Note
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
