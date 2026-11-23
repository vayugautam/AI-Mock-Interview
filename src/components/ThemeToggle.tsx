import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
      return document.documentElement.classList.contains('dark');
    }
    return true;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hidden sm:inline select-none">
        {isDark ? 'Dark' : 'Bright'}
      </span>

      {/* Slide Bar */}
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        onClick={() => setIsDark(!isDark)}
        title={isDark ? 'Switch to Bright Mode' : 'Switch to Dark Mode'}
        className="relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/50 p-0.5 shadow-inner"
      >
        <span className="sr-only">Toggle Dark and Bright mode</span>

        {/* Sliding Thumb */}
        <span
          className={`pointer-events-none flex h-6 w-6 transform items-center justify-center rounded-full bg-white dark:bg-slate-900 shadow-md ring-0 transition duration-200 ease-in-out ${
            isDark ? 'translate-x-7' : 'translate-x-0'
          }`}
        >
          {isDark ? (
            <Moon className="h-3.5 w-3.5 text-indigo-400" />
          ) : (
            <Sun className="h-3.5 w-3.5 text-amber-500" />
          )}
        </span>
      </button>
    </div>
  );
};
