import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

export interface StoredKnowledgeChunk {
  id: string;
  subject: string;
  interviewType: 'technical' | 'behavioural';
  difficulty: 'junior' | 'intermediate' | 'senior' | 'lead' | 'easy' | 'medium' | 'hard';
  question: string;
  referenceAnswer: string;
  expectedConcepts: string[];
  rubricFocus: string;
  embedding: number[];
  embeddingSource: 'gemini-embedding-2' | 'lexical-projection';
  createdBy: string;
  createdAt: string;
  scope?: 'global' | 'user_doc';
  userId?: string;
  docId?: string;
  docType?: 'jd' | 'resume';
}

export interface AnnotatedValidationSample {
  id: string;
  subject: string;
  interviewType: 'technical' | 'behavioural';
  question: string;
  referenceAnswer: string;
  expectedConcepts: string[];
  candidateAnswer: string;
  qualityTier: 'Strong' | 'Average' | 'Weak' | 'Off-Topic';
  humanScoreOutOf10: number;
  humanBand: 'Needs Improvement' | 'Satisfactory' | 'Good' | 'Excellent';
  deliverySample?: {
    speakingRateWpm: number;
    pauseFrequencyPerMin: number;
    fillerWordCount: number;
    durationSeconds: number;
  };
}

const SEED_CHUNKS: Array<Omit<StoredKnowledgeChunk, 'embedding' | 'embeddingSource' | 'createdAt'>> = [
  // DSA
  {
    id: 'kb_dsa_1',
    subject: 'Data Structures & Algorithms',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'Explain how a Hash Table handles collisions using Separate Chaining vs. Open Addressing, and compare their time complexities.',
    referenceAnswer:
      'A hash table maps keys to bucket indices via a hash function. When two keys hash to the same index, separate chaining stores a linked list or balanced tree at each bucket, giving O(1) average lookup and graceful degradation under high load factors. Open addressing keeps all entries inside the array itself using probing sequences like linear probing, quadratic probing, or double hashing, improving CPU cache locality but suffering from clustering and requiring resizing when load factor exceeds ~0.7.',
    expectedConcepts: ['hash function', 'separate chaining', 'open addressing', 'load factor', 'O(1) average', 'clustering', 'cache locality'],
    rubricFocus: 'Accuracy of collision strategies, load-factor trade-off, and Big-O complexity.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_dsa_2',
    subject: 'Data Structures & Algorithms',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'Compare Breadth-First Search (BFS) and Depth-First Search (DFS) on graphs, including space complexity and real-world use cases.',
    referenceAnswer:
      'BFS explores neighbors level-by-level using a FIFO queue, guaranteeing the shortest path in unweighted graphs. Its time complexity is O(V + E) and worst-case space is O(V) for the queue. DFS explores deeply along each branch before backtracking using recursion or an explicit stack, also in O(V + E) time and O(H) stack space. BFS suits shortest-path routing and web crawling, while DFS excels at cycle detection, topological sorting, and connected components.',
    expectedConcepts: ['queue', 'stack', 'shortest path', 'unweighted graph', 'O(V + E)', 'topological sort', 'cycle detection'],
    rubricFocus: 'Data structure choice (queue vs stack), Big-O bounds, and shortest-path guarantee.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_dsa_3',
    subject: 'Data Structures & Algorithms',
    interviewType: 'technical',
    difficulty: 'senior',
    question: 'When should you choose Dynamic Programming over a Greedy algorithm? Illustrate with the 0/1 Knapsack problem vs. Fractional Knapsack.',
    referenceAnswer:
      'Greedy algorithms make locally optimal choices at each step without reconsidering previous states, working only when the greedy-choice property holds—as in Fractional Knapsack where items can be split by value-to-weight ratio. Dynamic Programming is required when subproblems overlap and optimal substructure depends on exploring multiple choices, as in 0/1 Knapsack where taking an item changes remaining capacity discretely, requiring a DP table of O(N*W) states.',
    expectedConcepts: ['optimal substructure', 'overlapping subproblems', 'greedy-choice property', '0/1 knapsack', 'memoization', 'time-space trade-off'],
    rubricFocus: 'Clear contrast between greedy-choice property and overlapping subproblems.',
    createdBy: 'Curator Team (D1)',
  },

  // DBMS
  {
    id: 'kb_dbms_1',
    subject: 'Database Management Systems',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'Explain the ACID properties of relational database transactions with concrete examples.',
    referenceAnswer:
      'ACID stands for Atomicity, Consistency, Isolation, and Durability. Atomicity ensures all operations in a transaction succeed or roll back together (e.g., debiting one bank account and crediting another). Consistency guarantees transitions preserve schema constraints and invariants. Isolation prevents concurrent transactions from corrupting each other using locks or MVCC. Durability ensures committed writes survive crashes via write-ahead logging (WAL).',
    expectedConcepts: ['atomicity', 'consistency', 'isolation', 'durability', 'rollback', 'MVCC', 'write-ahead log'],
    rubricFocus: 'Complete explanation of all four ACID pillars with transaction safety mechanisms.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_dbms_2',
    subject: 'Database Management Systems',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'Why do relational databases use B+ Trees instead of Hash Indexes or standard Binary Search Trees for indexing?',
    referenceAnswer:
      'B+ Trees keep data balanced with high fanout, minimizing disk I/O depth to O(log_B N). Unlike standard B-Trees, B+ Trees store all row pointers in leaf nodes linked sequentially, enabling fast range queries (BETWEEN, ORDER BY) alongside point lookups. Hash indexes support O(1) equality checks but cannot accelerate range scans or prefix sorting, while binary trees have high depth and poor disk-block locality.',
    expectedConcepts: ['B+ Tree', 'fanout', 'disk I/O', 'leaf nodes', 'range queries', 'hash index', 'locality'],
    rubricFocus: 'Disk block fanout, linked leaves for range scans, and contrast with hash indexing.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_dbms_3',
    subject: 'Database Management Systems',
    interviewType: 'technical',
    difficulty: 'senior',
    question: 'Explain database isolation levels (Read Committed, Repeatable Read, Serializable) and the anomalies they prevent.',
    referenceAnswer:
      'Isolation levels trade concurrency against read anomalies. Read Uncommitted allows dirty reads. Read Committed prevents dirty reads by reading only committed snapshots but allows non-repeatable reads. Repeatable Read guarantees identical rows across repeated reads within a transaction, though phantom rows may appear unless gap locks or snapshot isolation are used. Serializable provides strict equivalent serial execution, preventing dirty, non-repeatable, and phantom reads at higher locking/retry cost.',
    expectedConcepts: ['dirty read', 'non-repeatable read', 'phantom read', 'read committed', 'repeatable read', 'serializable', 'snapshot isolation'],
    rubricFocus: 'Mapping isolation levels to specific concurrency anomalies and overhead.',
    createdBy: 'Curator Team (D1)',
  },

  // Operating Systems
  {
    id: 'kb_os_1',
    subject: 'Operating Systems',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'What is the difference between a Process and a Thread, and why is thread context switching faster?',
    referenceAnswer:
      'A process is an isolated program instance with its own virtual address space, file descriptors, and PCB. A thread is the smallest unit of CPU execution inside a process, sharing heap memory, code, and open files with sibling threads while maintaining its own stack and registers. Thread context switches are faster because they avoid flushing the TLB or switching page tables across virtual address spaces.',
    expectedConcepts: ['virtual address space', 'shared heap', 'private stack', 'registers', 'context switch', 'TLB', 'page table'],
    rubricFocus: 'Memory sharing vs isolation and hardware cost of TLB/page table switches.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_os_2',
    subject: 'Operating Systems',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'State the four Coffman conditions for a Deadlock and explain practical prevention or avoidance techniques.',
    referenceAnswer:
      'Deadlock requires four simultaneous conditions: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. Prevention breaks at least one condition—most practically Circular Wait by imposing a strict global lock ordering. Avoidance uses algorithms like Banker’s Algorithm to verify safe allocation states, while production OS kernels typically rely on lock ordering, timeouts, or deadlock detection and recovery.',
    expectedConcepts: ['mutual exclusion', 'hold and wait', 'no preemption', 'circular wait', 'lock ordering', 'Banker algorithm'],
    rubricFocus: 'Exact 4 Coffman conditions and realistic prevention strategies.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_os_3',
    subject: 'Operating Systems',
    interviewType: 'technical',
    difficulty: 'senior',
    question: 'Explain Virtual Memory, Paging, Page Faults, and how Thrashing occurs in an operating system.',
    referenceAnswer:
      'Virtual memory maps process virtual addresses to physical RAM frames via multi-level page tables accelerated by the TLB. When a referenced page is absent from RAM, the MMU triggers a page fault interrupt so the OS loads it from swap/disk. Thrashing occurs when active working sets exceed physical RAM, causing constant page faults, disk I/O saturation, and plunging CPU utilization; OSes mitigate it via working-set tracking or suspending processes.',
    expectedConcepts: ['page table', 'TLB', 'MMU', 'page fault', 'working set', 'thrashing', 'swap'],
    rubricFocus: 'Address translation flow, page fault trap handling, and cause/mitigation of thrashing.',
    createdBy: 'Curator Team (D1)',
  },

  // Computer Networks
  {
    id: 'kb_cn_1',
    subject: 'Computer Networks',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'Compare TCP and UDP across reliability, connection setup, overhead, and typical application protocols.',
    referenceAnswer:
      'TCP is connection-oriented, establishing state via a 3-way handshake (SYN, SYN-ACK, ACK) and guaranteeing ordered, lossless delivery through sequence numbers, ACKs, retransmissions, flow control, and congestion control (used in HTTP, SSH, databases). UDP is connectionless with minimal 8-byte header overhead and no retransmission guarantees, prioritizing low latency for DNS queries, VoIP, video streaming, and online gaming.',
    expectedConcepts: ['3-way handshake', 'connection-oriented', 'retransmission', 'congestion control', 'low latency', 'DNS', 'streaming'],
    rubricFocus: 'Clear comparison of handshake, reliability mechanisms, header overhead, and use cases.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_cn_2',
    subject: 'Computer Networks',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'Walk through every network step that occurs from typing a URL in a browser to receiving the HTTPS response.',
    referenceAnswer:
      'The browser parses the URL and resolves the hostname via browser/OS cache and recursive DNS lookup (root, TLD, authoritative nameservers) to obtain an IP address. It establishes a TCP 3-way handshake on port 443, followed by a TLS handshake verifying certificates and negotiating symmetric session keys. Next, it sends an encrypted HTTP GET request, the server responds with status and HTML payload, and the browser renders the DOM.',
    expectedConcepts: ['DNS resolution', 'TCP handshake', 'TLS handshake', 'certificate verification', 'HTTP request', 'port 443', 'DOM rendering'],
    rubricFocus: 'End-to-end chronological accuracy across DNS, TCP, TLS, and HTTP.',
    createdBy: 'Curator Team (D1)',
  },

  // OOP
  {
    id: 'kb_oop_1',
    subject: 'Object-Oriented Programming',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'Explain compile-time vs. runtime Polymorphism and how method overriding works internally.',
    referenceAnswer:
      'Compile-time (static) polymorphism is resolved during compilation via method or operator overloading based on signature types. Runtime (dynamic) polymorphism occurs when a subclass overrides a base class method and a base reference invokes the derived implementation at runtime. Languages like C++ implement dynamic dispatch using a virtual method table (vtable) and per-object vptr lookup.',
    expectedConcepts: ['method overloading', 'method overriding', 'dynamic dispatch', 'vtable', 'compile-time', 'runtime', 'inheritance'],
    rubricFocus: 'Distinction between static overloading and dynamic dispatch mechanics.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_oop_2',
    subject: 'Object-Oriented Programming',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'Explain the Dependency Inversion Principle (DIP) and Interface Segregation Principle (ISP) from SOLID with an example.',
    referenceAnswer:
      'Dependency Inversion states that high-level business modules should not depend directly on low-level implementation details; both should depend on abstractions (interfaces), enabling dependency injection and easy testing. Interface Segregation states that clients should not be forced to depend on bloated interfaces with unused methods—splitting a fat Worker interface into smaller cohesive capabilities keeps implementations clean.',
    expectedConcepts: ['abstraction', 'dependency injection', 'high-level modules', 'decoupling', 'cohesive interfaces', 'SOLID'],
    rubricFocus: 'Accurate definition and practical decoupling example for DIP and ISP.',
    createdBy: 'Curator Team (D1)',
  },

  // Web Development
  {
    id: 'kb_web_1',
    subject: 'Web Development',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'How does React reconciliation work, and why are stable keys important when rendering dynamic lists?',
    referenceAnswer:
      'React maintains a lightweight representation of the UI tree (Fiber tree) and compares the previous and next render trees during reconciliation. Using element types and keys, it computes minimal DOM mutations rather than rebuilding whole subtrees. Stable unique IDs as keys allow React to match reordered, inserted, or deleted list items accurately; using array indices causes state corruption and unnecessary re-renders when order changes.',
    expectedConcepts: ['reconciliation', 'Fiber tree', 'diffing', 'stable keys', 'array index pitfall', 'DOM mutations'],
    rubricFocus: 'Explanation of tree diffing and state-preservation issues with index keys.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_web_2',
    subject: 'Web Development',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'Compare session-based cookie authentication vs. stateless JWT authentication, including XSS and CSRF trade-offs.',
    referenceAnswer:
      'Session authentication stores state in server memory/Redis and issues an opaque session ID inside an HttpOnly cookie, making instant revocation easy. Stateless JWTs embed signed claims (Header.Payload.Signature) verified without a DB hit, scaling horizontally but making early revocation harder until expiry. HttpOnly cookies protect tokens from XSS JavaScript access but require SameSite/CSRF tokens, whereas localStorage tokens avoid CSRF but are vulnerable to XSS.',
    expectedConcepts: ['HttpOnly cookie', 'JWT signature', 'stateless', 'revocation', 'XSS', 'CSRF', 'SameSite'],
    rubricFocus: 'Security vectors (XSS vs CSRF) and horizontal scaling vs revocation trade-offs.',
    createdBy: 'Curator Team (D1)',
  },

  // AI / ML Basics
  {
    id: 'kb_aiml_1',
    subject: 'AI / ML Basics',
    interviewType: 'technical',
    difficulty: 'intermediate',
    question: 'What is Retrieval-Augmented Generation (RAG), and how do vector embeddings prevent LLM hallucinations?',
    referenceAnswer:
      'RAG augments a generative language model with an external retrieval pipeline. Curated documents are split into chunks, encoded into dense semantic vectors via an embedding model, and indexed in a vector database. At query time, the prompt is embedded and nearest-neighbor cosine similarity retrieves top-K relevant context chunks, grounding the LLM prompt in verifiable domain knowledge rather than parametric memory alone.',
    expectedConcepts: ['chunking', 'vector embeddings', 'cosine similarity', 'top-K retrieval', 'context grounding', 'hallucination reduction'],
    rubricFocus: 'Step-by-step indexing and retrieval flow and grounding benefit.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_aiml_2',
    subject: 'AI / ML Basics',
    interviewType: 'technical',
    difficulty: 'junior',
    question: 'Explain the Bias-Variance Trade-off and how Overfitting differs from Underfitting.',
    referenceAnswer:
      'Bias is error from overly simplistic model assumptions, causing underfitting where training and validation errors are both high. Variance is sensitivity to small fluctuations in training data, causing overfitting where training error is very low but validation error spikes. Balancing model complexity, adding training data, applying L1/L2 regularization, or using dropout reduces variance without inflating bias.',
    expectedConcepts: ['bias', 'variance', 'underfitting', 'overfitting', 'generalization', 'regularization', 'cross-validation'],
    rubricFocus: 'Diagnostic difference between training/validation error and mitigation methods.',
    createdBy: 'Curator Team (D1)',
  },

  // HR & Behavioural (STAR)
  {
    id: 'kb_hr_1',
    subject: 'HR & Behavioural',
    interviewType: 'behavioural',
    difficulty: 'junior',
    question: 'Tell me about a time you faced a tight deadline or unexpected bug during a project. How did you handle it using the STAR method?',
    referenceAnswer:
      'A strong STAR answer clearly frames the Situation (context and stakes), Task (your specific responsibility), Action (concrete steps you personally took—debugging, prioritizing, communicating blockers early), and Result (measurable outcome and lesson learned, such as shipping on time with automated regression tests added).',
    expectedConcepts: ['situation', 'task', 'action', 'result', 'ownership', 'communication', 'outcome'],
    rubricFocus: 'Completeness of STAR structure, personal agency, and measurable learning outcome.',
    createdBy: 'Curator Team (D1)',
  },
  {
    id: 'kb_hr_2',
    subject: 'HR & Behavioural',
    interviewType: 'behavioural',
    difficulty: 'intermediate',
    question: 'Describe a disagreement with a teammate on a technical or design decision. How did you resolve it constructively?',
    referenceAnswer:
      'Highlight the Situation and Task objectively without blaming. Describe Actions focused on active listening, gathering benchmark data or prototypes to evaluate both options against shared project goals, and agreeing on a pragmatic compromise. Close with the Result showing stronger team alignment and system outcome.',
    expectedConcepts: ['situation', 'active listening', 'data-driven', 'compromise', 'team alignment', 'result'],
    rubricFocus: 'Constructive conflict resolution, empathy, objective criteria, and STAR clarity.',
    createdBy: 'Curator Team (D1)',
  },

  // Full Stack Development
  {
    id: 'kb_fs_1',
    subject: 'Full Stack Development',
    interviewType: 'technical',
    difficulty: 'senior',
    question: 'How would you optimize a slow full-stack web endpoint experiencing high database read load and slow client rendering?',
    referenceAnswer:
      'Diagnose end-to-end with profiling and query plans (EXPLAIN ANALYZE). On the backend, eliminate N+1 queries, add composite B-Tree indexes, introduce Redis cache-aside with TTL/invalidation, and paginate payloads. On the network/frontend, enable gzip/Brotli compression, HTTP caching headers, code-splitting, and memoized/virtualized list rendering.',
    expectedConcepts: ['EXPLAIN ANALYZE', 'N+1 queries', 'indexing', 'Redis cache', 'pagination', 'code splitting', 'profiling'],
    rubricFocus: 'Systematic bottleneck isolation across DB, caching, API payload, and frontend.',
    createdBy: 'Curator Team (D1)',
  },
];

// Curated Annotated Evaluation Set for Semester 7 Benchmark (Section 2.3 & 3.1)
export const ANNOTATED_EVAL_SET: AnnotatedValidationSample[] = [
  {
    id: 'val_strong_dsa',
    subject: 'Data Structures & Algorithms',
    interviewType: 'technical',
    question: 'Explain how a Hash Table handles collisions using Separate Chaining vs. Open Addressing, and compare their time complexities.',
    referenceAnswer: SEED_CHUNKS[0].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[0].expectedConcepts,
    candidateAnswer:
      'When a hash function maps two keys to the same bucket, separate chaining attaches a linked list or tree per bucket so lookups stay O(1) on average and handle high load factors well. Open addressing keeps entries in the flat array using linear, quadratic, or double-hashing probing, giving better CPU cache locality, though primary clustering degrades performance if the load factor rises above 0.7 without rehashing.',
    qualityTier: 'Strong',
    humanScoreOutOf10: 9.1,
    humanBand: 'Excellent',
    deliverySample: {
      speakingRateWpm: 138,
      pauseFrequencyPerMin: 3.2,
      fillerWordCount: 1,
      durationSeconds: 32,
    },
  },
  {
    id: 'val_strong_hr',
    subject: 'HR & Behavioural',
    interviewType: 'behavioural',
    question: 'Tell me about a time you faced a tight deadline or unexpected bug during a project. How did you handle it using the STAR method?',
    referenceAnswer: SEED_CHUNKS[16].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[16].expectedConcepts,
    candidateAnswer:
      'In our final-year portal situation, an authentication token bug surfaced 24 hours before demo review. My task was to stabilize login and preserve user session state without breaking existing endpoints. As my action, I isolated the cookie mismatch using server logs, wrote unit tests reproducing the bug, patched the middleware, and updated my teammates on progress. As a result, we passed the evaluation smoothly with zero downtime and improved test ownership.',
    qualityTier: 'Strong',
    humanScoreOutOf10: 8.8,
    humanBand: 'Excellent',
    deliverySample: {
      speakingRateWpm: 144,
      pauseFrequencyPerMin: 2.5,
      fillerWordCount: 0,
      durationSeconds: 30,
    },
  },
  {
    id: 'val_avg_dbms',
    subject: 'Database Management Systems',
    interviewType: 'technical',
    question: 'Explain the ACID properties of relational database transactions with concrete examples.',
    referenceAnswer: SEED_CHUNKS[3].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[3].expectedConcepts,
    candidateAnswer:
      'ACID stands for Atomicity, Consistency, Isolation, and Durability. Atomicity means all steps in a bank transfer run together or rollback if one fails. Consistency keeps database rules valid. Isolation makes sure two concurrent transactions do not interfere with each other, and Durability means committed data stays saved even after a server restart.',
    qualityTier: 'Average',
    humanScoreOutOf10: 7.4,
    humanBand: 'Good',
    deliverySample: {
      speakingRateWpm: 122,
      pauseFrequencyPerMin: 5.0,
      fillerWordCount: 3,
      durationSeconds: 28,
    },
  },
  {
    id: 'val_avg_os',
    subject: 'Operating Systems',
    interviewType: 'technical',
    question: 'What is the difference between a Process and a Thread, and why is thread context switching faster?',
    referenceAnswer: SEED_CHUNKS[6].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[6].expectedConcepts,
    candidateAnswer:
      'A process is an independent running program with its own memory space, while threads exist inside a process and share memory like the heap and code. Threads switch faster because they share the same memory space so the OS does not need to reset everything like it does between two separate processes.',
    qualityTier: 'Average',
    humanScoreOutOf10: 6.3,
    humanBand: 'Satisfactory',
    deliverySample: {
      speakingRateWpm: 108,
      pauseFrequencyPerMin: 7.5,
      fillerWordCount: 5,
      durationSeconds: 26,
    },
  },
  {
    id: 'val_weak_cn',
    subject: 'Computer Networks',
    interviewType: 'technical',
    question: 'Compare TCP and UDP across reliability, connection setup, overhead, and typical application protocols.',
    referenceAnswer: SEED_CHUNKS[9].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[9].expectedConcepts,
    candidateAnswer:
      'TCP is reliable and slower whereas UDP is fast and unreliable. TCP is used when we need files to arrive safely and UDP is mostly used for video calls or gaming.',
    qualityTier: 'Weak',
    humanScoreOutOf10: 4.1,
    humanBand: 'Needs Improvement',
    deliverySample: {
      speakingRateWpm: 88,
      pauseFrequencyPerMin: 11.0,
      fillerWordCount: 6,
      durationSeconds: 18,
    },
  },
  {
    id: 'val_weak_aiml',
    subject: 'AI / ML Basics',
    interviewType: 'technical',
    question: 'What is Retrieval-Augmented Generation (RAG), and how do vector embeddings prevent LLM hallucinations?',
    referenceAnswer: SEED_CHUNKS[14].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[14].expectedConcepts,
    candidateAnswer:
      'RAG basically searches some documents before the AI replies so it gives better answers instead of guessing from memory.',
    qualityTier: 'Weak',
    humanScoreOutOf10: 3.6,
    humanBand: 'Needs Improvement',
    deliverySample: {
      speakingRateWpm: 92,
      pauseFrequencyPerMin: 9.0,
      fillerWordCount: 4,
      durationSeconds: 15,
    },
  },
  {
    id: 'val_offtopic_1',
    subject: 'Operating Systems',
    interviewType: 'technical',
    question: 'State the four Coffman conditions for a Deadlock and explain practical prevention or avoidance techniques.',
    referenceAnswer: SEED_CHUNKS[7].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[7].expectedConcepts,
    candidateAnswer:
      'Yesterday I went to play cricket with my hostel friends and afterwards we ordered pizza and watched a movie together before going to sleep.',
    qualityTier: 'Off-Topic',
    humanScoreOutOf10: 0.8,
    humanBand: 'Needs Improvement',
    deliverySample: {
      speakingRateWpm: 130,
      pauseFrequencyPerMin: 3.0,
      fillerWordCount: 1,
      durationSeconds: 14,
    },
  },
  {
    id: 'val_offtopic_2',
    subject: 'Database Management Systems',
    interviewType: 'technical',
    question: 'Why do relational databases use B+ Trees instead of Hash Indexes or standard Binary Search Trees for indexing?',
    referenceAnswer: SEED_CHUNKS[4].referenceAnswer,
    expectedConcepts: SEED_CHUNKS[4].expectedConcepts,
    candidateAnswer:
      'React uses CSS Tailwind classes and HTML buttons to build modern responsive frontend websites with dark mode toggle switches.',
    qualityTier: 'Off-Topic',
    humanScoreOutOf10: 1.2,
    humanBand: 'Needs Improvement',
    deliverySample: {
      speakingRateWpm: 115,
      pauseFrequencyPerMin: 4.0,
      fillerWordCount: 2,
      durationSeconds: 13,
    },
  },
];

// Deterministic 64-dim lexical projection fallback vector when offline / quota exceeded
export function computeLexicalVector(text: string, dims = 64): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;

    // Also encode bigrams of characters for robust fuzzy overlap
    for (let i = 0; i < token.length - 2; i++) {
      const tri = token.slice(i, i + 3);
      let h2 = 5381;
      for (let j = 0; j < tri.length; j++) {
        h2 = ((h2 << 5) + h2) + tri.charCodeAt(j);
      }
      vec[Math.abs(h2) % dims] += 0.35;
    }
  }

  return normalizeVector(vec);
}

export function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

export async function embedTextWithGemini(
  ai: GoogleGenAI,
  text: string
): Promise<{ vector: number[]; source: 'gemini-embedding-2' | 'lexical-projection' }> {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return { vector: computeLexicalVector(text), source: 'lexical-projection' };
    }
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text.slice(0, 2000),
    });
    const values = result.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return { vector: normalizeVector(values), source: 'gemini-embedding-2' };
    }
  } catch (err: any) {
    console.warn('Embedding fallback (lexical projection):', err?.message || err);
  }
  return { vector: computeLexicalVector(text), source: 'lexical-projection' };
}

export class KnowledgeBaseStore {
  private filePath: string;
  private chunks: StoredKnowledgeChunk[] = [];
  private ai: GoogleGenAI;

  constructor(dataDir: string, ai: GoogleGenAI) {
    this.filePath = path.join(dataDir, 'knowledge_base_d1.json');
    this.ai = ai;
    this.loadOrSeed();
  }

  private loadOrSeed() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.chunks = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('Failed reading D1 knowledge base, seeding fresh:', err);
    }

    const now = new Date().toISOString();
    this.chunks = SEED_CHUNKS.map((seed) => {
      const combined = `${seed.subject} ${seed.question} ${seed.referenceAnswer} ${seed.expectedConcepts.join(' ')}`;
      return {
        ...seed,
        embedding: computeLexicalVector(combined),
        embeddingSource: 'lexical-projection',
        createdAt: now,
      };
    });
    this.save();
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.chunks, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed saving D1 knowledge base:', err);
    }
  }

  public getAllChunks(includeUserDocs = false) {
    if (includeUserDocs) return this.chunks;
    return this.chunks.filter((c) => !c.scope || c.scope === 'global');
  }

  public async addChunk(input: {
    subject: string;
    interviewType: 'technical' | 'behavioural';
    difficulty: 'junior' | 'intermediate' | 'senior' | 'lead' | 'easy' | 'medium' | 'hard';
    question: string;
    referenceAnswer: string;
    expectedConcepts: string[];
    rubricFocus?: string;
    createdBy?: string;
  }): Promise<StoredKnowledgeChunk> {
    const combined = `${input.subject} ${input.question} ${input.referenceAnswer} ${input.expectedConcepts.join(' ')}`;
    const { vector, source } = await embedTextWithGemini(this.ai, combined);

    const newChunk: StoredKnowledgeChunk = {
      id: 'kb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      subject: input.subject,
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      question: input.question.trim(),
      referenceAnswer: input.referenceAnswer.trim(),
      expectedConcepts: input.expectedConcepts,
      rubricFocus: input.rubricFocus?.trim() || 'Technical correctness, concept coverage, and clarity.',
      embedding: vector,
      embeddingSource: source,
      createdBy: input.createdBy || 'Content Curator',
      createdAt: new Date().toISOString(),
      scope: 'global',
    };

    this.chunks.unshift(newChunk);
    this.save();
    return newChunk;
  }

  /**
   * Store user-isolated JD or Resume chunks inside the existing D1 vector store
   * using metadata filtering (`scope: 'user_doc'`, `userId`, `docId`, `docType`).
   */
  public async upsertDocumentChunks(params: {
    userId: string;
    docId: string;
    docType: 'jd' | 'resume';
    subject: string;
    chunksText: string[];
    expectedConcepts?: string[];
  }): Promise<StoredKnowledgeChunk[]> {
    // Remove stale chunks for the same document ID
    this.chunks = this.chunks.filter(
      (c) => !(c.scope === 'user_doc' && c.docId === params.docId)
    );

    const now = new Date().toISOString();
    const created: StoredKnowledgeChunk[] = [];
    const concepts = params.expectedConcepts || [];

    for (let idx = 0; idx < params.chunksText.length; idx++) {
      const chunkText = params.chunksText[idx].trim();
      if (!chunkText) continue;

      const { vector, source } = await embedTextWithGemini(
        this.ai,
        `${params.docType.toUpperCase()} ${params.subject} ${chunkText}`
      );

      const record: StoredKnowledgeChunk = {
        id: `${params.docType}_${params.docId.slice(-8)}_c${idx + 1}`,
        subject: params.subject,
        interviewType: 'technical',
        difficulty: 'medium',
        question: `${params.docType === 'jd' ? 'Job Description' : 'Candidate Resume'} Section ${idx + 1}`,
        referenceAnswer: chunkText,
        expectedConcepts: concepts.slice(0, 12),
        rubricFocus:
          params.docType === 'jd'
            ? 'Job Description requirement context'
            : 'Candidate Resume project & skill context',
        embedding: vector,
        embeddingSource: source,
        createdBy: params.userId,
        createdAt: now,
        scope: 'user_doc',
        userId: params.userId,
        docId: params.docId,
        docType: params.docType,
      };

      this.chunks.push(record);
      created.push(record);
    }

    this.save();
    return created;
  }

  public async reindexAllWithGemini(): Promise<{ total: number; geminiEmbedded: number }> {
    let geminiCount = 0;
    for (const chunk of this.chunks) {
      const combined = `${chunk.subject} ${chunk.question} ${chunk.referenceAnswer} ${chunk.expectedConcepts.join(' ')}`;
      const { vector, source } = await embedTextWithGemini(this.ai, combined);
      chunk.embedding = vector;
      chunk.embeddingSource = source;
      if (source === 'gemini-embedding-2') geminiCount++;
    }
    this.save();
    return { total: this.chunks.length, geminiEmbedded: geminiCount };
  }

  public async retrieveTopK(params: {
    query: string;
    subject?: string;
    interviewType?: 'technical' | 'behavioural';
    topK?: number;
    userId?: string;
    allowedDocIds?: string[];
    scopeFilter?: 'global' | 'user_doc' | 'all';
    docTypeFilter?: 'jd' | 'resume';
  }): Promise<Array<StoredKnowledgeChunk & { similarityScore: number }>> {
    const topK = params.topK || 3;
    const scopeFilter = params.scopeFilter || 'global';
    const { vector: queryVec, source } = await embedTextWithGemini(this.ai, params.query);
    const lexicalQueryVec = computeLexicalVector(params.query);

    const eligibleChunks = this.chunks.filter((chunk) => {
      const chunkScope = chunk.scope || 'global';

      if (scopeFilter === 'global') {
        return chunkScope === 'global';
      }

      if (chunkScope === 'user_doc') {
        // Strict user & document ownership isolation
        if (!params.userId || chunk.userId !== params.userId) return false;
        if (params.allowedDocIds && chunk.docId && !params.allowedDocIds.includes(chunk.docId)) {
          return false;
        }
        if (params.docTypeFilter && chunk.docType !== params.docTypeFilter) {
          return false;
        }
        return true;
      }

      if (scopeFilter === 'user_doc') {
        return false;
      }

      // scopeFilter === 'all': include global chunks as well unless docTypeFilter restricts to jd/resume
      return !params.docTypeFilter;
    });

    const scored = eligibleChunks.map((chunk) => {
      let sim = 0;
      if (chunk.embeddingSource === source && chunk.embedding.length === queryVec.length) {
        sim = cosineSimilarity(queryVec, chunk.embedding);
      } else {
        const chunkLex = computeLexicalVector(
          `${chunk.subject} ${chunk.question} ${chunk.referenceAnswer} ${chunk.expectedConcepts.join(' ')}`
        );
        sim = cosineSimilarity(lexicalQueryVec, chunkLex);
      }

      // Subject & interviewType alignment boost (strictly bounded within [0..1])
      let boost = 0;
      if (params.subject && chunk.subject.toLowerCase() === params.subject.toLowerCase()) {
        boost += 0.22;
      }
      if (params.interviewType && chunk.interviewType === params.interviewType) {
        boost += 0.1;
      }

      return {
        ...chunk,
        similarityScore: Math.min(0.99, Number((sim * 0.78 + boost).toFixed(3))),
      };
    });

    return scored.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, topK);
  }
}
