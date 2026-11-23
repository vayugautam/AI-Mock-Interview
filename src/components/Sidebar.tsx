import React from 'react';
import { User } from '../types';
import {
  FileText,
  MessageSquareText,
  BarChart3,
  Database,
  FlaskConical,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

export type AppTab = 'configure' | 'interview' | 'analytics' | 'knowledge' | 'validation';

interface SidebarProps {
  user: User;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onLogout: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeTab,
  setActiveTab,
  onLogout,
  isOpenMobile,
  onCloseMobile,
}) => {
  const navItems: Array<{
    id: AppTab;
    label: string;
    description: string;
    icon: React.ElementType;
  }> = [
    {
      id: 'configure',
      label: 'Interview Setup',
      description: 'JD PDF/Text & Resume setup',
      icon: FileText,
    },
    {
      id: 'interview',
      label: 'Interview Studio',
      description: 'Text Q&A & AI rubric',
      icon: MessageSquareText,
    },
    {
      id: 'analytics',
      label: 'Analytics & History',
      description: 'Score trends & session reports',
      icon: BarChart3,
    },
    {
      id: 'knowledge',
      label: 'Knowledge Base (D1)',
      description: 'Curated Q&A & vector index',
      icon: Database,
    },
    {
      id: 'validation',
      label: 'Validation Benchmark',
      description: 'Early vs. late fusion metrics',
      icon: FlaskConical,
    },
  ];

  return (
    <>
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-transform duration-200 lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Brand */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              AI
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-slate-900 dark:text-white tracking-tight truncate">
                AI Mock Interview
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                JD & Resume Interview Platform
              </p>
            </div>
          </div>
        </div>

        {/* Profile & Navigation */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
              <span className="truncate max-w-[140px]">
                {user.targetField || 'No target JD set'}
              </span>
              <span className="capitalize font-mono font-medium text-indigo-600 dark:text-indigo-400">
                {user.interviewType || 'mixed'} · {user.difficulty || 'medium'}
              </span>
            </div>
          </div>

          <nav className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-3 block mb-2">
              Workspace Modules
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full p-3 rounded-xl flex items-center space-x-3 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate whitespace-nowrap">{item.label}</p>
                    <p
                      className={`text-[11px] truncate ${
                        isActive ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer Disclaimer & Sign Out */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug px-1">
            Academic project for learning and practice only. Not a hiring or certification tool.
          </p>
          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-medium transition-colors flex items-center justify-center space-x-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};
