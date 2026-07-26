import React, { useState, useEffect, useMemo } from 'react';
import { Circle, CheckCircle2, ShoppingCart, Calendar as CalendarIcon, MapPin, RefreshCw, ChevronRight, Sun, ListTodo, Sparkles } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Event, Task, ShoppingItem, Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isSameDay, addDays, isAfter } from 'date-fns';
import { useSettings } from '../contexts/SettingsContext';
import { formatToET, formatFullToET, getNowInET } from '../lib/timeUtils';
import { getEventInstances } from '../lib/recurrence';
import { getEventColor } from '../lib/eventColors';
import { personStyle, normalizePerson, PersonAvatar } from '../lib/people';
import { toggleTaskDoc, isRepeating } from '../lib/tasks';
import { clearSnapshotMetadata, reportSnapshotMetadata } from '../lib/syncStatus';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TodayProps {
  onNavigate: (tab: 'calendar' | 'shopping' | 'tasks') => void;
}

function greeting(hour: number): string {
  if (hour < 5) return 'Burning the midnight fuel';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Today({ onNavigate }: TodayProps) {
  const { timeFormat } = useSettings();
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listen = <T,>(source: string, target: T, next: (snapshot: any) => void, error: (err: any) => void) =>
      onSnapshot(target as any, { includeMetadataChanges: true }, snapshot => {
        reportSnapshotMetadata(source, snapshot.metadata);
        next(snapshot);
      }, err => {
        clearSnapshotMetadata(source);
        error(err);
      });
    const subs = [
      listen('today-events', query(collection(userRoot(), 'events'), orderBy('date', 'asc')), snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as Event)));
      }, err => {
        console.error('Firestore events error:', err);
        setError('Failed to load the dashboard. You might not have permission.');
        try { handleFirestoreError(err, OperationType.LIST, 'events'); } catch (e) { /* throws */ }
      }),
      listen('today-tasks', query(collection(userRoot(), 'todos'), orderBy('createdAt', 'desc')), snap => {
        setTasks(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, assignee: normalizePerson(data.assignee) } as Task;
        }));
      }, err => console.error('Firestore todos error:', err)),
      listen('today-shopping', query(collection(userRoot(), 'shoppingItems'), orderBy('createdAt', 'desc')), snap => {
        setShoppingItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingItem)));
      }, err => console.error('Firestore shoppingItems error:', err)),
    ];
    return () => {
      ['today-events', 'today-tasks', 'today-shopping'].forEach(clearSnapshotMetadata);
      subs.forEach(unsub => unsub());
    };
  }, []);

  const now = getNowInET();
  const todayKey = format(now, 'yyyy-MM-dd');
  const firstName = (auth.currentUser?.displayName || 'Commander').split(' ')[0];

  const todaysEvents = useMemo(() =>
    events
      .flatMap(e => getEventInstances(e, now, now))
      .filter(e => isSameDay(parseISO(e.date), now))
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime()),
    [events, todayKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const upcomingEvents = useMemo(() =>
    events
      .flatMap(e => getEventInstances(e, addDays(now, 1), addDays(now, 7)))
      .filter(e => isAfter(parseISO(e.date), now) && !isSameDay(parseISO(e.date), now))
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
      .slice(0, 3),
    [events, todayKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dueTasks = tasks
    .filter(t => !t.isCompleted && t.dueDate && t.dueDate <= todayKey)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const openTaskCount = tasks.filter(t => !t.isCompleted).length;
  const pendingShopping = shoppingItems.filter(i => !i.isBought).length;

  const dueByPerson = [...new Set(dueTasks.map(t => t.assignee))]
    .sort()
    .map(person => ({ person, tasks: dueTasks.filter(t => t.assignee === person) }));

  const handleToggle = async (task: Task) => {
    try {
      await toggleTaskDoc(task);
    } catch (err) {
      console.error('Failed to toggle task:', err);
      try { handleFirestoreError(err, OperationType.UPDATE, `todos/${task.id}`); } catch (e) { /* throws */ }
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full p-4 md:p-8 space-y-6 pb-24">
        {/* Greeting hero */}
        <header className="pt-2">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">
            {format(now, 'EEEE, MMMM d')}
          </p>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mt-1">
            {greeting(now.getHours())}, {firstName}
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            {todaysEvents.length === 0 && dueTasks.length === 0
              ? 'Clear skies today — nothing scheduled and nothing due.'
              : `${todaysEvents.length} event${todaysEvents.length !== 1 ? 's' : ''} today · ${dueTasks.length} task${dueTasks.length !== 1 ? 's' : ''} due`}
          </p>
        </header>

        {error && (
          <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">{error}</div>
        )}

        {/* Today's events */}
        <section className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-4 md:p-5">
          <button onClick={() => onNavigate('calendar')} className="w-full flex items-center gap-2 mb-3 group">
            <CalendarIcon className="w-4 h-4 text-indigo-400" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex-1 text-left">Today's schedule</span>
            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
          </button>
          {todaysEvents.length === 0 ? (
            <p className="text-sm text-slate-600 italic px-1">Nothing on the calendar today</p>
          ) : (
            <div className="space-y-1">
              {todaysEvents.map(event => {
                const color = getEventColor(event.color);
                return (
                  <button
                    key={event.id}
                    onClick={() => onNavigate('calendar')}
                    className="w-full text-left flex gap-3 px-2 py-2 rounded-xl hover:bg-slate-900/70 transition-colors"
                  >
                    <div className={cn('w-1 self-stretch rounded-full shrink-0', color.accent)} />
                    <span className={cn('text-[11px] font-bold font-mono w-16 shrink-0 pt-0.5', color.text)}>
                      {formatToET(event.date, timeFormat)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                        {event.title}
                        {event.recurrence && event.recurrence !== 'none' && <RefreshCw className="w-3 h-3 text-slate-600 shrink-0" />}
                      </span>
                      {event.location && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="w-3 h-3" />{event.location}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Tasks due, by person */}
        <section className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-4 md:p-5">
          <button onClick={() => onNavigate('tasks')} className="w-full flex items-center gap-2 mb-3 group">
            <ListTodo className="w-4 h-4 text-violet-400" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex-1 text-left">Due today</span>
            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 transition-colors" />
          </button>
          {dueByPerson.length === 0 ? (
            <p className="text-sm text-slate-600 italic px-1">
              Nothing due today{openTaskCount > 0 ? ` — ${openTaskCount} open task${openTaskCount !== 1 ? 's' : ''} overall` : ''}
            </p>
          ) : (
            <div className="space-y-4">
              {dueByPerson.map(({ person, tasks: personTasks }) => (
                <div key={person}>
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <PersonAvatar person={person} size="sm" />
                    <span className={cn('text-xs font-black', personStyle(person).text)}>{person}</span>
                  </div>
                  <div className="space-y-1">
                    <AnimatePresence mode="popLayout">
                      {personTasks.map(task => (
                        <motion.div
                          layout
                          key={task.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-900/70 transition-colors"
                        >
                          <button onClick={() => handleToggle(task)} aria-label="Complete task" className="shrink-0">
                            <Circle className="w-[18px] h-[18px] text-slate-600 hover:text-emerald-500 transition-colors" />
                          </button>
                          <span className="text-sm font-bold text-slate-200 truncate flex-1">{task.title}</span>
                          {isRepeating(task) && <RefreshCw className="w-3 h-3 text-violet-400/70 shrink-0" />}
                          {task.dueDate && task.dueDate < todayKey && (
                            <span className="text-[9px] font-black uppercase text-red-400 bg-red-900/20 border border-red-500/30 px-1.5 py-0.5 rounded-md shrink-0">Overdue</span>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Shopping + coming up, side by side on wider screens */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => onNavigate('shopping')}
            className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-4 md:p-5 text-left hover:border-emerald-500/30 transition-all group"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex-1">Supplies</span>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 transition-colors" />
            </div>
            <p className="text-3xl font-black text-white tabular-nums">{pendingShopping}</p>
            <p className="text-xs text-slate-500 font-medium">item{pendingShopping !== 1 ? 's' : ''} needed</p>
          </button>

          <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Coming up</span>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-slate-600 italic">Quiet week ahead</p>
            ) : (
              <div className="space-y-1.5">
                {upcomingEvents.map(event => (
                  <button key={event.id} onClick={() => onNavigate('calendar')} className="w-full text-left group">
                    <p className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">{event.title}</p>
                    <p className={cn('text-[10px] font-bold uppercase tracking-wider', getEventColor(event.color).text)}>
                      {formatFullToET(event.date, timeFormat)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
