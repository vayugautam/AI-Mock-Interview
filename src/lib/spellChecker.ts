// Technical & general English vocabulary dictionary and typo corrector

const COMMON_TYPOS: Record<string, string> = {
  teh: 'the',
  taht: 'that',
  waht: 'what',
  nad: 'and',
  adn: 'and',
  recat: 'react',
  raect: 'react',
  javascrip: 'javascript',
  javscript: 'javascript',
  typscript: 'typescript',
  typescrit: 'typescript',
  databse: 'database',
  datbase: 'database',
  dtabase: 'database',
  postres: 'postgres',
  postgre: 'postgres',
  mongdb: 'mongodb',
  redsi: 'redis',
  dokcer: 'docker',
  kubernets: 'kubernetes',
  kuberenetes: 'kubernetes',
  kuberntes: 'kubernetes',
  microserivce: 'microservice',
  microservce: 'microservice',
  archtecture: 'architecture',
  archetecture: 'architecture',
  architechture: 'architecture',
  experiance: 'experience',
  experence: 'experience',
  perfomance: 'performance',
  perfromance: 'performance',
  performence: 'performance',
  optmize: 'optimize',
  optomize: 'optimize',
  optmization: 'optimization',
  responsve: 'responsive',
  compenent: 'component',
  compnent: 'component',
  functon: 'function',
  funtion: 'function',
  fucntion: 'function',
  asnyc: 'async',
  asyn: 'async',
  awiat: 'await',
  promse: 'promise',
  promis: 'promise',
  scalibility: 'scalability',
  scalablity: 'scalability',
  intergration: 'integration',
  integraton: 'integration',
  dependancy: 'dependency',
  depandency: 'dependency',
  seperate: 'separate',
  seperated: 'separated',
  definately: 'definitely',
  definitly: 'definitely',
  neccessary: 'necessary',
  necesary: 'necessary',
  acheive: 'achieve',
  achive: 'achieve',
  recieved: 'received',
  recive: 'receive',
  occurance: 'occurrence',
  occured: 'occurred',
  enviornment: 'environment',
  enviroment: 'environment',
  algoritm: 'algorithm',
  algorithim: 'algorithm',
  authntication: 'authentication',
  authorizaton: 'authorization',
  concurrency: 'concurrency',
  concurrancy: 'concurrency',
  latancy: 'latency',
  thruput: 'throughput',
  throuput: 'throughput',
  frntend: 'frontend',
  bakend: 'backend',
  frotend: 'frontend',
  modul: 'module',
  impliment: 'implement',
  implmentation: 'implementation',
  exicute: 'execute',
  excecute: 'execute',
  paramater: 'parameter',
  paramaters: 'parameters',
  synchrounous: 'synchronous',
  asynchrounous: 'asynchronous',
  mispelled: 'misspelled',
  mispell: 'misspell',
  becuase: 'because',
  beacuse: 'because',
  alot: 'a lot',
  untill: 'until',
  wich: 'which',
  wierd: 'weird',
  peice: 'piece',
};

// Comprehensive list of common technical & standard words
const VALID_WORDS = new Set([
  // Programming & Tech
  'react', 'next', 'nextjs', 'vue', 'angular', 'svelte', 'javascript', 'typescript', 'python',
  'golang', 'go', 'rust', 'c', 'cpp', 'java', 'kotlin', 'swift', 'ruby', 'php', 'sql', 'nosql',
  'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'dynamodb', 'cassandra', 'kafka',
  'rabbitmq', 'docker', 'kubernetes', 'k8s', 'helm', 'terraform', 'aws', 'gcp', 'azure',
  'serverless', 'lambda', 'graphql', 'rest', 'restful', 'grpc', 'http', 'https', 'tcp', 'udp',
  'api', 'apis', 'sdk', 'sdks', 'cli', 'ci', 'cd', 'cicd', 'github', 'gitlab', 'git',
  'microservices', 'microservice', 'monolith', 'monorepo', 'frontend', 'backend', 'fullstack',
  'full', 'stack', 'devops', 'sysadmin', 'architecture', 'architect', 'component', 'components',
  'state', 'props', 'hook', 'hooks', 'redux', 'zustand', 'mobx', 'recoil', 'context',
  'dom', 'vdom', 'jsx', 'tsx', 'html', 'css', 'tailwind', 'sass', 'scss', 'postcss',
  'vite', 'webpack', 'esbuild', 'babel', 'turbopack', 'rollup', 'node', 'nodejs', 'deno', 'bun',
  'express', 'nest', 'nestjs', 'fastify', 'django', 'flask', 'fastapi', 'spring', 'boot',
  'concurrency', 'concurrency', 'multithreading', 'async', 'await', 'promise', 'promises',
  'event', 'events', 'loop', 'callback', 'callbacks', 'observable', 'observables', 'stream',
  'streams', 'buffer', 'socket', 'sockets', 'websocket', 'webrtc', 'polling', 'webhook',
  'cache', 'caching', 'cdn', 'redis', 'memcached', 'latency', 'throughput', 'bandwidth',
  'load', 'balancer', 'balancing', 'proxy', 'reverse', 'nginx', 'traefik', 'envoy',
  'sharding', 'replication', 'indexing', 'index', 'btree', 'acid', 'cap', 'theorem',
  'authentication', 'authorization', 'oauth', 'oauth2', 'jwt', 'token', 'tokens', 'session',
  'cookie', 'cookies', 'cors', 'csrf', 'xss', 'rbac', 'abac', 'sso', 'saml', 'oidc',
  'test', 'tests', 'testing', 'jest', 'vitest', 'cypress', 'playwright', 'unit', 'integration',
  'e2e', 'tdd', 'bdd', 'coverage', 'mock', 'mocks', 'stub', 'stubs', 'benchmark',
  'profiling', 'memory', 'leak', 'garbage', 'collection', 'scalability', 'scalable', 'scale',
  'fault', 'tolerance', 'resilience', 'circuit', 'breaker', 'rate', 'limiting', 'throttling',
  'agile', 'scrum', 'kanban', 'sprint', 'jira', 'review', 'pr', 'pull', 'request',
  'deploy', 'deployment', 'canary', 'blue', 'green', 'rollback', 'observability', 'monitoring',
  'metrics', 'logging', 'tracing', 'datadog', 'prometheus', 'grafana', 'opentelemetry',
  // Common conversational and interviewing words
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now',
  'system', 'project', 'team', 'service', 'client', 'server', 'data', 'user', 'users',
  'code', 'work', 'worked', 'working', 'built', 'build', 'building', 'developed', 'develop',
  'designed', 'design', 'implemented', 'implement', 'solved', 'solving', 'optimized',
  'optimize', 'managed', 'manage', 'leading', 'lead', 'improved', 'improve', 'reduced',
  'reduce', 'created', 'create', 'ensured', 'ensure', 'experience', 'experienced', 'handle',
  'handled', 'handling', 'production', 'high', 'low', 'large', 'small', 'fast', 'slow',
  'first', 'second', 'third', 'key', 'main', 'primary', 'major', 'critical', 'approach',
  'strategy', 'solution', 'solutions', 'problem', 'problems', 'challenge', 'challenges',
  'issue', 'issues', 'bug', 'bugs', 'error', 'errors', 'failure', 'failures', 'traffic',
  'request', 'requests', 'response', 'responses', 'query', 'queries', 'table', 'tables',
  'schema', 'model', 'models', 'controller', 'view', 'route', 'routes', 'router',
  'performance', 'scalability', 'security', 'reliability', 'availability', 'efficiency',
  'maintainability', 'readability', 'clean', 'structure', 'structured', 'layer', 'layers',
  'flow', 'pipeline', 'process', 'step', 'steps', 'decision', 'decisions', 'tradeoff',
  'tradeoffs', 'choice', 'choices', 'example', 'case', 'scenario', 'practice', 'practices',
  'pattern', 'patterns', 'standard', 'standards', 'production', 'environment', 'infrastructure',
  'database', 'databases', 'frontend', 'backend', 'fullstack', 'architecture', 'framework',
]);

// Levenshtein distance for fuzzy matching
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[bLen][aLen];
}

export interface SpellingIssue {
  word: string;
  suggestion: string;
  index: number;
}

export function checkSpelling(text: string): SpellingIssue[] {
  if (!text || text.trim().length === 0) return [];

  // Match words, ignoring standalone punctuation and numbers
  const wordRegex = /\b[A-Za-z][A-Za-z0-9_-]*\b/g;
  const issues: SpellingIssue[] = [];
  const seenWords = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(text)) !== null) {
    const rawWord = match[0];
    const lowerWord = rawWord.toLowerCase();

    // Skip pure numbers or single letters
    if (lowerWord.length <= 1) continue;

    // Skip already checked words to avoid spamming the same typo
    if (seenWords.has(lowerWord)) continue;

    // Check if directly valid
    if (VALID_WORDS.has(lowerWord)) continue;

    // Check if plural or past-tense ends with 's', 'ed', 'ing'
    if (lowerWord.endsWith('s') && VALID_WORDS.has(lowerWord.slice(0, -1))) continue;
    if (lowerWord.endsWith('es') && VALID_WORDS.has(lowerWord.slice(0, -2))) continue;
    if (lowerWord.endsWith('ed') && (VALID_WORDS.has(lowerWord.slice(0, -1)) || VALID_WORDS.has(lowerWord.slice(0, -2)))) continue;
    if (lowerWord.endsWith('ing') && (VALID_WORDS.has(lowerWord.slice(0, -3)) || VALID_WORDS.has(lowerWord.slice(0, -3) + 'e'))) continue;

    // 1. Direct typo dictionary match
    if (COMMON_TYPOS[lowerWord]) {
      seenWords.add(lowerWord);
      issues.push({
        word: rawWord,
        suggestion: COMMON_TYPOS[lowerWord],
        index: match.index,
      });
      continue;
    }

    // 2. Fuzzy Levenshtein match for words of length >= 4
    if (lowerWord.length >= 4) {
      let closestWord = '';
      let minDistance = 3; // only accept distance 1 or 2

      for (const valid of VALID_WORDS) {
        if (Math.abs(valid.length - lowerWord.length) > 2) continue;
        const dist = levenshteinDistance(lowerWord, valid);
        if (dist < minDistance) {
          minDistance = dist;
          closestWord = valid;
          if (dist === 1) break; // close enough
        }
      }

      if (closestWord && minDistance <= 2) {
        seenWords.add(lowerWord);
        issues.push({
          word: rawWord,
          suggestion: closestWord,
          index: match.index,
        });
      }
    }
  }

  return issues;
}

export function replaceWord(text: string, typo: string, correction: string): string {
  // Regex word boundary replace
  const regex = new RegExp(`\\b${escapeRegExp(typo)}\\b`, 'g');
  return text.replace(regex, (match) => {
    // Preserve initial capitalization if present
    if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
      return correction.charAt(0).toUpperCase() + correction.slice(1);
    }
    return correction;
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
