import React from 'react';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const normalized = status.toLowerCase();

  let bgClass = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let dotClass = 'bg-zinc-400';

  if (normalized === 'online' || normalized === 'direct') {
    bgClass = 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60';
    dotClass = 'bg-emerald-400';
  } else if (normalized === 'stopped' || normalized === 'offline') {
    bgClass = 'bg-zinc-900 text-zinc-400 border-zinc-800';
    dotClass = 'bg-zinc-500';
  } else if (normalized === 'errored' || normalized === 'revoked' || normalized === 'rejected') {
    bgClass = 'bg-rose-950/60 text-rose-300 border-rose-800/60';
    dotClass = 'bg-rose-400';
  } else if (
    normalized === 'pending' ||
    normalized === 'stopping' ||
    normalized === 'launching' ||
    normalized === 'relay'
  ) {
    bgClass = 'bg-amber-950/60 text-amber-300 border-amber-800/60';
    dotClass = 'bg-amber-400';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${bgClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {status}
    </span>
  );
};
