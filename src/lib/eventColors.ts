// Fantastical-style calendar colors. Tailwind needs literal class names,
// so each palette entry spells out its full classes.
export interface EventColorClasses {
  accent: string; // solid dot / bar
  text: string;
  chip: string; // subtle tinted chip background + border
}

export const EVENT_COLOR_NAMES = ['indigo', 'sky', 'emerald', 'amber', 'rose', 'violet'] as const;

export const EVENT_COLORS: Record<string, EventColorClasses> = {
  indigo: { accent: 'bg-indigo-500', text: 'text-indigo-400', chip: 'bg-indigo-900/20 border-indigo-500/20' },
  sky: { accent: 'bg-sky-500', text: 'text-sky-400', chip: 'bg-sky-900/20 border-sky-500/20' },
  emerald: { accent: 'bg-emerald-500', text: 'text-emerald-400', chip: 'bg-emerald-900/20 border-emerald-500/20' },
  amber: { accent: 'bg-amber-500', text: 'text-amber-400', chip: 'bg-amber-900/20 border-amber-500/20' },
  rose: { accent: 'bg-rose-500', text: 'text-rose-400', chip: 'bg-rose-900/20 border-rose-500/20' },
  violet: { accent: 'bg-violet-500', text: 'text-violet-400', chip: 'bg-violet-900/20 border-violet-500/20' },
};

export function getEventColor(name?: string): EventColorClasses {
  return EVENT_COLORS[name ?? ''] ?? EVENT_COLORS.indigo;
}
