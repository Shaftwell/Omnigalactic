import React from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Event } from '../../types';
import { getEventColor } from '../../lib/eventColors';
import { getNowInET } from '../../lib/timeUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MiniMonthProps {
  month: Date;
  selectedDate: Date;
  instances: Event[];
  onMonthChange: (month: Date) => void;
  onSelect: (day: Date) => void;
}

export default function MiniMonth({ month, selectedDate, instances, onMonthChange, onSelect }: MiniMonthProps) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = getNowInET();

  return (
    <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-black text-white tracking-tight pl-1">
          {format(month, 'MMMM')} <span className="text-indigo-400">{format(month, 'yyyy')}</span>
        </span>
        <div className="flex items-center">
          <button onClick={() => onMonthChange(subMonths(month, 1))} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          </button>
          <button onClick={() => onMonthChange(addMonths(month, 1))} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-black text-slate-600 uppercase py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map(day => {
          const dayEvents = instances.filter(e => isSameDay(parseISO(e.date), day));
          const inMonth = isSameMonth(day, month);
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              className="flex flex-col items-center group"
            >
              <span className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold transition-all',
                isSelected ? 'bg-indigo-600 text-white shadow-md'
                  : isToday ? 'text-indigo-400 font-black ring-1 ring-indigo-500/40'
                  : inMonth ? 'text-slate-300 group-hover:bg-slate-800'
                  : 'text-slate-700 group-hover:text-slate-500'
              )}>
                {format(day, 'd')}
              </span>
              <div className="h-1.5 flex items-center">
                {dayEvents.length > 0 && (
                  <div className={cn('w-1 h-1 rounded-full', isSelected ? 'bg-white/70' : getEventColor(dayEvents[0].color).accent)} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
