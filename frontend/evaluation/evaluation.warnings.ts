// ============================================================
// evaluation.warnings.ts — Règles de warnings mutualisées
// ============================================================

import type { Warning, WarningTarget, RunType } from "./evaluation.types";

// ---- A. Aucun trade ----

export function warnNoTrades(tradeCount: number, target: WarningTarget): Warning | null {
  if (tradeCount === 0) {
    return {
      code: "NO_TRADES",
      severity: "high",
      title: "Aucun trade",
      message: "Ce jeu de données ne contient aucun trade — évaluation impossible.",
      target,
      meta: { tradeCount },
    };
  }
  return null;
}

// ---- B. Échantillon trop faible ----

export function warnSmallSample(
  tradeCount: number,
  target: WarningTarget,
  minimum = 30
): Warning | null {
  if (tradeCount > 0 && tradeCount < minimum) {
    return {
      code: "SMALL_SAMPLE",
      severity: "high",
      title: "Échantillon trop faible",
      message: `Seulement ${tradeCount} trade${tradeCount > 1 ? "s" : ""} — les conclusions statistiques sont fragiles (minimum recommandé : ${minimum}).`,
      target,
      meta: { tradeCount, minimum },
    };
  }
  return null;
}

// ---- C. Période trop courte ----

export function warnShortPeriod(
  coveredDays: number | null,
  target: WarningTarget,
  minimum = 7
): Warning | null {
  if (coveredDays !== null && coveredDays >= 0 && coveredDays < minimum) {
    return {
      code: "SHORT_PERIOD",
      severity: "medium",
      title: "Période trop courte",
      message: `Période couverte : ${coveredDays} jour${coveredDays > 1 ? "s" : ""}. Au moins ${minimum} jours sont recommandés pour limiter les biais de séquence.`,
      target,
      meta: { coveredDays, minimum },
    };
  }
  return null;
}

// ---- D. Mélange de types de runs (niveau variante) ----

export function warnMixedRunTypes(runTypes: RunType[], target: WarningTarget): Warning | null {
  const unique = [...new Set(runTypes)];
  if (unique.length > 1) {
    return {
      code: "MIXED_RUN_TYPES",
      severity: "high",
      title: "Mélange de types de runs",
      message: `Les données mélangent : ${unique.join(", ")}. Ne pas agréger backtest, forward et live sans distinction.`,
      target,
      meta: { runTypes: unique },
    };
  }
  return null;
}

// ---- E. Performance portée par un seul trade ----

export function warnSingleTradeDominance(
  bestTrade: number | null,
  totalPositivePnl: number | null,
  target: WarningTarget
): Warning | null {
  if (
    bestTrade !== null &&
    bestTrade > 0 &&
    totalPositivePnl !== null &&
    totalPositivePnl > 0
  ) {
    const ratio = bestTrade / totalPositivePnl;
    if (ratio > 0.5) {
      return {
        code: "SINGLE_TRADE_DOMINANCE",
        severity: "high",
        title: "Performance concentrée sur un trade",
        message: `Le meilleur trade représente ${Math.round(ratio * 100)}% du total des gains. La performance dépend fortement d'un seul trade gagnant.`,
        target,
        meta: { bestTrade, totalPositivePnl, ratio },
      };
    }
  }
  return null;
}

// ---- F. Profit Factor peu fiable ----

export function warnUnreliableProfitFactor(
  tradeCount: number,
  totalNegativePnl: number | null,
  target: WarningTarget
): Warning | null {
  if (totalNegativePnl !== null && totalNegativePnl === 0) {
    return {
      code: "PF_NO_LOSSES",
      severity: "medium",
      title: "Profit Factor non significatif",
      message:
        "Aucune perte enregistrée — le Profit Factor ne peut pas être interprété de façon fiable.",
      target,
      meta: { totalNegativePnl },
    };
  }
  if (tradeCount > 0 && tradeCount < 20) {
    return {
      code: "PF_SMALL_SAMPLE",
      severity: "medium",
      title: "Profit Factor peu fiable",
      message: `Moins de 20 trades (${tradeCount}) — le Profit Factor manque de stabilité statistique.`,
      target,
      meta: { tradeCount },
    };
  }
  return null;
}

// ---- G. Expectancy peu fiable ----

export function warnUnreliableExpectancy(
  tradeCount: number,
  target: WarningTarget
): Warning | null {
  if (tradeCount > 0 && tradeCount < 20) {
    return {
      code: "EXPECTANCY_SMALL_SAMPLE",
      severity: "medium",
      title: "Expectancy peu fiable",
      message: `Moins de 20 trades (${tradeCount}) — l'espérance mathématique est peu représentative.`,
      target,
      meta: { tradeCount },
    };
  }
  return null;
}

// ---- H. Données insuffisantes (métriques clés nulles) ----

export function warnMissingCoreMetrics(
  pnl: number | null,
  winRate: number | null,
  profitFactor: number | null,
  target: WarningTarget
): Warning | null {
  const missingCount = [pnl, winRate, profitFactor].filter((v) => v === null).length;
  if (missingCount >= 2) {
    return {
      code: "MISSING_CORE_METRICS",
      severity: "high",
      title: "Données insuffisantes",
      message: "Plusieurs métriques clés sont manquantes — l'évaluation est très limitée.",
      target,
      meta: { missingCount },
    };
  }
  return null;
}

// ---- I. Périodes non comparables (niveau comparaison) ----

export function warnIncomparablePeriods(
  coveredDaysA: number | null,
  coveredDaysB: number | null
): Warning | null {
  if (
    coveredDaysA === null ||
    coveredDaysB === null ||
    coveredDaysA <= 0 ||
    coveredDaysB <= 0
  ) {
    return null;
  }
  const maxDays = Math.max(coveredDaysA, coveredDaysB);
  const diff = Math.abs(coveredDaysA - coveredDaysB);
  const ratio = diff / maxDays;
  if (ratio > 0.2) {
    return {
      code: "INCOMPARABLE_PERIODS",
      severity: ratio > 0.5 ? "high" : "medium",
      title: "Périodes non comparables",
      message: `Les deux variantes couvrent des durées très différentes (${coveredDaysA}j vs ${coveredDaysB}j). Comparer sur une période strictement identique.`,
      target: "comparison",
      meta: { coveredDaysA, coveredDaysB, ratio },
    };
  }
  return null;
}

// ---- J. Déséquilibre du nombre de trades (niveau comparaison) ----

export function warnTradecountImbalance(
  tradeCountA: number,
  tradeCountB: number
): Warning | null {
  if (tradeCountA <= 0 || tradeCountB <= 0) return null;
  const min = Math.min(tradeCountA, tradeCountB);
  const max = Math.max(tradeCountA, tradeCountB);
  const ratio = min / max;
  if (ratio < 0.5) {
    return {
      code: "TRADECOUNT_IMBALANCE",
      severity: "medium",
      title: "Déséquilibre du nombre de trades",
      message: `Les deux variantes ont un volume de trades très différent (${tradeCountA} vs ${tradeCountB}). La comparaison peut être biaisée.`,
      target: "comparison",
      meta: { tradeCountA, tradeCountB, ratio },
    };
  }
  return null;
}

// ---- Collecte mutualisée pour un jeu de métriques de type run/variante ----

type CoreMetricsInput = {
  tradeCount: number;
  pnl: number | null;
  winRate: number | null;
  profitFactor: number | null;
  coveredDays: number | null;
  totalNegativePnl: number | null;
  bestTrade: number | null;
  totalPositivePnl: number | null;
};

export function collectRunWarnings(
  metrics: CoreMetricsInput,
  target: WarningTarget
): Warning[] {
  const warnings: Warning[] = [];
  const push = (w: Warning | null): void => {
    if (w) warnings.push(w);
  };

  push(warnNoTrades(metrics.tradeCount, target));
  push(warnSmallSample(metrics.tradeCount, target));
  push(warnShortPeriod(metrics.coveredDays, target));
  push(warnSingleTradeDominance(metrics.bestTrade, metrics.totalPositivePnl, target));
  push(warnUnreliableProfitFactor(metrics.tradeCount, metrics.totalNegativePnl, target));
  push(warnUnreliableExpectancy(metrics.tradeCount, target));
  push(warnMissingCoreMetrics(metrics.pnl, metrics.winRate, metrics.profitFactor, target));

  return warnings;
}
