import React, { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, addDays, subDays } from 'date-fns';
import { getEventInstances } from '../lib/recurrence';
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Trash2, X, LayoutGrid, List as ListIcon, User as UserIcon, Edit2, RefreshCw, CalendarRange, Sparkles } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Event, RecurrenceType } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useSettings } from '../contexts/SettingsContext';
import { formatToET, formatFullToET, toETInputString, fromETInputString, getNowInET } from '../lib/timeUtils';
import { EVENT_COLOR_NAMES, EVENT_COLORS, getEventColor } from '../lib/eventColors';
import { QuickAddParse } from '../lib/quickAdd';
import QuickAddBar from './calendar/QuickAddBar';
import DayTicker from './calendar/DayTicker';
import MiniMonth from './calendar/MiniMonth';
import AgendaList from './calendar/AgendaList';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ViewMode = 'agenda' | 'week' | 'month';

const EMPTY_EVENT = () => ({
  title: '',
  description: '',
  location: '',
  color: 'indigo',
  date: new Date().toISOString(),
  recurrence: 'none' as RecurrenceType
});

export default function Calendar() {
  const { timeFormat } = useSettings();
  const [viewMode, setViewMode] = useState<ViewMode>('agenda');
  const [currentMonth, setCurrentMonth] = useState(getNowInET());
  const [weekStart, setWeekStart] = useState(getNowInET());
  const [selectedDate, setSelectedDate] = useState(getNowInET());
  const [events, setEvents] = useState<Event[]>([]);
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [newEvent, setNewEvent] = useState(EMPTY_EVENT());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(userRoot(), 'events'), orderBy('date', 'asc'));
    const source = 'calendar-events';
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      const eventList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Event));
      setEvents(eventList);
      setError(null);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error("Firestore onSnapshot error:", err);
      setError("Failed to load events. You might not have permission.");
      try {
        handleFirestoreError(err, OperationType.LIST, 'events');
      } catch (e) {
        // handleFirestoreError throws
      }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, []);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  // Monthly grid starts exactly on the 1st of the month
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const weeklyDays = eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6)
  });

  // One generous instance range covers every visible surface: mini month,
  // month grid, week columns, day ticker, and the 30-day agenda.
  const { allInstances, tickerDays, agendaEnd } = useMemo(() => {
    const tickerAnchor = startOfWeek(subDays(selectedDate, 7));
    const tickerDayList = eachDayOfInterval({ start: tickerAnchor, end: addDays(tickerAnchor, 34) });
    const agendaEndDate = addDays(selectedDate, 30);
    const starts = [startOfMonth(currentMonth), weekStart, tickerAnchor, selectedDate];
    const ends = [endOfMonth(currentMonth), addDays(weekStart, 6), addDays(tickerAnchor, 34), agendaEndDate];
    const rangeStart = new Date(Math.min(...starts.map(d => d.getTime())));
    const rangeEnd = new Date(Math.max(...ends.map(d => d.getTime())));
    return {
      allInstances: events.flatMap(event => getEventInstances(event, rangeStart, rangeEnd)),
      tickerDays: tickerDayList,
      agendaEnd: agendaEndDate,
    };
  }, [events, currentMonth, weekStart, selectedDate]);

  const selectedDateEvents = allInstances.filter(event => isSameDay(parseISO(event.date), selectedDate));

  const upcomingEvents = useMemo(() => allInstances
    .filter(event => {
      const date = parseISO(event.date);
      return date >= new Date() || isSameDay(date, new Date());
    })
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
    .slice(0, 5), [allInstances]);

  const selectDay = (day: Date) => {
    setSelectedDate(day);
    setCurrentMonth(day);
    const dateStr = format(day, "yyyy-MM-dd'T'09:00");
    setNewEvent(prev => ({ ...prev, date: fromETInputString(dateStr) }));
  };

  // Writes are local-first: with the persistent cache the doc is saved
  // on-device immediately and syncs when back online. Never await the server
  // ack in the UI — offline it never arrives, and awaiting it used to hang
  // the quick-add spinner and the event modal. Real rejections
  // (permission/validation) still surface via .catch into the error banner.
  const handleQuickAdd = async (parsed: QuickAddParse & { dateISO: string }) => {
    if (!auth.currentUser) return;
    setError(null);
    trackWrite(addDoc(collection(userRoot(), 'events'), {
      title: parsed.title,
      description: '',
      location: '',
      color: 'indigo',
      date: parsed.dateISO,
      recurrence: parsed.recurrence,
      createdBy: auth.currentUser.uid,
      authorName: auth.currentUser.displayName || 'Explorer',
      createdAt: new Date().toISOString()
    })).catch((err: any) => {
      console.error("Quick add failed:", err);
      setError("Failed to add event. You might not have permission.");
    });
    selectDay(parseISO(parsed.dateISO));
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newEvent.title.trim()) return;

    setError(null);
    const wasEditing = !!editingEvent;
    const onWriteError = (err: any) => {
      console.error("Failed to process event:", err);
      setError(err?.code === 'permission-denied' || err?.message?.includes('permission-denied')
        ? "Permission denied. You might not be authorized to perform this action."
        : `Failed to ${wasEditing ? 'update' : 'add'} event. You might not have permission.`);
    };

    const dateToSave = new Date(newEvent.date).toISOString();
    if (editingEvent) {
      // Update existing event (local-first; see handleQuickAdd)
      trackWrite(updateDoc(doc(userRoot(), 'events', editingEvent.id!), {
        title: newEvent.title,
        description: newEvent.description,
        location: newEvent.location,
        color: newEvent.color,
        date: dateToSave,
        recurrence: newEvent.recurrence,
        updatedAt: new Date().toISOString()
      })).catch(onWriteError);
    } else {
      // Add new event (local-first; see handleQuickAdd)
      trackWrite(addDoc(collection(userRoot(), 'events'), {
        title: newEvent.title,
        description: newEvent.description,
        location: newEvent.location,
        color: newEvent.color,
        date: dateToSave,
        recurrence: newEvent.recurrence,
        createdBy: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Explorer',
        createdAt: new Date().toISOString()
      })).catch(onWriteError);
    }
    setIsAddingEvent(false);
    setEditingEvent(null);
    setNewEvent(EMPTY_EVENT());
  };

  const handleEditClick = (event: Event) => {
    // If it's an instance, we edit the parent event
    const actualId = event.id?.split('-')[0];
    const actualEvent = events.find(e => e.id === actualId) || event;

    setEditingEvent(actualEvent);
    setNewEvent({
      title: actualEvent.title,
      description: actualEvent.description || '',
      location: actualEvent.location || '',
      color: actualEvent.color || 'indigo',
      date: actualEvent.date,
      recurrence: actualEvent.recurrence || 'none'
    });
    setIsAddingEvent(true);
  };

  const handleDeleteEvent = (id: string) => {
    const actualId = id.split('-')[0];
    // Local-first: the delete applies to the on-device cache immediately
    trackWrite(deleteDoc(doc(userRoot(), 'events', actualId))).catch(err => {
      console.error("Failed to delete event:", err);
      setError("Failed to delete event. You might not have permission.");
    });
  };

  const handlePrev = () => {
    if (viewMode === 'month') {
      setCurrentMonth(subMonths(currentMonth, 1));
    } else if (viewMode === 'week') {
      setWeekStart(subDays(weekStart, 7));
    } else {
      selectDay(subDays(selectedDate, 7));
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCurrentMonth(addMonths(currentMonth, 1));
    } else if (viewMode === 'week') {
      setWeekStart(addDays(weekStart, 7));
    } else {
      selectDay(addDays(selectedDate, 7));
    }
  };

  const handleToday = () => {
    const today = getNowInET();
    setCurrentMonth(today);
    setWeekStart(today);
    setSelectedDate(today);
    setNewEvent(prev => ({ ...prev, date: today.toISOString(), recurrence: 'none' }));
  };

  const todayET = getNowInET();
  const headerDate = viewMode === 'month' ? currentMonth : viewMode === 'week' ? weekStart : selectedDate;

  const viewTabs: { id: ViewMode; label: string; icon: typeof ListIcon }[] = [
    { id: 'agenda', label: 'Agenda', icon: ListIcon },
    { id: 'week', label: 'Week', icon: CalendarRange },
    { id: 'month', label: 'Month', icon: LayoutGrid },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      {/* Header */}
      <header className="bg-slate-900/60 backdrop-blur-xl px-4 md:px-6 py-3 flex flex-col gap-3 border-b border-slate-800/60 z-20 relative">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl md:text-2xl font-black tracking-tight text-white whitespace-nowrap min-w-0 truncate">
            {format(headerDate, 'MMMM')} <span className="text-indigo-400">{format(headerDate, 'yyyy')}</span>
          </h1>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handlePrev} aria-label="Previous" className="p-2 hover:bg-slate-800 rounded-full transition-colors active:scale-95">
              <ChevronLeft className="w-5 h-5 text-slate-400" />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase rounded-lg transition-colors border border-slate-700 tracking-wider"
            >
              Today
            </button>
            <button onClick={handleNext} aria-label="Next" className="p-2 hover:bg-slate-800 rounded-full transition-colors active:scale-95">
              <ChevronRight className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex bg-slate-950/70 p-1 rounded-xl border border-slate-800">
            {viewTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={cn(
                  "px-3 md:px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1.5 tracking-wider",
                  viewMode === tab.id ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <tab.icon className="w-3 h-3" /> <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setEditingEvent(null);
                setIsAddingEvent(true);
              }}
              aria-label="New event"
              className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors active:scale-95 shadow-lg shadow-indigo-900/20"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Desktop sidebar: mini month + upcoming */}
        <aside className="hidden lg:flex flex-col w-80 shrink-0 border-r border-slate-800/60 overflow-y-auto p-4 gap-6">
          <MiniMonth
            month={currentMonth}
            selectedDate={selectedDate}
            instances={allInstances}
            onMonthChange={setCurrentMonth}
            onSelect={selectDay}
          />

          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Upcoming</span>
              <div className="flex-1 h-px bg-indigo-900/20" />
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="px-1 text-xs text-slate-600 italic">Nothing scheduled yet</p>
            ) : (
              upcomingEvents.map(event => {
                const color = getEventColor(event.color);
                return (
                  <button
                    key={event.id}
                    onClick={() => selectDay(parseISO(event.date))}
                    className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:border-indigo-500/30 transition-all group"
                  >
                    <div className={cn('w-1 self-stretch rounded-full shrink-0', color.accent)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">{event.title}</p>
                      <p className={cn('text-[10px] font-bold uppercase tracking-wider mt-0.5', color.text)}>
                        {formatFullToET(event.date, timeFormat)}
                      </p>
                    </div>
                    {event.recurrence && event.recurrence !== 'none' && (
                      <RefreshCw className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 md:px-6 pt-4 space-y-2">
            {error && !isAddingEvent && (
              <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">
                {error}
              </div>
            )}
            <QuickAddBar
              onCreate={handleQuickAdd}
              resolveFallbackISO={() => fromETInputString(format(selectedDate, "yyyy-MM-dd'T'09:00"))}
              fallbackLabel={isSameDay(selectedDate, todayET) ? 'today' : format(selectedDate, 'MMM d')}
              timeFormat={timeFormat}
            />
            {viewMode === 'agenda' && (
              <div className="lg:hidden -mx-2">
                <DayTicker
                  days={tickerDays}
                  selectedDate={selectedDate}
                  instances={allInstances}
                  onSelect={selectDay}
                />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-10 pt-2">
            {viewMode === 'agenda' && (
              <AgendaList
                start={selectedDate}
                end={agendaEnd}
                instances={allInstances}
                timeFormat={timeFormat}
                onEventClick={handleEditClick}
              />
            )}

            {viewMode === 'week' && (
              <>
                {/* Desktop: Fantastical-style week columns */}
                <div className="hidden md:flex border border-slate-800/60 rounded-3xl overflow-hidden bg-slate-900/40 divide-x divide-slate-800/60">
                  {weeklyDays.map((day, idx) => {
                    const dayEvents = allInstances
                      .filter(e => isSameDay(parseISO(e.date), day))
                      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
                    const isSelected = isSameDay(day, selectedDate);
                    const isToday = isSameDay(day, todayET);

                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex-1 flex flex-col transition-all min-w-0",
                          isSelected && "bg-indigo-900/10",
                          isToday && "bg-indigo-950/20"
                        )}
                      >
                        <button
                          onClick={() => selectDay(day)}
                          className={cn(
                            "p-3 border-b border-slate-800/60 flex flex-col items-center justify-center gap-0.5 hover:bg-slate-800/50 transition-colors",
                            isToday && "border-b-indigo-500/50"
                          )}
                        >
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                            {format(day, 'EEE')}
                          </span>
                          <span className={cn(
                            "text-xl font-black tracking-tighter",
                            isToday ? "text-indigo-400" : isSelected ? "text-white" : "text-slate-400"
                          )}>
                            {format(day, 'd')}
                          </span>
                        </button>

                        <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[520px] scrollbar-hide">
                          {dayEvents.length > 0 ? (
                            dayEvents.map(event => {
                              const color = getEventColor(event.color);
                              return (
                                <button
                                  key={event.id}
                                  onClick={() => handleEditClick(event)}
                                  className="w-full text-left p-2.5 bg-slate-900/70 border border-slate-800 rounded-xl hover:border-indigo-500/30 transition-all group"
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className={cn("font-mono text-[9px] font-bold uppercase tracking-wider", color.text)}>
                                      {formatToET(event.date, timeFormat)}
                                    </span>
                                    <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', color.accent)} />
                                  </div>
                                  <div className="font-bold text-xs text-white leading-tight group-hover:text-indigo-300 transition-colors">
                                    {event.title}
                                  </div>
                                  {event.location && (
                                    <div className="flex items-center gap-1 text-[9px] text-slate-500 mt-1 truncate">
                                      <MapPin className="w-2.5 h-2.5 shrink-0" /> {event.location}
                                    </div>
                                  )}
                                </button>
                              );
                            })
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center py-8 opacity-10">
                              <div className="w-px h-8 bg-slate-500 mb-2" />
                              <span className="text-[8px] font-black uppercase tracking-[0.3em]">Free</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile: agenda for the week */}
                <div className="md:hidden">
                  <AgendaList
                    start={weekStart}
                    end={addDays(weekStart, 6)}
                    instances={allInstances}
                    timeFormat={timeFormat}
                    onEventClick={handleEditClick}
                  />
                </div>
              </>
            )}

            {viewMode === 'month' && (
              <div className="space-y-8">
                <div className="bg-slate-900/60 rounded-3xl shadow-2xl border border-slate-800/60 overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-slate-800">
                    {eachDayOfInterval({ start: monthStart, end: addDays(monthStart, 6) }).map(day => (
                      <div key={day.toString()} className="py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                        {format(day, 'EEE')}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, idx) => {
                      const dayEvents = allInstances.filter(e => isSameDay(parseISO(e.date), day));
                      const isSelected = isSameDay(day, selectedDate);

                      return (
                        <button
                          key={idx}
                          onClick={() => selectDay(day)}
                          className={cn(
                            "h-14 md:h-24 border-r border-b border-slate-800 flex flex-col items-center justify-start pt-2 transition-all relative group",
                            isSelected && "bg-indigo-900/20 ring-1 ring-inset ring-indigo-500/50 z-10"
                          )}
                        >
                          <span className={cn(
                            "w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-all",
                            isSelected ? "bg-indigo-600 text-white" : isSameDay(day, todayET) ? "text-indigo-400 font-black" : "text-slate-400 group-hover:text-white"
                          )}>
                            {format(day, 'd')}
                          </span>
                          <div className="flex flex-wrap gap-0.5 mt-1 px-1 justify-center">
                            {dayEvents.slice(0, 4).map((ev, i) => (
                              <div key={i} className={cn('w-1 h-1 rounded-full', getEventColor(ev.color).accent)} />
                            ))}
                            {dayEvents.length > 4 && <div className="w-1 h-1 rounded-full bg-slate-600" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected day detail */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-black text-white tracking-tighter">
                      {format(selectedDate, 'EEEE, MMMM do')}
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {selectedDateEvents.length === 0 ? (
                      <div className="col-span-full bg-slate-900/30 rounded-2xl p-8 text-center border border-dashed border-slate-800">
                        <p className="text-slate-500 text-sm font-medium">Nothing scheduled for this day</p>
                      </div>
                    ) : (
                      selectedDateEvents.map(event => {
                        const color = getEventColor(event.color);
                        return (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            key={event.id}
                            onClick={() => handleEditClick(event)}
                            className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800 shadow-sm flex items-start justify-between group hover:border-indigo-500/30 transition-all overflow-hidden cursor-pointer"
                          >
                            <div className="flex gap-3 min-w-0 flex-1">
                              <div className={cn('w-1 self-stretch rounded-full shrink-0', color.accent)} />
                              <div className={cn("w-12 h-12 rounded-xl flex flex-col items-center justify-center border flex-shrink-0", color.chip, color.text)}>
                                <Clock className="w-4 h-4" />
                                <span className="text-[9px] font-black uppercase mt-0.5">{formatToET(event.date, timeFormat)}</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-bold text-white truncate pr-2">{event.title}</h3>
                                  {event.recurrence && event.recurrence !== 'none' && (
                                    <RefreshCw className="w-3 h-3 text-indigo-500/50 shrink-0" />
                                  )}
                                </div>
                                {event.location && (
                                  <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                                    <MapPin className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{event.location}</span>
                                  </div>
                                )}
                                {event.description && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{event.description}</p>}
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center">
                                    <UserIcon className="w-2.5 h-2.5 text-slate-500" />
                                  </div>
                                  <span className="text-[9px] text-slate-500 font-black uppercase tracking-wider">
                                    {event.authorName}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEditClick(event); }}
                                className="p-2 text-slate-600 hover:text-indigo-400"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteEvent(event.id!); }}
                                className="p-2 text-slate-600 hover:text-red-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    {/* Add Event Modal */}
      <AnimatePresence>
        {isAddingEvent && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-slate-900 w-full max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl border border-slate-800 overflow-hidden max-h-[90dvh] flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
                <h3 className="text-xl font-bold text-white">
                  {editingEvent ? 'Update Mission' : 'New Galactic Event'}
                </h3>
                <button
                  onClick={() => {
                    setIsAddingEvent(false);
                    setEditingEvent(null);
                    setNewEvent(EMPTY_EVENT());
                  }}
                  className="p-2 hover:bg-slate-800 rounded-full"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {error && (
                <div className="mx-6 mt-4 p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium shrink-0">
                  {error}
                </div>
              )}

              <form onSubmit={handleAddEvent} className="p-6 space-y-4 overflow-y-auto">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Event Title</label>
                  <input
                    required
                    type="text"
                    maxLength={199}
                    placeholder="e.g., Starship Maintenance"
                    className="w-full bg-slate-950 border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={newEvent.title}
                    onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Date & Time</label>
                    <input
                      required
                      type="datetime-local"
                      className="w-full bg-slate-950 border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                      value={toETInputString(newEvent.date)}
                      onChange={e => {
                        setNewEvent({ ...newEvent, date: fromETInputString(e.target.value) });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recurrence</label>
                    <select
                      className="w-full bg-slate-950 border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                      value={newEvent.recurrence}
                      onChange={e => setNewEvent({ ...newEvent, recurrence: e.target.value as RecurrenceType })}
                    >
                      <option value="none">One-time</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="bi-monthly">Every 2 Months</option>
                      <option value="semi-annually">Semi-Annually</option>
                      <option value="annually">Annually</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" /> Location (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="e.g., Starbase Cafeteria"
                    className="w-full bg-slate-950 border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={newEvent.location}
                    onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Color</label>
                  <div className="flex gap-2 pt-1">
                    {EVENT_COLOR_NAMES.map(name => (
                      <button
                        type="button"
                        key={name}
                        aria-label={`${name} color`}
                        onClick={() => setNewEvent({ ...newEvent, color: name })}
                        className={cn(
                          'w-8 h-8 rounded-full transition-all',
                          EVENT_COLORS[name].accent,
                          newEvent.color === name
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                            : 'opacity-50 hover:opacity-100'
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Description (Optional)</label>
                  <textarea
                    maxLength={5000}
                    placeholder="Add mission details..."
                    className="w-full bg-slate-950 border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all min-h-[80px]"
                    value={newEvent.description}
                    onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                  />
                </div>

                <div className="flex gap-3 mt-4">
                  {editingEvent && (
                    <button
                      type="button"
                      onClick={() => {
                        const isRecurring = editingEvent.recurrence && editingEvent.recurrence !== 'none';
                        if (!confirm(isRecurring ? 'Delete this event and all of its repeats?' : 'Delete this event?')) return;
                        // Local-first: fire the delete and close immediately
                        handleDeleteEvent(editingEvent.id!);
                        setIsAddingEvent(false);
                        setEditingEvent(null);
                        setNewEvent(EMPTY_EVENT());
                      }}
                      className="px-5 py-4 bg-red-900/20 border border-red-500/30 text-red-400 font-bold rounded-2xl hover:bg-red-900/40 transition-colors flex items-center justify-center"
                      aria-label="Delete event"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!newEvent.title.trim()}
                    className="flex-1 bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {editingEvent ? 'Update Mission' : 'Confirm Mission'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
