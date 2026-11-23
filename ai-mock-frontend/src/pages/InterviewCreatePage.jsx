import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createInterview, fetchCompanyResearch, fetchMyResume } from '../api/interviews';

const roleOptions = [
  'Backend Engineer',
  'Frontend Engineer',
  'Platform Engineer',
  'Data Engineer',
  'Software Development Engineer (SDE)',
  'AI Engineer',
];
const difficultyOptions = ['beginner', 'intermediate', 'advanced'];
const interviewTypeOptions = ['technical', 'behavioral', 'mixed'];

export default function InterviewCreatePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    role: roleOptions[0],
    difficulty: difficultyOptions[1],
    interview_type: interviewTypeOptions[0],
    company_name: '',
    country_region: '',
    job_description_url: '',
    job_description_text: '',
    number_of_questions: 5,
  });
  const [resume, setResume] = useState(null);
  const [research, setResearch] = useState(null);
  const [researchStatus, setResearchStatus] = useState('idle');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof fetchMyResume === 'function') {
      fetchMyResume().then(setResume).catch(() => setResume(null));
    }
  }, []);

  useEffect(() => {
    if (!form.company_name.trim() || !form.role.trim()) {
      setResearch(null);
      setResearchStatus('idle');
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setResearchStatus('loading');
      try {
        const result = await fetchCompanyResearch({
          company_name: form.company_name.trim(),
          target_role: form.role.trim(),
          country_region: form.country_region || undefined,
          job_description_url: form.job_description_url || undefined,
          job_description_text: form.job_description_text || undefined,
        });
        if (active) {
          setResearch(result);
          setResearchStatus(result.cache_status === 'cached' ? 'cached' : result.cache_status === 'stale' ? 'stale' : 'loaded');
        }
      } catch {
        if (active) {
          setResearch(null);
          setResearchStatus('unavailable');
        }
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form.company_name, form.role, form.country_region, form.job_description_url, form.job_description_text]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, value]) => value !== ''),
      );
      if (payload.number_of_questions === 5) delete payload.number_of_questions;
      if (resume) payload.resume_id = resume.id;
      const response = await createInterview(payload);
      navigate(`/interview/${response.id}`);
    } catch (err) {
      setError(err.message || 'Unable to create interview.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack narrow-page">
      <header className="panel hero-panel">
        <div>
          <p className="eyebrow">Interview setup</p>
          <h2>Set the room</h2>
          <p>Choose a focus and we’ll shape the conversation around it.</p>
        </div>
      </header>

      <form className="panel stacked-form" onSubmit={handleSubmit}>
        <label htmlFor="role">
          <span>Target role</span>
          <select id="role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            {roleOptions.map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
        </label>

        <label htmlFor="difficulty">
          <span>Difficulty</span>
          <select id="difficulty" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>
            {difficultyOptions.map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
        </label>

        <label htmlFor="interview-type">
          <span>Interview type</span>
          <select id="interview-type" value={form.interview_type} onChange={(event) => setForm({ ...form, interview_type: event.target.value })}>
            {interviewTypeOptions.map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
        </label>

        <label htmlFor="company-name">
          <span>Company (optional)</span>
          <input id="company-name" value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} />
        </label>

        <label htmlFor="country-region">
          <span>Country or region (optional)</span>
          <input id="country-region" value={form.country_region} onChange={(event) => setForm({ ...form, country_region: event.target.value })} />
        </label>

        <label htmlFor="job-description-url">
          <span>Official job description URL (optional)</span>
          <input id="job-description-url" type="url" value={form.job_description_url} onChange={(event) => setForm({ ...form, job_description_url: event.target.value })} />
        </label>

        <label htmlFor="job-description-text">
          <span>Job description text (optional)</span>
          <textarea id="job-description-text" rows="4" value={form.job_description_text} onChange={(event) => setForm({ ...form, job_description_text: event.target.value })} />
        </label>

        <label htmlFor="number-of-questions">
          <span>Number of questions</span>
          <select id="number-of-questions" value={form.number_of_questions} onChange={(event) => setForm({ ...form, number_of_questions: Number(event.target.value) })}>
            {[3, 5, 7, 10].map((option) => <option value={option} key={option}>{option}</option>)}
          </select>
        </label>

        {resume && <p className="muted-text">Using resume: {resume.original_filename}</p>}

        {form.company_name && (
          <div className="research-status" aria-live="polite">
            <div className="status-line">
              <span className="eyebrow">Company research</span>
              <span className={`status-badge ${researchStatus === 'unavailable' ? 'muted' : 'success'}`}>
                {researchStatus === 'loading' ? 'Fetching sources…'
                  : researchStatus === 'cached' ? 'Loaded from cache'
                    : researchStatus === 'stale' ? 'Cached · may be stale'
                      : researchStatus === 'loaded' ? 'Sources loaded'
                        : researchStatus === 'unavailable' ? 'Unavailable'
                          : 'Waiting'}
              </span>
            </div>
            {research && (
              <>
                <p>{research.researched_at ? `Retrieved ${new Date(research.researched_at).toLocaleString()}` : 'Research timestamp unavailable.'}</p>
                {research.sources?.length > 0 && (
                  <ul className="source-list">
                    {research.sources.slice(0, 3).map((source) => (
                      <li key={`${source.url || source.title}-${source.retrieved_at}`}>
                        {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'Creating interview…' : 'Create interview'}
        </button>
      </form>
    </div>
  );
}
