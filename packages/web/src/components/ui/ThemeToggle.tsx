import React from 'react';
import { Sun, Moon, Laptop, LucideIcon } from 'lucide-react';
import { useTheme, Theme } from '../../context/ThemeContext.js';

export const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const options: { id: Theme; icon: LucideIcon; label: string }[] = [
    { id: 'light', icon: Sun, label: 'Light' },
    { id: 'dark', icon: Moon, label: 'Dark' },
    { id: 'system', icon: Laptop, label: 'System' },
  ];

  return (
    <div className="flex items-center p-0.5 rounded-lg bg-zinc-200 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => setTheme(opt.id)}
            title={`Switch to ${opt.label} Mode`}
            className={`p-1.5 rounded-md text-xs font-medium transition-all ${
              isActive
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
};
