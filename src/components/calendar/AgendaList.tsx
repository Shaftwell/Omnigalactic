import React from 'react';
import { format, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Event, TimeFormat } from '../../types';
import { getEventColor } from '../../lib/eventColors';
import { formatToET, getNowInET } from '../../lib/timeUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AgendaListProps {
  start: Date;
  end: Date;
  instances: Event[];
  timeFormat: TimeFormat;
  onEventClick: (event: Event) => void;
}

function dayLabel(day: Date, today: Date): string {
  if (isSameDay(day, today)) return 'Today';
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(day, tomorrow)) return 'Tomorrow';
  return format(day, 'MMM d');
}

export default function AgendaList({ start, end, instances, timeFormat, onEventClick }: AgendaListProps) {
  const today = getNowInET();
  const days = eachDayOfInterval({ start, end });

  const groups = days
    .map(day => ({
      day,
      events: instances
        .filter(e => isSameDay(parseISO(e.date), day))
        .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime()),
    }))
    .filter(g => g.events.length > 0 || isSameDay(g.day, today));

  if (groups.length === 0) {
    return (
      <div className="py-16 text-center space-y-2">
        <Sparkles className="w-6 h-6 text-slate-700 mx-auto" />
        <p className="text-sm font-medium text-slate-500">Nothing on the horizon</p>
        <p className="text-xs text-slate-600">Type above to add an event — try "Movie night Friday 7pm"</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map(({ day, events }) => {
        const isToday = isSameDay(day, today);
        return (
          <section key={day.toISOString()}>
            <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-md py-2 flex items-baseline gap-2 border-b border-slate-800/40">
              <span className={cn(
                'text-sm font-black uppercase tracking-wider',
                isToday ? 'text-indigo-400' : 'text-white'
              )}>
                {dayLabel(day, today)}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                {format(day, 'EEEE')}
              </span>
            </div>

            <div className="py-1">
              {events.length === 0 ? (
                <p className="px-1 py-3 text-xs text-slate-600 italic">Nothing scheduled — enjoy the void</p>
              ) : (
                events.map(event => {
                  const color = getEventColor(event.color);
                  return (
                    <motion.button
                      key={event.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => onEventClick(event)}
                      className="w-full text-left flex gap-3 px-1 py-2.5 rounded-xl hover:bg-slate-900/60 active:bg-slate-900/80 transition-colors group"
                    >
                      <div className={cn('w-1 self-stretch rounded-full shrink-0', color.accent)} />
                      <div className="w-16 shrink-0 pt-0.5">
                        <span className={cn('text-[11px] font-bold font-mono', color.text)}>
                          {formatToET(event.date, timeFormat)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white truncate group-hover:text-indigo-300 transition-colors">
                            {event.title}
                          </span>
                          {event.recurrence && event.recurrence !== 'none' && (
                            <RefreshCw className="w-3 h-3 text-slate-600 shrink-0" />
                          )}
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{event.location}</span>
                          </div>
                        )}
                        {event.description && (
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{event.description}</p>
                        )}
                      </div>
                    </motion.button>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
