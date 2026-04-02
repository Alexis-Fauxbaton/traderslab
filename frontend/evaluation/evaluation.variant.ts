// ============================================================
// evaluation.variant.ts — Évaluation d'une variante
// ============================================================

import type {
  VariantMetrics,
  EvaluationResult,
  Verdict,
  RecommendedVariantAction,
} from "./evaluation.types";
import { collectRunWarnings, warnMixedRunTypes } from "./evaluation.warnings";
import { computeConfidence, hasHighSeverity, isDrawdownAcceptable, computeRobustnessScore } from "./evaluation.helpers";
import {
  buildVariantSummary,
  buildVariantNextSteps,
  pnlSentence,
  winRateSentence,
  profitFactorSentence,
  drawdownSentence,
  expectancySentence,
  sortinoSentence,
  recoveryFactorSentence,
  riskRewardSentence,
  streakSentence,
  consistencySentence,
  significanceSentence,
  monteCarloSentence,
  degradationSentence,
} from "./evaluation.formatters";

/**
 * Évalue une variante à partir de ses métriques agrégées sur tous ses runs.
 *
 * Question produit : "Cette variante semble-t-elle prometteuse, fragile,
 *                    ou non concluante au vu de tous ses runs ?"
 *
 * Verdicts possibles :
 *   "promising"    — indicateurs solides, échantillon suffisant
 *   "fragile"      — points positifs mais risques identifiés
 *   "inconclusive" — pas de signal clair
 *   "invalid"      — aucune donnée exploitable
 */
export function evaluateVariant(variant: VariantMetrics): EvaluationResult {
  // ---- 1. Collecte des warnings ----
  const warnings = collectRunWarnings(
    {
      tradeCount: variant.tradeCount,
      pnl: variant.pnl,
      winRate: variant.winRate,
      profitFactor: variant.profitFactor,
      coveredDays: variant.coveredDays,
      totalNegativePnl: variant.totalNegativePnl,
      bestTrade: variant.bestTrade,
      totalPositivePnl: variant.totalPositivePnl,
    },
    "variant"
  );

  // Warning spécifique au mélange de types de runs
  const mixedWarn = warnMixedRunTypes(variant.runTypes ?? [], "variant");
  if (mixedWarn) warnings.push(mixedWarn);

  // ---- 2. Sorties anticipées (invalid) ----

  if (
    variant.tradeCount === 0 ||
    (variant.runsCount !== null && variant.runsCount === 0)
  ) {
    return {
      verdict: "invalid",
      confidence: "low",
      summary: "Variante sans données — aucun trade disponible.",
      strengths: [],
      weaknesses: ["Aucun trade enregistré sur cette variante"],
      reasons: ["La variante n'a pas encore de runs importés"],
      warnings,
      nextSteps: ["Importer un premier run CSV pour cette variante"],
      recommendedAction: { type: "review_data", target: null },
      robustness: null,
      degradation: null,
      monteCarlo: null,
      significance: null,
    };
  }

  if (variant.pnl === null && variant.winRate === null && variant.profitFactor === null) {
    return {
      verdict: "invalid",
      confidence: "low",
      summary: "Métriques agrégées manquantes — évaluation impossible.",
      strengths: [],
      weaknesses: ["Métriques clés introuvables sur les runs agrégés"],
      reasons: ["Les métriques ne peuvent pas être calculées"],
      warnings,
      nextSteps: ["Vérifier les données importées sur chaque run de cette variante"],
      recommendedAction: { type: "review_data", target: null },
      robustness: null,
      degradation: null,
      monteCarlo: null,
      significance: null,
    };
  }

  // ---- 3. Construction des forces / faiblesses ----

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const pnl = pnlSentence(variant.pnl, "agrégé");
  if (pnl) ((variant.pnl ?? -1) >= 0 ? strengths : weaknesses).push(pnl);

  const wr = winRateSentence(variant.winRate);
  if (wr) ((variant.winRate ?? 0) >= 0.5 ? strengths : weaknesses).push(wr);

  const pf = profitFactorSentence(variant.profitFactor);
  if (pf) ((variant.profitFactor ?? 0) > 1 ? strengths : weaknesses).push(pf);

  const dd = drawdownSentence(variant.maxDrawdown, "agrégé");
  if (dd) (isDrawdownAcceptable(variant.maxDrawdown) ? strengths : weaknesses).push(dd);

  const exp = expectancySentence(variant.expectancy);
  if (exp) ((variant.expectancy ?? 0) > 0 ? strengths : weaknesses).push(exp);

  if (variant.runsCount !== null && variant.runsCount >= 3) {
    strengths.push(`Résultats consolidés sur ${variant.runsCount} runs distincts`);
  }

  // ---- Pro metrics sentences ----
  const sort = sortinoSentence(variant.sortinoRatio);
  if (sort) ((variant.sortinoRatio ?? 0) > 1 ? strengths : weaknesses).push(sort);

  const rf = recoveryFactorSentence(variant.recoveryFactor);
  if (rf) ((variant.recoveryFactor ?? 0) > 1 ? strengths : weaknesses).push(rf);

  const rr = riskRewardSentence(variant.riskRewardRatio);
  if (rr) ((variant.riskRewardRatio ?? 0) >= 1 ? strengths : weaknesses).push(rr);

  const streak = streakSentence(variant.maxConsecutiveLosses);
  if (streak) ((variant.maxConsecutiveLosses ?? 0) <= 5 ? strengths : weaknesses).push(streak);

  const cons = consistencySentence(variant.consistencyScore);
  if (cons) ((variant.consistencyScore ?? 0) >= 50 ? strengths : weaknesses).push(cons);

  const sig = significanceSentence(variant.ttest);
  if (sig) (variant.ttest?.significant_5pct ? strengths : weaknesses).push(sig);

  const mc = monteCarloSentence(variant.monteCarlo);
  if (mc) ((variant.monteCarlo?.pct_profitable ?? 0) >= 60 ? strengths : weaknesses).push(mc);

  const deg = degradationSentence(variant.splitHalf);
  if (deg) (variant.splitHalf?.status !== "degrading" ? strengths : weaknesses).push(deg);

  // ---- 4. Logique de verdict ----

  const posPnl = variant.pnl !== null && variant.pnl > 0;
  const goodPF = variant.profitFactor !== null && variant.profitFactor > 1.3;
  const containedDD = isDrawdownAcceptable(variant.maxDrawdown);
  const hasMixed = warnings.some((w) => w.code === "MIXED_RUN_TYPES");
  const highWarning = hasHighSeverity(warnings);
  const positiveScore = [posPnl, goodPF, containedDD].filter(Boolean).length;

  let verdict: Verdict;
  let actionType: RecommendedVariantAction["type"];
  const reasons: string[] = [];

  if (variant.tradeCount < 10) {
    verdict = "invalid";
    actionType = "review_data";
    reasons.push(`Moins de 10 trades (${variant.tradeCount}) — trop peu pour établir un verdict`);
  } else if (!posPnl && !goodPF) {
    verdict = "inconclusive";
    actionType = "archive_variant";
    reasons.push("Aucun indicateur positif significatif sur les métriques agrégées");
  } else if (hasMixed) {
    // Mélange de types : fragilise systématiquement
    verdict = "fragile";
    actionType = "split_by_run_type";
    reasons.push("Les données mélangent des types de runs différents — conclusions peu fiables");
  } else if (positiveScore >= 2 && !highWarning) {
    verdict = "promising";
    actionType = "promote_to_active_candidate";
    reasons.push("Indicateurs solides et cohérents sur l'ensemble des runs agrégés");
  } else if (highWarning) {
    verdict = "fragile";
    actionType = "keep_testing";
    reasons.push("Performance positive mais fragilisée par un ou plusieurs warnings critiques");
  } else {
    verdict = "fragile";
    actionType = "create_iteration";
    reasons.push("Résultats mitigés — une itération pourrait améliorer les performances");
  }

  // ---- 5. Score de robustesse ----
  const robustness = computeRobustnessScore(variant);

  return {
    verdict,
    confidence: computeConfidence(warnings),
    summary: buildVariantSummary(verdict, variant, warnings),
    strengths,
    weaknesses,
    reasons,
    warnings,
    nextSteps: buildVariantNextSteps(verdict, warnings),
    recommendedAction: { type: actionType, target: variant.id },
    robustness,
    degradation: variant.splitHalf ?? null,
    monteCarlo: variant.monteCarlo ?? null,
    significance: variant.ttest ?? null,
  };
}
