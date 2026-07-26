import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Circle, CheckCircle2, ChevronLeft, ChevronDown, ChevronRight, X, Inbox, Sun, Layers, CalendarDays, FileText, ListTodo, RefreshCw, Users } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, setDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { List, Task, Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';
import { getNowInET } from '../lib/timeUtils';
import { getEventColor, EVENT_COLOR_NAMES } from '../lib/eventColors';
import { usePeople, addPerson, removePerson, personStyle, normalizePerson, PersonAvatar as Avatar, DEFAULT_PERSON } from '../lib/people';
import { toggleTaskDoc, isRepeating, REPEAT_LABELS, TaskRepeat } from '../lib/tasks';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type SmartView = 'inbox' | 'today' | 'all';
type View = SmartView | { listId: string };

const SMART_VIEWS: { id: SmartView; label: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'all', label: 'All Tasks', icon: Layers },
];

export default function Superlist() {
  const { people, personDocs } = usePeople();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isManagingPeople, setIsManagingPeople] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [lists, setLists] = useState<List[]>([]);
  const [view, setView] = useState<View | null>(null); // null = sidebar (mobile home)
  const [personFilter, setPersonFilter] = useState<Person | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPerson, setQuickPerson] = useState<Person>(DEFAULT_PERSON);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!people.includes(quickPerson)) setQuickPerson(people[0] ?? DEFAULT_PERSON);
  }, [people.join('\u0000')]);
  const migratedRef = useRef<Set<string>>(new Set());
  const notesTimer = useRef<number | null>(null);
  // Ids of lists created locally whose snapshot hasn't landed in `lists` yet;
  // keeps the view-sync effect from bouncing us out of a brand-new list.
  const pendingListIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(userRoot(), 'todos'), orderBy('createdAt', 'desc'));
    const source = 'tasks';
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setTasks(snapshot.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, assignee: normalizePerson(data.assignee) } as Task;
      }));
      setError(null);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error("Firestore todos error:", err);
      setError("Failed to load tasks. You might not have permission.");
      try { handleFirestoreError(err, OperationType.LIST, 'todos'); } catch (e) { /* throws */ }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const q = query(collection(userRoot(), 'lists'), orderBy('createdAt', 'desc'));
    const source = 'task-lists';
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setLists(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as List)));
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error("Firestore lists error:", err);
      setError("Failed to load lists. You might not have permission.");
      try { handleFirestoreError(err, OperationType.LIST, 'lists'); } catch (e) { /* throws */ }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, []);

  // One-time migration: legacy plain-string list items become person-assigned
  // tasks (default Matt — reassign from the task detail sheet). Local-first:
  // every write is fired without awaiting server acks — awaiting in sequence
  // stalled the migration after the first item offline, and because the
  // items:[] clear was never reached, an offline relaunch re-queued duplicate
  // tasks. Fired together, all writes (including the clear) land in the
  // on-device cache instantly, so a relaunch sees items already empty.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    for (const list of lists) {
      if (list.items && list.items.length > 0 && list.id && !migratedRef.current.has(list.id)) {
        migratedRef.current.add(list.id);
        for (const item of list.items) {
          trackWrite(addDoc(collection(userRoot(), 'todos'), {
            title: item,
            assignee: 'Matt',
            isCompleted: false,
            listId: list.id,
            notes: '',
            dueDate: null,
            createdBy: user.uid,
            authorName: user.displayName || 'Explorer',
            createdAt: new Date().toISOString()
          })).catch(err => console.error("List item migration failed:", err));
        }
        trackWrite(updateDoc(doc(userRoot(), 'lists', list.id!), { items: [] }))
          .catch(err => console.error("List migration cleanup failed:", err));
      }
    }
  }, [lists]);

  const todayKey = format(getNowInET(), 'yyyy-MM-dd');
  const currentList = view && typeof view === 'object' ? lists.find(l => l.id === view.listId) ?? null : null;

  const inView = (t: Task): boolean => {
    if (personFilter && t.assignee !== personFilter) return false;
    if (view === 'inbox') return !t.listId;
    if (view === 'today') return !!t.dueDate && t.dueDate <= todayKey;
    if (view === 'all') return true;
    if (view && typeof view === 'object') return t.listId === view.listId;
    return false;
  };

  const viewTasks = tasks.filter(inView);
  const activeTasks = viewTasks.filter(t => !t.isCompleted);
  const completedTasks = viewTasks
    .filter(t => t.isCompleted)
    .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));

  const sortActive = (a: Task, b: Task) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  };

  const sections = (personFilter ? [personFilter] : [...new Set([...people, ...activeTasks.map(t => t.assignee)])])
    .map(person => ({ person, tasks: activeTasks.filter(t => t.assignee === person).sort(sortActive) }));

  const countFor = (v: View): number =>
    tasks.filter(t => !t.isCompleted && (!personFilter || t.assignee === personFilter) && (
      v === 'inbox' ? !t.listId
        : v === 'today' ? (!!t.dueDate && t.dueDate <= todayKey)
        : v === 'all' ? true
        : t.listId === (v as { listId: string }).listId
    )).length;

  // ---- Mutations ----

  const reportError = (err: any, fallback: string, op: OperationType, path: string) => {
    console.error(fallback, err);
    setError(err?.code === 'permission-denied' || err?.message?.includes('permission-denied')
      ? "Permission denied. You might not be authorized for this action."
      : fallback);
    try { handleFirestoreError(err, op, path); } catch (e) { /* throws */ }
  };

  // Writes are local-first: with the persistent cache the doc is saved
  // on-device immediately and syncs when back online. Never await the server
  // ack in the UI — offline it never arrives and the input/sheet would hang.
  // Real rejections (permission/validation) still surface via .catch.
  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !quickTitle.trim()) return;
    setError(null);
    trackWrite(addDoc(collection(userRoot(), 'todos'), {
      title: quickTitle.trim(),
      assignee: quickPerson,
      isCompleted: false,
      listId: currentList ? currentList.id : null,
      notes: '',
      dueDate: view === 'today' ? todayKey : null,
      createdBy: user.uid,
      authorName: user.displayName || 'Explorer',
      createdAt: new Date().toISOString()
    })).catch(err => {
      reportError(err, "Failed to add task. You might not have permission.", OperationType.CREATE, 'todos');
    });
    setQuickTitle('');
  };

  const patchTask = async (task: Task, patch: Partial<Task>) => {
    if (!task.id) return;
    try {
      await trackWrite(updateDoc(doc(userRoot(), 'todos', task.id), patch as any));
    } catch (err) {
      reportError(err, "Failed to update task.", OperationType.UPDATE, `todos/${task.id}`);
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      await toggleTaskDoc(task); // repeating tasks reschedule instead of completing
    } catch (err) {
      reportError(err, "Failed to update task.", OperationType.UPDATE, `todos/${task.id}`);
    }
  };

  const deleteTask = (task: Task) => {
    if (!task.id) return;
    if (detailTask?.id === task.id) setDetailTask(null);
    trackWrite(deleteDoc(doc(userRoot(), 'todos', task.id))).catch(err => {
      reportError(err, "Failed to delete task.", OperationType.DELETE, `todos/${task.id}`);
    });
  };

  const clearCompleted = () => {
    if (!confirm(`Remove ${completedTasks.length} completed task${completedTasks.length !== 1 ? 's' : ''}?`)) return;
    // Fire all deletes without awaiting: each applies to the local cache
    // instantly; awaiting in sequence stalled after the first one offline.
    for (const t of completedTasks) deleteTask(t);
  };

  const addList = (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !newListTitle.trim()) return;
    setError(null);
    // doc() hands back the new id synchronously, so we can open the list
    // immediately without waiting for a server ack that never comes offline.
    const ref = doc(collection(userRoot(), 'lists'));
    pendingListIds.current.add(ref.id);
    trackWrite(setDoc(ref, {
      title: newListTitle.trim(),
      items: [],
      color: EVENT_COLOR_NAMES[lists.length % EVENT_COLOR_NAMES.length],
      createdBy: user.uid,
      authorName: user.displayName || 'Explorer',
      createdAt: new Date().toISOString()
    })).catch(err => {
      reportError(err, "Failed to add list. You might not have permission.", OperationType.CREATE, 'lists');
    });
    setNewListTitle('');
    setIsAddingList(false);
    setView({ listId: ref.id });
  };

  const deleteList = (list: List) => {
    if (!list.id) return;
    const listTasks = tasks.filter(t => t.listId === list.id);
    if (!confirm(`Delete "${list.title}"${listTasks.length ? ` and its ${listTasks.length} task${listTasks.length !== 1 ? 's' : ''}` : ''}?`)) return;
    for (const t of listTasks) {
      if (t.id) trackWrite(deleteDoc(doc(userRoot(), 'todos', t.id))).catch(err => {
        reportError(err, "Failed to delete task.", OperationType.DELETE, `todos/${t.id}`);
      });
    }
    trackWrite(deleteDoc(doc(userRoot(), 'lists', list.id))).catch(err => {
      reportError(err, "Failed to delete list.", OperationType.DELETE, `lists/${list.id}`);
    });
    setView(null);
  };

  // Keep the open detail sheet in sync with snapshots
  useEffect(() => {
    if (!detailTask?.id) return;
    const fresh = tasks.find(t => t.id === detailTask.id);
    if (!fresh) setDetailTask(null);
    else if (fresh !== detailTask) setDetailTask(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Leave a list view whose list no longer exists (deleted on another device,
  // or a rejected create rolled back) instead of stranding the user in a
  // ghost view — but not before a just-created list's snapshot has landed.
  useEffect(() => {
    if (!view || typeof view !== 'object') return;
    if (lists.some(l => l.id === view.listId)) {
      pendingListIds.current.delete(view.listId);
      return;
    }
    if (pendingListIds.current.has(view.listId)) return;
    setView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, view]);

  const setDetailNotes = (task: Task, notes: string) => {
    setDetailTask({ ...task, notes });
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => patchTask(task, { notes }), 600);
  };

  // ---- Render helpers ----

  const dueChip = (task: Task) => {
    if (!task.dueDate) return null;
    const overdue = !task.isCompleted && task.dueDate < todayKey;
    const isToday = task.dueDate === todayKey;
    return (
      <span className={cn(
        'flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0',
        overdue ? 'text-red-400 border-red-500/30 bg-red-900/20'
          : isToday ? 'text-amber-400 border-amber-500/30 bg-amber-900/20'
          : 'text-slate-500 border-slate-700/60 bg-slate-800/40'
      )}>
        <CalendarDays className="w-2.5 h-2.5" />
        {overdue ? 'Overdue' : isToday ? 'Today' : format(parseISO(task.dueDate), 'MMM d')}
      </span>
    );
  };

  const TaskRow = ({ task }: { task: Task }) => (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.02, right: 0.35 }}
      dragDirectionLock
      onDragEnd={(_, info) => {
        // Swipe right to complete (or to reschedule a repeating chore)
        if (info.offset.x > 90) toggleTask(task);
      }}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700 transition-all"
    >
      <button onClick={() => toggleTask(task)} className="shrink-0 transition-colors" aria-label="Toggle complete">
        {task.isCompleted
          ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          : <Circle className="w-5 h-5 text-slate-600 hover:text-emerald-500" />}
      </button>
      <button onClick={() => setDetailTask(task)} className="flex-1 min-w-0 text-left">
        <span className={cn('text-sm font-bold block truncate', task.isCompleted ? 'text-slate-600 line-through' : 'text-slate-200')}>
          {task.title}
        </span>
      </button>
      {isRepeating(task) && <RefreshCw className="w-3 h-3 text-violet-400/70 shrink-0" />}
      {task.notes && <FileText className="w-3 h-3 text-slate-600 shrink-0" />}
      {dueChip(task)}
      {task.isCompleted && <Avatar person={task.assignee as Person} size="sm" />}
      <button
        onClick={() => deleteTask(task)}
        className="hidden md:block opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-red-400 transition-all shrink-0"
        aria-label="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );

  const viewTitle = currentList ? currentList.title
    : view === 'inbox' ? 'Inbox'
    : view === 'today' ? 'Today'
    : view === 'all' ? 'All Tasks' : '';

  const doneCount = viewTasks.filter(t => t.isCompleted).length;
  const showSidebar = view === null;

  return (
    <div className="flex h-full overflow-hidden text-slate-200">
      {/* Sidebar */}
      <aside className={cn(
        'w-full md:w-72 lg:w-80 shrink-0 flex-col border-r border-slate-800/60 bg-slate-900/30 min-h-0',
        showSidebar ? 'flex' : 'hidden md:flex'
      )}>
        <div className="p-3 border-b border-slate-800/60 space-y-3">
          <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2 pl-1">
            <ListTodo className="w-4 h-4 text-violet-400" />
            Superlist
          </h1>

          {/* Person filter — everything is organized by who it's for */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setPersonFilter(null)}
              className={cn(
                'px-2.5 py-1.5 rounded-xl text-[11px] font-black transition-all border',
                personFilter === null ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
              )}
            >
              All
            </button>
            {people.map(p => (
              <button
                key={p}
                onClick={() => {
                  setPersonFilter(personFilter === p ? null : p);
                  setQuickPerson(p);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[11px] font-black transition-all border',
                  personFilter === p ? cn('text-white border-transparent', personStyle(p).avatar) : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                )}
              >
                {personFilter !== p && <Avatar person={p} size="sm" />}
                {p}
              </button>
            ))}
            <button
              onClick={() => setIsManagingPeople(true)}
              aria-label="Manage people"
              className="px-2 py-1.5 rounded-xl text-slate-500 hover:text-indigo-400 border border-slate-800 bg-slate-900/60 transition-all"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="m-3 p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs font-medium">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          <div className="space-y-0.5">
            {SMART_VIEWS.map(v => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors',
                  view === v.id ? 'bg-violet-600/15 ring-1 ring-violet-500/30 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                )}
              >
                <v.icon className={cn('w-4 h-4', view === v.id ? 'text-violet-400' : 'text-slate-500')} />
                <span className="text-sm font-bold flex-1 text-left">{v.label}</span>
                {countFor(v.id) > 0 && (
                  <span className="text-[10px] font-black text-slate-500 bg-slate-900/80 border border-slate-800 px-1.5 py-0.5 rounded-md tabular-nums">
                    {countFor(v.id)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Lists</span>
              <button onClick={() => setIsAddingList(true)} aria-label="New list" className="p-1 text-slate-500 hover:text-violet-400 transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {isAddingList && (
              <form onSubmit={addList} className="px-2 pb-1">
                <input
                  autoFocus
                  type="text"
                  value={newListTitle}
                  onChange={e => setNewListTitle(e.target.value)}
                  onBlur={() => { if (!newListTitle.trim()) setIsAddingList(false); }}
                  maxLength={199}
                  placeholder="List name…"
                  className="w-full bg-slate-950/70 border border-violet-500/40 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </form>
            )}

            <div className="space-y-0.5">
              {lists.map(list => {
                const active = !!currentList && currentList.id === list.id;
                return (
                  <button
                    key={list.id}
                    onClick={() => setView({ listId: list.id! })}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors',
                      active ? 'bg-violet-600/15 ring-1 ring-violet-500/30 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                    )}
                  >
                    <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', getEventColor(list.color).accent)} />
                    <span className="text-sm font-bold flex-1 text-left truncate">{list.title}</span>
                    {countFor({ listId: list.id! }) > 0 && (
                      <span className="text-[10px] font-black text-slate-500 bg-slate-900/80 border border-slate-800 px-1.5 py-0.5 rounded-md tabular-nums">
                        {countFor({ listId: list.id! })}
                      </span>
                    )}
                  </button>
                );
              })}
              {lists.length === 0 && !isAddingList && (
                <p className="px-3 py-2 text-xs text-slate-600 italic">No lists yet — tap + to create one</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main pane */}
      <main className={cn('flex-1 flex-col min-w-0 min-h-0', showSidebar ? 'hidden md:flex' : 'flex')}>
        {view === null ? (
          <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-3 text-center p-8">
            <ListTodo className="w-8 h-8 text-slate-700" />
            <p className="text-sm font-bold text-slate-500">Pick a view or list to get started</p>
          </div>
        ) : (
          <>
            {/* View header */}
            <div className="px-4 md:px-8 pt-4 pb-2 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setView(null)} className="md:hidden p-2 -ml-2 hover:bg-slate-800 rounded-full">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                {currentList && <span className={cn('w-3 h-3 rounded-full shrink-0', getEventColor(currentList.color).accent)} />}
                <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex-1 truncate">{viewTitle}</h2>
                {completedTasks.length > 0 && (
                  <button onClick={clearCompleted} className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-red-400 transition-colors px-2 py-1">
                    Clear done
                  </button>
                )}
                {currentList && (
                  <button onClick={() => deleteList(currentList)} aria-label="Delete list" className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              {viewTasks.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round((doneCount / viewTasks.length) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-black text-slate-500 tabular-nums">{doneCount}/{viewTasks.length}</span>
                </div>
              )}
            </div>

            {/* Quick add */}
            <form onSubmit={addTask} className="px-4 md:px-8 pb-2 shrink-0">
              <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-700/60 rounded-2xl px-3 py-2 focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all">
                <Plus className="w-4 h-4 text-violet-400 shrink-0" />
                <input
                  type="text"
                  value={quickTitle}
                  onChange={e => setQuickTitle(e.target.value)}
                  maxLength={499}
                  placeholder={`Add a task for ${quickPerson}…`}
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-slate-600 min-w-0 py-1"
                />
                <div className="flex gap-1 shrink-0">
                  {people.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setQuickPerson(p)}
                      aria-label={`Assign to ${p}`}
                      className={cn(
                        'rounded-full transition-all',
                        quickPerson === p ? 'ring-2 ring-white/80 scale-110' : 'opacity-40 hover:opacity-100'
                      )}
                    >
                      <Avatar person={p} />
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {/* Person-grouped tasks */}
            <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10 pt-1 space-y-5">
              {activeTasks.length === 0 && completedTasks.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <Sun className="w-6 h-6 text-slate-700 mx-auto" />
                  <p className="text-sm font-medium text-slate-500">Nothing here — add a task above</p>
                </div>
              ) : (
                sections.map(({ person, tasks: personTasks }) => (
                  (personTasks.length > 0 || personFilter === person) && (
                    <section key={person}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Avatar person={person} />
                        <span className={cn('text-sm font-black tracking-tight', personStyle(person).text)}>{person}</span>
                        <span className="text-[10px] font-black text-slate-600 tabular-nums">{personTasks.length}</span>
                        <div className="flex-1 h-px bg-slate-800/60" />
                      </div>
                      <div className="space-y-1.5">
                        <AnimatePresence mode="popLayout">
                          {personTasks.map(task => <TaskRow key={task.id} task={task} />)}
                        </AnimatePresence>
                        {personTasks.length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-600 italic">Nothing for {person}</p>
                        )}
                      </div>
                    </section>
                  )
                ))
              )}

              {completedTasks.length > 0 && (
                <section>
                  <button
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="flex items-center gap-2 mb-2 px-1 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="text-xs font-black uppercase tracking-wider">Completed ({completedTasks.length})</span>
                  </button>
                  {showCompleted && (
                    <div className="space-y-1.5">
                      <AnimatePresence mode="popLayout">
                        {completedTasks.map(task => <TaskRow key={task.id} task={task} />)}
                      </AnimatePresence>
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </main>

      {/* Task detail sheet */}
      <AnimatePresence>
        {detailTask && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-slate-900 w-full max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl border border-slate-800 overflow-hidden max-h-[90dvh] flex flex-col"
            >
              <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
                <button onClick={() => toggleTask(detailTask)} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-emerald-400 transition-colors">
                  {detailTask.isCompleted
                    ? <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Completed</>
                    : <><Circle className="w-5 h-5" /> Mark complete</>}
                </button>
                <button onClick={() => setDetailTask(null)} className="p-2 hover:bg-slate-800 rounded-full">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <input
                  type="text"
                  value={detailTask.title}
                  onChange={e => {
                    const title = e.target.value;
                    setDetailTask({ ...detailTask, title });
                  }}
                  onBlur={e => { if (e.target.value.trim()) patchTask(detailTask, { title: e.target.value.trim() }); }}
                  maxLength={499}
                  className="w-full text-xl font-black tracking-tight bg-transparent text-white outline-none placeholder:text-slate-700"
                  placeholder="Task title"
                />

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">For</label>
                  <div className="flex gap-2">
                    {people.map(p => (
                      <button
                        key={p}
                        onClick={() => { setDetailTask({ ...detailTask, assignee: p }); patchTask(detailTask, { assignee: p }); }}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-all',
                          detailTask.assignee === p
                            ? cn('text-white border-transparent', personStyle(p).avatar)
                            : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white'
                        )}
                      >
                        {detailTask.assignee !== p && <Avatar person={p} size="sm" />}
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">List</label>
                    <select
                      value={detailTask.listId || ''}
                      onChange={e => {
                        const listId = e.target.value || null;
                        setDetailTask({ ...detailTask, listId });
                        patchTask(detailTask, { listId });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500/50"
                    >
                      <option value="">📥 Inbox</option>
                      {lists.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Due date</label>
                    <input
                      type="date"
                      value={detailTask.dueDate || ''}
                      onChange={e => {
                        const dueDate = e.target.value || null;
                        setDetailTask({ ...detailTask, dueDate });
                        patchTask(detailTask, { dueDate });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500/50"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Repeat</label>
                  <select
                    value={detailTask.repeat || 'none'}
                    onChange={e => {
                      const repeat = e.target.value as TaskRepeat;
                      setDetailTask({ ...detailTask, repeat });
                      patchTask(detailTask, { repeat });
                    }}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500/50"
                  >
                    {(Object.entries(REPEAT_LABELS) as [TaskRepeat, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {isRepeating(detailTask) && (
                    <p className="text-[10px] text-slate-600 flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5" /> Checking it off reschedules it for the next cycle
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
                  <textarea
                    value={detailTask.notes || ''}
                    onChange={e => setDetailNotes(detailTask, e.target.value)}
                    maxLength={5000}
                    placeholder="Add details…"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2.5 text-sm min-h-[80px] focus:ring-2 focus:ring-violet-500/50 placeholder:text-slate-700"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider">
                    Added by {detailTask.authorName}
                  </span>
                  <button
                    onClick={() => { if (confirm('Delete this task?')) deleteTask(detailTask); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-red-400 transition-colors px-2 py-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manage People Modal */}
      <AnimatePresence>
        {isManagingPeople && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-800 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Manage People
                </h3>
                <button onClick={() => setIsManagingPeople(false)} className="p-2 hover:bg-slate-800 rounded-full">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    const name = newPersonName.trim();
                    if (!name || people.includes(name)) return;
                    addPerson(name).catch(err => console.error('Failed to add person:', err));
                    setNewPersonName('');
                  }}
                  className="space-y-3"
                >
                  <p className="text-xs text-slate-400 leading-relaxed">
                    People are labels for organizing tasks — add anyone you plan for. Only you can see them.
                  </p>
                  <div className="flex gap-2">
                    <input
                      required
                      type="text"
                      maxLength={99}
                      placeholder="Name"
                      className="flex-1 bg-slate-950 border-slate-800 text-white rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
                      value={newPersonName}
                      onChange={e => setNewPersonName(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-all text-xs uppercase tracking-widest"
                    >
                      Add
                    </button>
                  </div>
                </form>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {personDocs.length === 0 ? (
                    <p className="text-xs text-slate-600 italic py-4 text-center">
                      No people yet — tasks are grouped under “{DEFAULT_PERSON}”.
                    </p>
                  ) : (
                    personDocs.map(person => (
                      <div key={person.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800 group">
                        <div className="flex items-center gap-3">
                          <Avatar person={person.name} />
                          <span className="text-sm font-bold text-white">{person.name}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (!confirm(`Remove ${person.name}? Their existing tasks keep the label.`)) return;
                            removePerson(person.id).catch(err => console.error('Failed to remove person:', err));
                          }}
                          aria-label={`Remove ${person.name}`}
                          className="p-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
