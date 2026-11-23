import { jsPDF } from 'jspdf';
import {
  InterviewSession,
  PerformanceBand,
  RubricCriteriaScores,
} from '../types';

export interface AnalyticsPdfExportParams {
  sessions: InterviewSession[];
  subjectFilter?: string;
  candidateName?: string;
  candidateEmail?: string;
  generatedAt?: Date;
}

export interface AnalyticsPdfBuildResult {
  doc: jsPDF;
  filename: string;
  sessionCount: number;
  pageCount: number;
}

const PAGE_WIDTH = 210; // A4 mm
const PAGE_HEIGHT = 297;
const MARGIN_X = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - 18;

const COLORS = {
  indigoDark: [49, 46, 129] as const,
  indigo: [79, 70, 229] as const,
  indigoSoft: [238, 242, 255] as const,
  slate900: [15, 23, 42] as const,
  slate700: [51, 65, 85] as const,
  slate500: [100, 116, 139] as const,
  slate200: [226, 232, 240] as const,
  slate100: [241, 245, 249] as const,
  slate50: [248, 250, 252] as const,
  emerald: [5, 150, 105] as const,
  amber: [217, 119, 6] as const,
  rose: [225, 29, 72] as const,
  white: [255, 255, 255] as const,
};

/**
 * Normalize punctuation and strip glyphs outside built-in WinAnsi Helvetica metrics
 * so rendered PDF text stays legible across all PDF readers.
 */
export function sanitizePdfText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00B7/g, '|')
    .replace(/\u2022/g, '*')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getBandColor(band?: PerformanceBand | string): readonly [number, number, number] {
  if (band === 'Excellent') return COLORS.emerald;
  if (band === 'Good') return COLORS.indigo;
  if (band === 'Satisfactory') return COLORS.amber;
  return COLORS.rose;
}

function computeCriteriaAverages(
  sessions: InterviewSession[]
): Array<{ label: string; key: keyof RubricCriteriaScores; value: number }> {
  const specs: Array<{ label: string; key: keyof RubricCriteriaScores }> = [
    { label: 'Technical Correctness', key: 'technicalCorrectness' },
    { label: 'Relevance to Prompt', key: 'relevance' },
    { label: 'Clarity & Structure', key: 'clarity' },
    { label: 'Concept Completeness', key: 'completeness' },
    { label: 'Communication', key: 'communication' },
  ];

  const sessionsWithCriteria = sessions.filter((s) => s.report?.criteriaAverages);
  if (sessionsWithCriteria.length === 0) return [];

  return specs.map((spec) => {
    const sum = sessionsWithCriteria.reduce(
      (acc, s) => acc + (s.report?.criteriaAverages?.[spec.key] || 0),
      0
    );
    return {
      ...spec,
      value: Number((sum / sessionsWithCriteria.length).toFixed(2)),
    };
  });
}

function buildExportFilename(subjectFilter: string | undefined, generatedAt: Date): string {
  const datePart = generatedAt.toISOString().slice(0, 10);
  const scopeSlug =
    subjectFilter && subjectFilter !== 'ALL'
      ? '-' +
        subjectFilter
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : '';
  return `interview-performance-summary${scopeSlug}-${datePart}.pdf`;
}

export function buildAnalyticsPdfDocument(
  params: AnalyticsPdfExportParams
): AnalyticsPdfBuildResult {
  const {
    sessions,
    subjectFilter = 'ALL',
    candidateName,
    candidateEmail,
    generatedAt = new Date(),
  } = params;

  const completed = sessions.filter((s) => Boolean(s.report));
  const scopedSessions =
    subjectFilter && subjectFilter !== 'ALL'
      ? completed.filter((s) => s.techField === subjectFilter)
      : completed;

  if (scopedSessions.length === 0) {
    throw new Error('No completed interview sessions are available to export.');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 14;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > BOTTOM_LIMIT) {
      doc.addPage();
      y = 16;
    }
  };

  // =====================================================
  // 1. Header Banner
  // =====================================================
  doc.setFillColor(...COLORS.indigoDark);
  doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 28, 3, 3, 'F');

  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('AI Mock Interview Platform', MARGIN_X + 6, y + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Candidate Performance & Analytics Summary', MARGIN_X + 6, y + 15.5);

  doc.setFontSize(8.5);
  const candidateMeta = [
    candidateName ? `Candidate: ${sanitizePdfText(candidateName)}` : null,
    candidateEmail ? sanitizePdfText(candidateEmail) : null,
    `Exported: ${generatedAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })}`,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.text(candidateMeta, MARGIN_X + 6, y + 22);

  // Scope badge on right side of banner
  const scopeLabel =
    subjectFilter && subjectFilter !== 'ALL'
      ? `Scope: ${sanitizePdfText(subjectFilter)}`
      : 'Scope: All Subjects';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(scopeLabel, PAGE_WIDTH - MARGIN_X - 6, y + 9.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${scopedSessions.length} completed session${scopedSessions.length === 1 ? '' : 's'}`,
    PAGE_WIDTH - MARGIN_X - 6,
    y + 15.5,
    { align: 'right' }
  );

  y += 34;

  // =====================================================
  // 2. Executive KPI Summary Grid (4 cards)
  // =====================================================
  const avgScore =
    scopedSessions.reduce((acc, s) => acc + (s.report?.overallScoreOutOf10 || 0), 0) /
    scopedSessions.length;
  const latestSession = scopedSessions[0];
  const latestBand = latestSession?.report?.performanceBand || 'N/A';

  const voiceAnswers = scopedSessions.flatMap((s) =>
    s.answers.filter((a) => a.evaluation?.deliveryFeatures?.available)
  );
  const avgWpm =
    voiceAnswers.length > 0
      ? Math.round(
          voiceAnswers.reduce(
            (acc, a) => acc + (a.evaluation.deliveryFeatures.speakingRateWpm || 0),
            0
          ) / voiceAnswers.length
        )
      : null;

  const totalAnswersEvaluated = scopedSessions.reduce(
    (acc, s) => acc + (s.answers?.length || 0),
    0
  );

  const kpis = [
    {
      label: 'COMPLETED SESSIONS',
      value: String(scopedSessions.length),
      sub: `${totalAnswersEvaluated} answers evaluated`,
      valueColor: COLORS.slate900,
    },
    {
      label: 'MEAN SCORE (/10)',
      value: `${avgScore.toFixed(2)} / 10`,
      sub: 'Multimodal fusion avg',
      valueColor: COLORS.indigo,
    },
    {
      label: 'LATEST BAND',
      value: sanitizePdfText(latestBand),
      sub: sanitizePdfText(latestSession?.techField || 'Placement Track'),
      valueColor: getBandColor(latestBand),
    },
    {
      label: 'SPEECH FLUENCY',
      value: avgWpm !== null ? `${avgWpm} WPM` : 'Text Mode',
      sub:
        voiceAnswers.length > 0
          ? `${voiceAnswers.length} voice response${voiceAnswers.length === 1 ? '' : 's'}`
          : 'No voice captures',
      valueColor: COLORS.slate900,
    },
  ];

  const cardGap = 3.5;
  const cardWidth = (CONTENT_WIDTH - cardGap * 3) / 4;
  const cardHeight = 22;

  kpis.forEach((kpi, idx) => {
    const cx = MARGIN_X + idx * (cardWidth + cardGap);
    doc.setFillColor(...COLORS.slate50);
    doc.setDrawColor(...COLORS.slate200);
    doc.roundedRect(cx, y, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...COLORS.slate500);
    doc.text(kpi.label, cx + 3.5, y + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...kpi.valueColor);
    const valueLines = doc.splitTextToSize(kpi.value, cardWidth - 7);
    doc.text(valueLines[0] || '', cx + 3.5, y + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.slate500);
    const subLines = doc.splitTextToSize(kpi.sub, cardWidth - 7);
    doc.text(subLines[0] || '', cx + 3.5, y + 18.5);
  });

  y += cardHeight + 8;

  // =====================================================
  // 3. Score Progression Vector Chart & Subject Mastery
  // =====================================================
  const trendSessions = [...scopedSessions].reverse().slice(-12);

  const subjectMap = new Map<string, { sum: number; count: number }>();
  scopedSessions.forEach((s) => {
    const score = s.report?.overallScoreOutOf10 || 0;
    const prev = subjectMap.get(s.techField) || { sum: 0, count: 0 };
    subjectMap.set(s.techField, { sum: prev.sum + score, count: prev.count + 1 });
  });
  const subjectAverages = Array.from(subjectMap.entries()).map(([subject, stat]) => ({
    subject,
    avg: Number((stat.sum / stat.count).toFixed(2)),
    count: stat.count,
  }));

  const chartBoxHeight = Math.max(48, 16 + subjectAverages.length * 10);
  ensureSpace(chartBoxHeight + 6);

  const leftColW = 104;
  const rightColW = CONTENT_WIDTH - leftColW - 4;
  const rightColX = MARGIN_X + leftColW + 4;

  // Left card: Score Progression
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.slate200);
  doc.roundedRect(MARGIN_X, y, leftColW, chartBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text('Session Score Progression (0-10)', MARGIN_X + 4, y + 6.5);

  const plotX = MARGIN_X + 11;
  const plotY = y + 12;
  const plotW = leftColW - 16;
  const plotH = chartBoxHeight - 21;

  // Y-axis gridlines
  [0, 2.5, 5, 7.5, 10].forEach((tick) => {
    const ty = plotY + plotH - (tick / 10) * plotH;
    doc.setDrawColor(...COLORS.slate200);
    doc.setLineWidth(0.2);
    doc.line(plotX, ty, plotX + plotW, ty);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.slate500);
    doc.text(String(tick), plotX - 1.5, ty + 1, { align: 'right' });
  });

  const points = trendSessions.map((s, idx) => {
    const px =
      trendSessions.length === 1
        ? plotX + plotW / 2
        : plotX + 4 + (idx / (trendSessions.length - 1)) * (plotW - 8);
    const score = Math.max(0, Math.min(10, s.report?.overallScoreOutOf10 || 0));
    const py = plotY + plotH - (score / 10) * plotH;
    return { x: px, y: py, score, label: `S${idx + 1}` };
  });

  if (points.length > 1) {
    doc.setDrawColor(...COLORS.indigo);
    doc.setLineWidth(0.7);
    for (let i = 0; i < points.length - 1; i++) {
      doc.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }
  }

  points.forEach((pt) => {
    doc.setFillColor(...COLORS.indigo);
    doc.setDrawColor(...COLORS.white);
    doc.setLineWidth(0.4);
    doc.circle(pt.x, pt.y, 1.3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.indigoDark);
    doc.text(pt.score.toFixed(1), pt.x, Math.max(plotY + 2, pt.y - 2.2), { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...COLORS.slate500);
    doc.text(pt.label, pt.x, plotY + plotH + 4, { align: 'center' });
  });

  // Right card: Subject Mastery Breakdown
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.slate200);
  doc.roundedRect(rightColX, y, rightColW, chartBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text('Subject Mastery Breakdown', rightColX + 4, y + 6.5);

  let barY = y + 13;
  subjectAverages.slice(0, 6).forEach((item) => {
    const labelText = sanitizePdfText(`${item.subject} (${item.count})`);
    const clippedLabel = doc.splitTextToSize(labelText, rightColW - 22)[0] || '';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.slate700);
    doc.text(clippedLabel, rightColX + 4, barY);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.indigo);
    doc.text(`${item.avg.toFixed(1)}/10`, rightColX + rightColW - 4, barY, { align: 'right' });

    const trackW = rightColW - 8;
    const fillW = Math.max(1.5, Math.min(trackW, (item.avg / 10) * trackW));
    doc.setFillColor(...COLORS.slate100);
    doc.roundedRect(rightColX + 4, barY + 1.5, trackW, 2.2, 1, 1, 'F');
    doc.setFillColor(...COLORS.indigo);
    doc.roundedRect(rightColX + 4, barY + 1.5, fillW, 2.2, 1, 1, 'F');

    barY += 9.5;
  });

  y += chartBoxHeight + 7;

  // =====================================================
  // 4. Rubric Criteria Averages & Key Feedback Highlights
  // =====================================================
  const criteria = computeCriteriaAverages(scopedSessions);
  const aggregatedStrengths = Array.from(
    new Set(scopedSessions.flatMap((s) => s.report?.strengths || []).map(sanitizePdfText))
  )
    .filter(Boolean)
    .slice(0, 4);
  const aggregatedFocus = Array.from(
    new Set(
      scopedSessions
        .flatMap((s) => [
          ...(s.report?.recommendedTopics || []),
          ...(s.report?.areasForImprovement || []),
        ])
        .map(sanitizePdfText)
    )
  )
    .filter(Boolean)
    .slice(0, 4);

  if (criteria.length > 0 || aggregatedStrengths.length > 0 || aggregatedFocus.length > 0) {
    const sectionHeight = Math.max(
      criteria.length > 0 ? 44 : 0,
      Math.max(aggregatedStrengths.length, aggregatedFocus.length) * 6 + 18
    );
    ensureSpace(sectionHeight + 6);

    const critColW = 86;
    const notesColW = CONTENT_WIDTH - critColW - 4;
    const notesColX = MARGIN_X + critColW + 4;

    if (criteria.length > 0) {
      doc.setFillColor(...COLORS.white);
      doc.setDrawColor(...COLORS.slate200);
      doc.roundedRect(MARGIN_X, y, critColW, sectionHeight, 2.5, 2.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...COLORS.slate900);
      doc.text('Rubric Criteria Averages', MARGIN_X + 4, y + 6.5);

      let cy = y + 12.5;
      criteria.forEach((c) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...COLORS.slate700);
        doc.text(c.label, MARGIN_X + 4, cy);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.slate900);
        doc.text(`${c.value.toFixed(1)}`, MARGIN_X + critColW - 4, cy, { align: 'right' });

        const barTrackW = critColW - 8;
        const barFillW = Math.max(1, Math.min(barTrackW, (c.value / 10) * barTrackW));
        doc.setFillColor(...COLORS.slate100);
        doc.roundedRect(MARGIN_X + 4, cy + 1.4, barTrackW, 1.8, 0.8, 0.8, 'F');
        doc.setFillColor(...COLORS.emerald);
        doc.roundedRect(MARGIN_X + 4, cy + 1.4, barFillW, 1.8, 0.8, 0.8, 'F');
        cy += 6.4;
      });
    }

    doc.setFillColor(...COLORS.white);
    doc.setDrawColor(...COLORS.slate200);
    doc.roundedRect(notesColX, y, notesColW, sectionHeight, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.slate900);
    doc.text('Key Strengths & Recommended Focus', notesColX + 4, y + 6.5);

    let ny = y + 12;
    if (aggregatedStrengths.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.emerald);
      doc.text('Observed Strengths:', notesColX + 4, ny);
      ny += 4.2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...COLORS.slate700);
      aggregatedStrengths.forEach((item) => {
        const line = doc.splitTextToSize(`+ ${item}`, notesColW - 8)[0] || '';
        if (ny < y + sectionHeight - 4) {
          doc.text(line, notesColX + 4, ny);
          ny += 4.2;
        }
      });
      ny += 1.5;
    }

    if (aggregatedFocus.length > 0 && ny < y + sectionHeight - 5) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.amber);
      doc.text('Focus Areas & Recommended Topics:', notesColX + 4, ny);
      ny += 4.2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...COLORS.slate700);
      aggregatedFocus.forEach((item) => {
        const line = doc.splitTextToSize(`* ${item}`, notesColW - 8)[0] || '';
        if (ny < y + sectionHeight - 3) {
          doc.text(line, notesColX + 4, ny);
          ny += 4.2;
        }
      });
    }

    y += sectionHeight + 7;
  }

  // =====================================================
  // 5. Recorded Session History Table
  // =====================================================
  ensureSpace(22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text('Recorded Interview Sessions', MARGIN_X, y);
  y += 4;

  const colWidths = [28, 56, 30, 18, 18, 32]; // Sum = 182mm = CONTENT_WIDTH
  const headers = ['Date', 'Role / Subject', 'Format', 'Answers', 'Score', 'Performance Band'];

  const drawTableHeader = () => {
    doc.setFillColor(...COLORS.indigoSoft);
    doc.setDrawColor(...COLORS.slate200);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.indigoDark);

    let hx = MARGIN_X + 2.5;
    headers.forEach((header, i) => {
      doc.text(header, hx, y + 5);
      hx += colWidths[i];
    });
    y += 7.5;
  };

  drawTableHeader();

  scopedSessions.forEach((session, idx) => {
    const report = session.report!;
    const rowHeight = 8;
    if (y + rowHeight > BOTTOM_LIMIT) {
      doc.addPage();
      y = 16;
      drawTableHeader();
    }

    if (idx % 2 === 1) {
      doc.setFillColor(...COLORS.slate50);
    } else {
      doc.setFillColor(...COLORS.white);
    }
    doc.setDrawColor(...COLORS.slate200);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, rowHeight, 'FD');

    const dateLabel = new Date(session.completedAt || session.createdAt).toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'short', day: '2-digit' }
    );
    const roleLabel = sanitizePdfText(session.jdTitle || session.techField);
    const formatLabel = sanitizePdfText(
      `${session.interviewType} / ${session.difficulty}`
    );
    const answersLabel = `${session.answers.length}/${session.questions.length || session.questionCount}`;
    const scoreLabel = `${report.overallScoreOutOf10.toFixed(1)}/10`;
    const bandLabel = sanitizePdfText(report.performanceBand);

    const cells = [dateLabel, roleLabel, formatLabel, answersLabel, scoreLabel, bandLabel];
    let cx = MARGIN_X + 2.5;
    cells.forEach((cellText, colIdx) => {
      const maxW = colWidths[colIdx] - 3.5;
      const clipped = doc.splitTextToSize(cellText, maxW)[0] || '';
      if (colIdx === 4) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.indigoDark);
      } else if (colIdx === 5) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...getBandColor(report.performanceBand));
      } else {
        doc.setFont('helvetica', colIdx === 1 ? 'bold' : 'normal');
        doc.setTextColor(...COLORS.slate700);
      }
      doc.setFontSize(7.4);
      doc.text(clipped, cx, y + 5.2);
      cx += colWidths[colIdx];
    });

    y += rowHeight;
  });

  // =====================================================
  // 6. Page Footers ("Page X of Y")
  // =====================================================
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLORS.slate200);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, PAGE_HEIGHT - 13, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.slate500);
    doc.text(
      'AI Mock Interview Platform | Automated Performance Summary',
      MARGIN_X,
      PAGE_HEIGHT - 8.5
    );
    doc.text(`Page ${p} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 8.5, {
      align: 'right',
    });
  }

  return {
    doc,
    filename: buildExportFilename(subjectFilter, generatedAt),
    sessionCount: scopedSessions.length,
    pageCount,
  };
}

export function buildAnalyticsPdfBytes(params: AnalyticsPdfExportParams): {
  bytes: Uint8Array;
  filename: string;
  sessionCount: number;
  pageCount: number;
} {
  const { doc, filename, sessionCount, pageCount } = buildAnalyticsPdfDocument(params);
  const buffer = doc.output('arraybuffer');
  return {
    bytes: new Uint8Array(buffer),
    filename,
    sessionCount,
    pageCount,
  };
}

export function exportAnalyticsSummaryPdf(params: AnalyticsPdfExportParams): {
  filename: string;
  sessionCount: number;
  pageCount: number;
} {
  const { doc, filename, sessionCount, pageCount } = buildAnalyticsPdfDocument(params);
  const pdfBlob = doc.output('blob');
  const objectUrl = URL.createObjectURL(pdfBlob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1500);

  return { filename, sessionCount, pageCount };
}
