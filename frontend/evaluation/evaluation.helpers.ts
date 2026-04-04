// ============================================================
// evaluation.helpers.ts — Fonctions pures utilitaires
// ============================================================

import type {
  Confidence,
  Warning,
  VariantMetrics,
  RunMetrics,
} from "./evaluation.types";

// ---- Utilitaires génériques ----

export function compact<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((x): x is T => x !== null && x !== undefined);
}

export function safeAbs(n: number | null): number | null {
  return n === null ? null : Math.abs(n);
}

// ---- Analyse des warnings ----

export function hasHighSeverity(warnings: Warning[]): boolean {
  return warnings.some((w) => w.severity === "high");
}

export function countBySeverity(
  warnings: Warning[],
  severity: Warning["severity"]
): number {
  return warnings.filter((w) => w.severity === severity).length;
}

export function computeConfidence(warnings: Warning[]): Confidence {
  if (hasHighSeverity(warnings)) return "low";
  if (countBySeverity(warnings, "medium") >= 2) return "medium";
  return "high";
}

// ---- Helpers drawdown ----

export function isDrawdownContained(
  maxDrawdown: number | null,
  threshold = 0.15
): boolean {
  if (maxDrawdown === null) return false;
  return Math.abs(maxDrawdown) <= threshold;
}

export function isDrawdownAcceptable(
  maxDrawdown: number | null,
  threshold = 0.25
): boolean {
  if (maxDrawdown === null) return false;
  return Math.abs(maxDrawdown) < threshold;
}

// ---- Welch t-test pour 2 distributions ----

export function welchTTest(
  pnlsA: number[],
  pnlsB: number[]
): TTestResult | null {
  const nA = pnlsA.length;
  const nB = pnlsB.length;
  if (nA < 5 || nB < 5) return null;

  const meanA = pnlsA.reduce((a, b) => a + b, 0) / nA;
  const meanB = pnlsB.reduce((a, b) => a + b, 0) / nB;
  const varA = pnlsA.reduce((s, p) => s + (p - meanA) ** 2, 0) / (nA - 1);
  const varB = pnlsB.reduce((s, p) => s + (p - meanB) ** 2, 0) / (nB - 1);

  const seA = varA / nA;
  const seB = varB / nB;
  const se = Math.sqrt(seA + seB);
  if (se === 0) return null;

  const tStat = (meanA - meanB) / se;

  // Approximate p-value using normal distribution (adequate for n>=30, acceptable for small n)
  const z = Math.abs(tStat);
  // erfc approximation
  const pValue = 0.5 * erfc(z / Math.SQRT2);

  return {
    t_statistic: Math.round(tStat * 10000) / 10000,
    p_value: Math.round(pValue * 1000000) / 1000000,
    significant_5pct: pValue < 0.05,
    significant_1pct: pValue < 0.01,
    n: nA + nB,
  };
}

function erfc(x: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}

// ---- Scoring pour la comparaison ----

function compareMetric(
  a: number | null,
  b: number | null,
  higherIsBetter: boolean,
  metric: string,
  weight: number
): ScoreDetail {
  if (a === null || b === null) {
    return { metric, winner: "n/a", weight, gainA: 0, gainB: 0 };
  }
  if (a === b) {
    return { metric, winner: "tie", weight, gainA: 0, gainB: 0 };
  }
  const aBetter = higherIsBetter ? a > b : a < b;
  return aBetter
    ? { metric, winner: "a", weight, gainA: weight, gainB: 0 }
    : { metric, winner: "b", weight, gainA: 0, gainB: weight };
}

/**
 * Scoring enrichi sur 18 pts (anciennement 9 pts) :
 *
 *   pnl              → 3 pts
 *   maxDrawdown      → 2 pts
 *   expectancy       → 2 pts
 *   winRate          → 1 pt
 *   profitFactor     → 1 pt
 *   sharpeRatio      → 2 pts  (NEW)
 *   sortinoRatio     → 2 pts  (NEW)
 *   consistencyScore → 2 pts  (NEW)
 *   recoveryFactor   → 1.5 pts (NEW)
 *   riskRewardRatio  → 1.5 pts (NEW)
 */
export function computeComparisonScore(
  a: VariantMetrics,
  b: VariantMetrics
): ScoreResult {
  const details: ScoreDetail[] = [
    compareMetric(a.pnl, b.pnl, true, "pnl", 3),
    compareMetric(safeAbs(a.maxDrawdown), safeAbs(b.maxDrawdown), false, "maxDrawdown", 2),
    compareMetric(a.expectancy, b.expectancy, true, "expectancy", 2),
    compareMetric(a.winRate, b.winRate, true, "winRate", 1),
    compareMetric(a.profitFactor, b.profitFactor, true, "profitFactor", 1),
    compareMetric(a.sharpeRatio, b.sharpeRatio, true, "sharpeRatio", 2),
    compareMetric(a.sortinoRatio, b.sortinoRatio, true, "sortinoRatio", 2),
    compareMetric(a.consistencyScore, b.consistencyScore, true, "consistencyScore", 2),
    compareMetric(a.recoveryFactor, b.recoveryFactor, true, "recoveryFactor", 1.5),
    compareMetric(a.riskRewardRatio, b.riskRewardRatio, true, "riskRewardRatio", 1.5),
  ];

  const scoreA = details.reduce((acc, d) => acc + d.gainA, 0);
  const scoreB = details.reduce((acc, d) => acc + d.gainB, 0);
  const total = details.reduce(
    (acc, d) => acc + (d.winner !== "n/a" ? d.weight : 0),
    0
  );

  return { scoreA, scoreB, total, details };
}

export function scoreDominanceRatio(
  scoreA: number,
  scoreB: number,
  total: number
): number {
  if (total === 0) return 0;
  return Math.abs(scoreA - scoreB) / total;
}
