import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { api, getStoredToken, removeStoredToken } from './lib/api';
import type { User } from './types';
import { AuthPage } from './components/AuthPage';
import { Sidebar, type AppTab } from './components/Sidebar';
import { ConfigureInterview, type GeneratedSessionPayload } from './components/ConfigureInterview';
import { InterviewRoom } from './components/InterviewRoom';
import { InterviewReport } from './components/InterviewReport';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { KnowledgeBasePanel } from './components/KnowledgeBasePanel';
import { ValidationBenchmarkPanel } from './components/ValidationBenchmarkPanel';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AppTab>('configure');
  const [isOpenMobile, setIsOpenMobile] = useState(false);
  const [session, setSession] = useState<GeneratedSessionPayload | null>(null);
  const [reportInterviewId, setReportInterviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!getStoredToken()) {
      setAuthLoading(false);
      return;
    }
    let cancelled = false;
    api.getMe()
      .then(({ user: currentUser }) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {
        removeStoredToken();
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleLogout = () => {
    removeStoredToken();
    setUser(null);
    setSession(null);
    setReportInterviewId(null);
    setActiveTab('configure');
  };

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Loading your workspace…</div>;
  }

  if (!user) {
    return <AuthPage onAuthSuccess={setUser} />;
  }

  const handleSessionGenerated = (nextSession: GeneratedSessionPayload, updatedUser: User) => {
    setUser(updatedUser);
    setSession(nextSession);
    setReportInterviewId(null);
    setActiveTab('interview');
  };

  const content = (() => {
    if (activeTab === 'configure') {
      return <ConfigureInterview user={user} onSessionGenerated={handleSessionGenerated} />;
    }
    if (activeTab === 'interview') {
      if (reportInterviewId) {
        return <InterviewReport
          interviewId={reportInterviewId}
          onRetake={() => { setReportInterviewId(null); setActiveTab('configure'); }}
          onGoToDashboard={() => { setReportInterviewId(null); setActiveTab('analytics'); }}
        />;
      }
      return <InterviewRoom
        user={user}
        sessionPayload={session}
        onInterviewFinished={(id) => setReportInterviewId(id)}
        onExit={() => setActiveTab('configure')}
      />;
    }
    if (activeTab === 'analytics') {
      return <AnalyticsDashboard
        user={user}
        onSelectInterview={(id) => { setReportInterviewId(id); setActiveTab('interview'); }}
        onConfigureNew={() => setActiveTab('configure')}
      />;
    }
    if (activeTab === 'knowledge') return <KnowledgeBasePanel />;
    return <ValidationBenchmarkPanel />;
  })();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        user={user}
        activeTab={activeTab}
        setActiveTab={(tab) => { setActiveTab(tab); setIsOpenMobile(false); }}
        onLogout={handleLogout}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
      />
      <div className="min-h-screen lg:pl-72">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 lg:hidden">
          <button type="button" aria-label={isOpenMobile ? 'Close menu' : 'Open menu'} onClick={() => setIsOpenMobile((open) => !open)} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-900">
            {isOpenMobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-sm font-semibold">TalentPulse AI</span>
        </header>
        <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">{content}</div>
        </main>
      </div>
    </div>
  );
}
