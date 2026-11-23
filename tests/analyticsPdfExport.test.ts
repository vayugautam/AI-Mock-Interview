import { describe, it, expect } from 'vitest';
import {
  buildAnalyticsPdfBytes,
  sanitizePdfText,
} from '../src/lib/analyticsPdfExport';
import { extractCleanTextFromPdf } from '../backend/services/pdfTextExtractor';
import type { InterviewSession, PerformanceBand } from '../src/types';

function makeSession(
  idx: number,
  overrides: Partial<InterviewSession> = {}
): InterviewSession {
  const score = overrides.report?.overallScoreOutOf10 ?? Number((6.2 + (idx % 4) * 0.8).toFixed(1));
  const band: PerformanceBand =
    score >= 8 ? 'Excellent' : score >= 6.5 ? 'Good' : 'Satisfactory';

  return {
    id: `int_${idx}`,
    userId: 'usr_alice',
    techField: idx % 2 === 0 ? 'Backend Engineering' : 'System Design',
    jdTitle: idx % 2 === 0 ? 'Senior Python Engineer' : 'Distributed Systems Engineer',
    interviewType: idx % 2 === 0 ? 'technical' : 'mixed',
    difficulty: 'medium',
    ragEnabled: true,
    questionCount: 5,
    createdAt: new Date(Date.UTC(2026, 9, 1 + idx)).toISOString(),
    completedAt: new Date(Date.UTC(2026, 9, 1 + idx, 1)).toISOString(),
    questions: [
      {
        id: 1,
        question: 'Explain connection pooling and query indexing.',
        topic: 'PostgreSQL',
        subject: 'Databases',
        interviewType: 'technical',
        difficulty: 'medium',
        expectedKeywords: ['index', 'B-tree', 'pool'],
      },
    ],
    answers: [
      {
        questionId: 1,
        question: 'Explain connection pooling and query indexing.',
        topic: 'PostgreSQL',
        interviewType: 'technical',
        inputModality: 'voice',
        rawTranscript: 'Connection pooling reuses persistent TCP connections and B-tree indexes speed up lookups.',
        cleanedTranscript:
          'Connection pooling reuses persistent TCP connections and B-tree indexes speed up lookups.',
        evaluation: {
          overallScoreOutOf10: score,
          earlyFusionScore: score,
          lateFusionScore: score,
          consistencyIndicator: 0.9,
          performanceBand: band,
          isOffTopic: false,
          inputModality: 'voice',
          criteria: {
            technicalCorrectness: score,
            relevance: score,
            clarity: score,
            completeness: score - 0.3,
            communication: score,
          },
          contentFeatures: {
            semanticSimilarityToQuestion: 0.85,
            semanticSimilarityToReference: 0.82,
            conceptCoverageRatio: 0.8,
            normalizedAnswerLength: 0.75,
            starStructureIndicator: 0.5,
            matchedConcepts: ['B-tree', 'pooling'],
          },
          deliveryFeatures: {
            available: true,
            speakingRateWpm: 138,
            normalizedSpeakingRate: 0.9,
            pauseFrequencyPerMin: 2,
            normalizedPauseControl: 0.88,
            fillerWordCount: 1,
            fillerDensity: 0.02,
            normalizedFillerFluency: 0.92,
            rawDurationSeconds: 45,
            trimmedDurationSeconds: 42,
            normalizedGainDb: -16,
            sampleRateHz: 16000,
          },
          rawTranscript: 'Connection pooling reuses persistent TCP connections.',
          cleanedTranscript: 'Connection pooling reuses persistent TCP connections.',
          feedback: 'Clear explanation with concrete database concepts.',
          strengths: ['Strong grasp of B-tree indexing'],
          weaknesses: ['Cover lock contention edge cases'],
          missingConcepts: ['pgBouncer'],
          suggestedImprovement: 'Discuss pool sizing vs CPU cores.',
          latencyMs: 420,
        },
      },
    ],
    report: {
      totalQuestions: 5,
      questionsAnswered: 5,
      overallScoreOutOf10: score,
      performanceBand: band,
      technicalPerformance: score,
      behavioralPerformance: null,
      earlyFusionAvg: score,
      lateFusionAvg: score,
      consistencyAvg: 0.9,
      criteriaAverages: {
        technicalCorrectness: score,
        relevance: score,
        clarity: score,
        completeness: Number((score - 0.3).toFixed(1)),
        communication: score,
      },
      skillPerformance: [],
      categoryPerformance: [],
      jdMissingSkills: ['Kubernetes'],
      strengths: ['Strong grasp of B-tree indexing'],
      areasForImprovement: ['Cover lock contention edge cases'],
      recommendedTopics: ['pgBouncer', 'Connection pool sizing'],
      detailedSummary: 'Solid performance across core technical concepts.',
    },
    ...overrides,
  };
}

describe('analyticsPdfExport', () => {
  it('sanitizes typography and rejects empty completed sessions', () => {
    expect(sanitizePdfText('Role — Senior\u2019s · Focus…')).toBe("Role - Senior's | Focus...");

    const incompleteSession = makeSession(1, { report: undefined });
    expect(() =>
      buildAnalyticsPdfBytes({
        sessions: [incompleteSession],
        subjectFilter: 'ALL',
      })
    ).toThrow(/No completed interview sessions/);
  });

  it('generates a formatted, multi-page PDF summary readable by pdf-parse and respects subject filtering', async () => {
    const sessions = Array.from({ length: 18 }, (_, i) => makeSession(i + 1));

    const result = buildAnalyticsPdfBytes({
      sessions,
      subjectFilter: 'ALL',
      candidateName: 'Alice Sharma',
      candidateEmail: 'alice@example.edu',
      generatedAt: new Date('2026-11-18T12:00:00.000Z'),
    });

    expect(result.filename).toBe('interview-performance-summary-2026-11-18.pdf');
    expect(result.sessionCount).toBe(18);
    expect(result.pageCount).toBeGreaterThanOrEqual(2);

    const buffer = Buffer.from(result.bytes);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    // Parse generated PDF back through pdf-parse to guarantee clean, readable text output
    const extracted = await extractCleanTextFromPdf(buffer);
    expect(extracted.pageCount).toBe(result.pageCount);
    expect(extracted.text).toContain('AI Mock Interview Platform');
    expect(extracted.text).toContain('Alice Sharma');
    expect(extracted.text).toContain('alice@example.edu');
    expect(extracted.text).toContain('Session Score Progression');
    expect(extracted.text).toContain('Subject Mastery Breakdown');
    expect(extracted.text).toContain('Rubric Criteria Averages');
    expect(extracted.text).toContain('138 WPM');
    expect(extracted.text).toContain('Strong grasp of B-tree indexing');
    expect(extracted.text).toContain('Page 1 of');

    // Filtered subject export
    const filteredResult = buildAnalyticsPdfBytes({
      sessions,
      subjectFilter: 'Backend Engineering',
      candidateName: 'Alice Sharma',
      generatedAt: new Date('2026-11-18T12:00:00.000Z'),
    });

    expect(filteredResult.filename).toBe(
      'interview-performance-summary-backend-engineering-2026-11-18.pdf'
    );
    expect(filteredResult.sessionCount).toBe(9);
  });
});
