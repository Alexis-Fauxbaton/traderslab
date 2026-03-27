// ============================================================
// evaluation.helpers.ts — Fonctions pures utilitaires
// ============================================================

import type {
  Confidence,
  Warning,
  ScoreDetail,
  ScoreResult,
  VariantMetrics,
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

/**
 * Confiance globale basée sur les warnings :
 * - high warning présent      → low
 * - 2+ medium warnings        → medium
 * - sinon                     → high
 */
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

// ---- Scoring pour la comparaison ----

/**
 * Compare une métrique entre A et B.
 * Retourne le gain de points pour chaque côté selon le poids.
 * Si l'une des valeurs est null → winner = "n/a", aucun point.
 */
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
 * Calcule le score de comparaison pondéré entre deux variantes.
 *
 * Pondérations :
 *   pnl          → 3 pts  (plus élevé = mieux)
 *   maxDrawdown  → 2 pts  (valeur absolue plus faible = mieux)
 *   expectancy   → 2 pts  (plus élevé = mieux)
 *   winRate      → 1 pt   (plus élevé = mieux)
 *   profitFactor → 1 pt   (plus élevé = mieux)
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
  ];

  const scoreA = details.reduce((acc, d) => acc + d.gainA, 0);
  const scoreB = details.reduce((acc, d) => acc + d.gainB, 0);
  const total = details.reduce(
    (acc, d) => acc + (d.winner !== "n/a" ? d.weight : 0),
    0
  );

  return { scoreA, scoreB, total, details };
}

/**
 * Ratio de dominance : à quel point le gagnant domine-t-il ?
 * Retourne un nombre entre 0 et 1 (0 = égalité, 1 = dominance totale).
 */
export function scoreDominanceRatio(
  scoreA: number,
  scoreB: number,
  total: number
): number {
  if (total === 0) return 0;
  return Math.abs(scoreA - scoreB) / total;
}
