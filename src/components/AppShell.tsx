import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const onDashboard = location.pathname === '/dashboard';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
          <Link
            to="/dashboard"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Mock Interview
          </Link>

          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link
              to="/dashboard"
              className={`whitespace-nowrap shrink-0 transition-colors ${
                onDashboard
                  ? 'text-slate-900 underline underline-offset-4 decoration-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dashboard
            </Link>
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            {user && (
              <span className="hidden sm:inline text-sm text-slate-600 truncate max-w-[180px]">
                {user.name}
              </span>
            )}
            <button
              type="button"
              onClick={logout}
              className="px-3.5 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
