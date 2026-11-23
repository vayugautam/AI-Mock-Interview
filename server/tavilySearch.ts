import type { JobDescriptionAnalysis, WebResearchSource } from '../src/types';

export async function searchRecentInterviewExperiences(
  jd: JobDescriptionAnalysis
): Promise<{ summary: string; sources: WebResearchSource[] } | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 1);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const company = jd.companyName && jd.companyName.toLowerCase() !== 'unknown' ? jd.companyName : '';
  const role = jd.jobTitle || 'software engineering';
  const skills = [...jd.requiredTechnicalSkills, ...jd.toolsAndTechnologies].slice(0, 4).join(' ');
  const query = `recent candidate interview experience ${company} ${role} interview questions rounds ${skills} past year`;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      topic: 'general',
      search_depth: 'advanced',
      max_results: 6,
      start_date: date(start),
      end_date: date(now),
      include_published_date: true,
      filter_by_published_date: true,
      include_raw_content: false,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`Tavily search returned HTTP ${response.status}: ${payload.detail?.error || payload.error || response.statusText}`);

  const results = Array.isArray(payload.results) ? payload.results : [];
  const sources: WebResearchSource[] = results
    .filter((item: any) => typeof item.url === 'string' && /^https?:\/\//.test(item.url))
    .slice(0, 6)
    .map((item: any) => ({
      title: String(item.title || item.url).slice(0, 200),
      uri: item.url,
      publishedAt: typeof item.published_date === 'string' ? item.published_date : undefined,
    }));
  const summary = results.slice(0, 6).map((item: any, index: number) => {
    const source = sources[index];
    if (!source) return '';
    const published = source.publishedAt ? `; published ${source.publishedAt}` : '; publication date not provided';
    return `${index + 1}. ${source.title}${published}\n${String(item.content || '').slice(0, 700)}\nSource: ${source.uri}`;
  }).filter(Boolean).join('\n\n').slice(0, 5000);

  if (!summary || sources.length === 0) return null;
  return { summary, sources };
}
