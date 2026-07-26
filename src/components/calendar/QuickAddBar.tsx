import React, { useState, useMemo, useRef } from 'react';
import { Sparkles, CalendarClock, RefreshCw, CalendarOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { parseQuickAdd, QuickAddParse } from '../../lib/quickAdd';
import { formatFullToET } from '../../lib/timeUtils';
import { TimeFormat } from '../../types';

interface QuickAddBarProps {
  // Receives the parse with dateISO already resolved (never null)
  onCreate: (parsed: QuickAddParse & { dateISO: string }) => Promise<void>;
  // Used when the text contains no recognizable date
  resolveFallbackISO: () => string;
  fallbackLabel: string;
  timeFormat: TimeFormat;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  'bi-monthly': 'Every 2 months',
  'semi-annually': 'Every 6 months',
  annually: 'Yearly',
};

export default function QuickAddBar({ onCreate, resolveFallbackISO, fallbackLabel, timeFormat }: QuickAddBarProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text]);
  const canSubmit = !!parsed?.title && !busy;

  const handleSubmit = async () => {
    if (!parsed?.title || busy) return;
    setBusy(true);
    try {
      await onCreate({ ...parsed, dateISO: parsed.dateISO ?? resolveFallbackISO() });
      setText('');
      inputRef.current?.focus();
    } catch {
      // Creation failed — keep the text so nothing is lost; Calendar surfaces the error
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 bg-slate-900/70 backdrop-blur-sm border border-slate-700/60 rounded-2xl px-4 py-3 focus-within:border-indigo-500/60 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
        <Sparkles className="w-5 h-5 text-indigo-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          // The rules cap event titles below 200 chars; the date fragment is
          // stripped from the input, so the parsed title can only be shorter.
          maxLength={199}
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder='Quick add — try "Dinner with Mom Friday at 6pm"'
          className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-slate-600 min-w-0 disabled:opacity-50"
        />
        <AnimatePresence>
          {text.trim() && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Add
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Live parse preview */}
      <AnimatePresence>
        {parsed?.title && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 pt-2 px-1">
              <span className="text-xs font-bold text-white truncate max-w-[14rem]">{parsed.title}</span>
              {parsed.dateISO ? (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-900/30 border border-indigo-500/20 px-2 py-1 rounded-full">
                  <CalendarClock className="w-3 h-3" />
                  {parsed.hasTime
                    ? formatFullToET(parsed.dateISO, timeFormat)
                    : `${format(new Date(parsed.dateISO), 'MMM d')} · 9:00 AM`}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-900/20 border border-amber-500/20 px-2 py-1 rounded-full">
                  <CalendarOff className="w-3 h-3" />
                  No date — using {fallbackLabel}
                </span>
              )}
              {parsed.recurrence !== 'none' && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-300 bg-violet-900/20 border border-violet-500/20 px-2 py-1 rounded-full">
                  <RefreshCw className="w-3 h-3" />
                  {RECURRENCE_LABELS[parsed.recurrence]}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
