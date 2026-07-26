import React, { useEffect, useRef } from 'react';
import { format, isSameDay, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Event } from '../../types';
import { getEventColor } from '../../lib/eventColors';
import { getNowInET } from '../../lib/timeUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DayTickerProps {
  days: Date[];
  selectedDate: Date;
  instances: Event[];
  onSelect: (day: Date) => void;
}

export default function DayTicker({ days, selectedDate, instances, onSelect }: DayTickerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const today = getNowInET();

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedDate]);

  return (
    <div ref={scrollerRef} className="flex gap-1 overflow-x-auto no-scrollbar snap-x px-1 py-1">
      {days.map(day => {
        const dayEvents = instances.filter(e => isSameDay(parseISO(e.date), day));
        const isSelected = isSameDay(day, selectedDate);
        const isToday = isSameDay(day, today);

        return (
          <button
            key={day.toISOString()}
            ref={isSelected ? selectedRef : undefined}
            onClick={() => onSelect(day)}
            className={cn(
              'flex flex-col items-center gap-1 w-12 shrink-0 snap-center py-2 rounded-2xl transition-all',
              isSelected ? 'bg-indigo-600/15 ring-1 ring-indigo-500/40' : 'hover:bg-slate-800/50'
            )}
          >
            <span className={cn(
              'text-[8px] font-black uppercase tracking-widest',
              isToday ? 'text-indigo-400' : 'text-slate-500'
            )}>
              {format(day, 'EEE')}
            </span>
            <span className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold transition-all',
              isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                : isToday ? 'text-indigo-400 font-black'
                : 'text-slate-300'
            )}>
              {format(day, 'd')}
            </span>
            <div className="flex gap-0.5 h-1 items-center">
              {dayEvents.slice(0, 3).map((ev, i) => (
                <div key={i} className={cn('w-1 h-1 rounded-full', getEventColor(ev.color).accent)} />
              ))}
              {dayEvents.length > 3 && <div className="w-1 h-1 rounded-full bg-slate-600" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
