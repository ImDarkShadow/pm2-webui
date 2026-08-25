import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  showWordmark?: boolean;
  collapsed?: boolean;
  vertical?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  size = 36,
  className = '',
  showWordmark = false,
  collapsed = false,
  vertical = false,
}) => {
  return (
    <div
      className={`flex items-center ${
        vertical ? 'flex-col items-center text-center gap-3' : 'gap-2.5'
      } ${className}`}
    >
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {/* Light theme logo */}
        <img
          src="/logo-light.svg"
          alt="PM2 UI Logo"
          className="w-full h-full object-contain block dark:hidden select-none transition-transform duration-150"
        />
        {/* Dark theme logo */}
        <img
          src="/logo-dark.svg"
          alt="PM2 UI Logo"
          className="w-full h-full object-contain hidden dark:block select-none transition-transform duration-150"
        />
      </div>

      {showWordmark && !collapsed && (
        <div className="flex flex-col min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              PM2
            </span>
            <span className="text-xs font-semibold px-1.5 py-0.2 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 font-mono border border-sky-500/20">
              UI
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium tracking-wide">
            Cluster Manager
          </span>
        </div>
      )}
    </div>
  );
};
