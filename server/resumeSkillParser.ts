type SkillEntry = { name: string; aliases: string[] };

// Deterministic resume-text skill extraction. The LLM analysis is still used for
// projects and context; this vocabulary prevents an empty LLM skills field from
// erasing technologies that are plainly present in the source document.
const SKILLS: SkillEntry[] = [
  { name: 'Python', aliases: ['python'] }, { name: 'Java', aliases: ['java'] },
  { name: 'JavaScript', aliases: ['javascript', 'js'] }, { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'C++', aliases: ['c++'] }, { name: 'C#', aliases: ['c#', 'c sharp'] }, { name: 'C', aliases: ['c language', 'programming in c'] },
  { name: 'Go', aliases: ['golang'] }, { name: 'Rust', aliases: ['rust'] }, { name: 'PHP', aliases: ['php'] },
  { name: 'Kotlin', aliases: ['kotlin'] }, { name: 'Swift', aliases: ['swift'] }, { name: 'Ruby', aliases: ['ruby'] },
  { name: 'SQL', aliases: ['sql'] }, { name: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', aliases: ['mysql'] }, { name: 'MongoDB', aliases: ['mongodb', 'mongo db'] },
  { name: 'SQLite', aliases: ['sqlite'] }, { name: 'Redis', aliases: ['redis'] },
  { name: 'React', aliases: ['react', 'react.js', 'reactjs'] }, { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Node.js', aliases: ['node.js', 'nodejs', 'node js'] }, { name: 'Express.js', aliases: ['express.js', 'expressjs', 'express'] },
  { name: 'FastAPI', aliases: ['fastapi', 'fast api'] }, { name: 'Django', aliases: ['django'] }, { name: 'Flask', aliases: ['flask'] },
  { name: 'HTML', aliases: ['html'] }, { name: 'CSS', aliases: ['css'] }, { name: 'Tailwind CSS', aliases: ['tailwind css', 'tailwind'] },
  { name: 'REST APIs', aliases: ['rest api', 'restful api', 'rest apis'] }, { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'Git', aliases: ['git'] }, { name: 'GitHub', aliases: ['github'] }, { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] }, { name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { name: 'Microsoft Azure', aliases: ['azure'] }, { name: 'Google Cloud', aliases: ['google cloud', 'gcp'] },
  { name: 'Figma', aliases: ['figma'] }, { name: 'Data Structures & Algorithms', aliases: ['data structures', 'algorithms', 'dsa'] },
  { name: 'Object-Oriented Programming', aliases: ['object-oriented programming', 'object oriented programming', 'oop'] },
  { name: 'DBMS', aliases: ['dbms', 'database management systems'] },
  { name: 'Operating Systems', aliases: ['operating systems', 'operating system', ' os '] },
  { name: 'Computer Networks', aliases: ['computer networks', 'computer networking'] },
  { name: 'System Design', aliases: ['system design'] }, { name: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { name: 'Deep Learning', aliases: ['deep learning'] }, { name: 'Natural Language Processing', aliases: ['natural language processing', 'nlp'] },
  { name: 'Large Language Models', aliases: ['large language models', 'large language model', 'llms', 'llm'] },
  { name: 'Retrieval-Augmented Generation', aliases: ['retrieval-augmented generation', 'retrieval augmented generation', 'rag'] },
  { name: 'Prompt Engineering', aliases: ['prompt engineering'] }, { name: 'Vector Databases', aliases: ['vector database', 'vector databases'] },
  { name: 'TensorFlow', aliases: ['tensorflow'] }, { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'scikit-learn', aliases: ['scikit-learn', 'sklearn'] }, { name: 'Pandas', aliases: ['pandas'] }, { name: 'NumPy', aliases: ['numpy'] },
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractResumeSkills(text: string): string[] {
  const corpus = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const detected = new Set<string>();
  for (const skill of SKILLS) {
    if (skill.aliases.some((alias) => {
      const pattern = escapeRegex(alias.trim()).replace(/\\\s+/g, '\\s+');
      return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`, 'i').test(corpus);
    })) detected.add(skill.name);
  }
  return [...detected];
}
