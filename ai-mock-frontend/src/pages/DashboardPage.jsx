import { BarChart3, CheckCircle2, ClipboardList, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDashboardProgress, fetchDashboardSummary } from '../api/interviews';
import { formatDate, formatScore } from '../lib/utils';
import { useAuth } from '../context/AuthContext';

const statCards = [
  { key: 'total_interviews', label: 'Total interviews', icon: ClipboardList },
  { key: 'completed_interviews', label: 'Completed', icon: CheckCircle2 },
  { key: 'total_answered_questions', label: 'Questions answered', icon: Sparkles },
  { key: 'average_overall_score', label: 'Average score', icon: BarChart3 },
];

export default function DashboardPage() {
  const { user, token, loading: authLoading } = useAuth();
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !token) {
      setLoading(authLoading);
      return;
    }

    async function loadDashboard() {
      try {
        const [summaryResponse, progressResponse] = await Promise.all([
          fetchDashboardSummary(),
          fetchDashboardProgress(),
        ]);
        setSummary(summaryResponse);
        setProgress(progressResponse.progress || []);
      } catch (err) {
        setError(err.message || 'Unable to load dashboard.');
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [authLoading, token]);

  if (authLoading || loading) return <div className="shell empty-state">Loading dashboard…</div>;
  if (error) return <div className="shell error-box">{error}</div>;

  return (
    <div className="page-stack">
      <header className="panel hero-panel">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}</h2>
        </div>
        <Link to="/interview/new" className="primary-button">Start a new mock interview</Link>
      </header>

      <section className="stats-grid">
        {statCards.map(({ key, label, icon: Icon }) => (
          <article key={key} className="stat-card">
            <div className="icon-wrap"><Icon size={18} /></div>
            <div>
              <p className="eyebrow">{label}</p>
              <strong>
                {summary?.[key] === null || summary?.[key] === undefined
                  ? '—'
                  : key === 'average_overall_score'
                    ? `${formatScore(summary[key])} / 10`
                    : summary[key]}
              </strong>
            </div>
          </article>
        ))}
      </section>

      <section className="panel two-column-layout">
        <div>
          <h3>Recent interviews</h3>
          {!summary?.recent_interviews?.length ? (
            <div className="empty-state">No interviews yet. Start your first mock interview to get insights.</div>
          ) : (
            <ul className="list-stack">
              {summary.recent_interviews.map((interview) => (
                <li key={interview.id} className="list-row">
                  <div>
                    <strong>{interview.role}</strong>
                    <p>{interview.interview_type} • {interview.difficulty}</p>
                  </div>
                  <div className="badge-row">
                    <span className="status-badge">{interview.status}</span>
                    <span>{formatDate(interview.created_at)}</span>
                    <Link
                      className="text-link"
                      to={interview.status === 'completed' ? `/results/${interview.id}` : `/interview/${interview.id}`}
                    >
                      {interview.status === 'completed' ? 'View results' : 'Continue'}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Your progress</h3>
          {!progress.length ? (
            <div className="empty-state">No evaluation history available yet.</div>
          ) : (
            <div className="chart-card">
              {progress.map((entry, index) => (
                <div key={`${entry.answer_id}-${index}`} className="chart-bar-wrap">
                  <div className="chart-bar" style={{ height: `${Math.max(18, Number(entry.overall_score))}%` }} />
                  <span>{formatDate(entry.evaluated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
