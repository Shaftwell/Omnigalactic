import { CheckCircle2, Cloud, RefreshCw, WifiOff } from 'lucide-react';
import { useSyncStatus } from '../lib/syncStatus';

interface SyncStatusIndicatorProps {
  compact?: boolean;
}

export default function SyncStatusIndicator({ compact = false }: SyncStatusIndicatorProps) {
  const status = useSyncStatus();
  const Icon = status.phase === 'offline'
    ? WifiOff
    : status.phase === 'syncing'
      ? RefreshCw
      : status.phase === 'connecting'
        ? Cloud
        : CheckCircle2;
  const colors = status.phase === 'offline'
    ? 'border-amber-500/30 bg-amber-950/40 text-amber-300'
    : status.phase === 'syncing'
      ? 'border-sky-500/30 bg-sky-950/40 text-sky-300'
      : status.phase === 'connecting'
        ? 'border-slate-600/60 bg-slate-950/50 text-slate-400'
        : 'border-emerald-500/25 bg-emerald-950/30 text-emerald-400';

  return (
    <div
      data-sync-status={status.phase}
      role="status"
      aria-live="polite"
      title={status.detail}
      className={`flex items-center border ${colors} ${compact
        ? 'gap-1.5 rounded-full px-2 py-1'
        : 'gap-2.5 rounded-2xl px-3 py-2.5'}`}
    >
      <Icon className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 ${status.phase === 'syncing' ? 'animate-spin' : ''}`} />
      <div className="min-w-0">
        <p className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-black uppercase tracking-wider whitespace-nowrap`}>
          {status.label}
        </p>
        {!compact && <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">{status.detail}</p>}
      </div>
    </div>
  );
}
