// ============================================================
// evaluation.run.ts — Évaluation d'un run unique
// ============================================================

import type {
  RunMetrics,
  EvaluationResult,
  Verdict,
  RecommendedRunAction,
} from "./evaluation.types";
import { collectRunWarnings } from "./evaluation.warnings";
import { computeConfidence, hasHighSeverity, isDrawdownAcceptable } from "./evaluation.helpers";
import {
  buildRunSummary,
  buildRunNextSteps,
  pnlSentence,
  winRateSentence,
  profitFactorSentence,
  drawdownSentence,
  expectancySentence,
  recoveryFactorSentence,
  riskRewardSentence,
  streakSentence,
  consistencySentence,
  degradationSentence,
} from "./evaluation.formatters";

/**
 * Évalue un run unique.
 *
 * Question produit : "Peut-on tirer quelque chose de ce run ou pas ?"
 *
 * Verdicts possibles :
 *   "promising"    — bons indicateurs, pas de warning bloquant
 *   "fragile"      — signaux positifs mais fragilisés
 *   "inconclusive" — pas de signal positif clair
 *   "invalid"      — données insuffisantes ou run vide
 */
export function evaluateRun(run: RunMetrics): EvaluationResult {
  // ---- 1. Collecte des warnings ----
  const warnings = collectRunWarnings(
    {
      tradeCount: run.tradeCount,
      pnl: run.pnl,
      winRate: run.winRate,
      profitFactor: run.profitFactor,
      coveredDays: run.coveredDays,
      totalNegativePnl: run.totalNegativePnl,
      bestTrade: run.bestTrade,
      totalPositivePnl: run.totalPositivePnl,
    },
    "run"
  );

  // ---- 2. Sorties anticipées (invalid) ----

  if (run.tradeCount === 0) {
    return {
      verdict: "invalid",
      confidence: "low",
      summary: "Ce run ne contient aucun trade — évaluation impossible.",
      strengths: [],
      weaknesses: ["Aucun trade enregistré"],
      reasons: ["Le run est vide"],
      warnings,
      nextSteps: [
        "Vérifier les données importées et le format du CSV",
        "Relancer l'import avec le bon mapping de colonnes",
      ],
      recommendedAction: { type: "review_data", target: null },
      robustness: null,
      degradation: null,
      monteCarlo: null,
      significance: null,
    };
  }

  if (run.pnl === null && run.winRate === null && run.profitFactor === null) {
    return {
      verdict: "invalid",
      confidence: "low",
      summary: "Métriques clés introuvables — évaluation impossible.",
      strengths: [],
      weaknesses: ["PnL, win rate et profit factor sont tous absents"],
      reasons: ["Aucune métrique calculable"],
      warnings,
      nextSteps: ["Vérifier le format des données importées et le mapping de colonnes"],
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

  const pnl = pnlSentence(run.pnl, run.runType);
  if (pnl) ((run.pnl ?? -1) >= 0 ? strengths : weaknesses).push(pnl);

  const wr = winRateSentence(run.winRate);
  if (wr) ((run.winRate ?? 0) >= 0.5 ? strengths : weaknesses).push(wr);

  const pf = profitFactorSentence(run.profitFactor);
  if (pf) ((run.profitFactor ?? 0) > 1 ? strengths : weaknesses).push(pf);

  const dd = drawdownSentence(run.maxDrawdown, run.runType);
  if (dd) (isDrawdownAcceptable(run.maxDrawdown) ? strengths : weaknesses).push(dd);

  const exp = expectancySentence(run.expectancy);
  if (exp) ((run.expectancy ?? 0) > 0 ? strengths : weaknesses).push(exp);

  // ---- Pro metrics sentences ----
  const rf = recoveryFactorSentence(run.recoveryFactor);
  if (rf) ((run.recoveryFactor ?? 0) > 1 ? strengths : weaknesses).push(rf);

  const rr = riskRewardSentence(run.riskRewardRatio);
  if (rr) ((run.riskRewardRatio ?? 0) >= 1 ? strengths : weaknesses).push(rr);

  const streak = streakSentence(run.maxConsecutiveLosses);
  if (streak) ((run.maxConsecutiveLosses ?? 0) <= 5 ? strengths : weaknesses).push(streak);

  const cons = consistencySentence(run.consistencyScore);
  if (cons) ((run.consistencyScore ?? 0) >= 50 ? strengths : weaknesses).push(cons);

  const deg = degradationSentence(run.splitHalf);
  if (deg) (run.splitHalf?.status !== "degrading" ? strengths : weaknesses).push(deg);

  // ---- 4. Logique de verdict ----

  const posPnl = run.pnl !== null && run.pnl > 0;
  const goodPF = run.profitFactor !== null && run.profitFactor > 1.3;
  const containedDD = isDrawdownAcceptable(run.maxDrawdown);
  const positiveScore = [posPnl, goodPF, containedDD].filter(Boolean).length;
  const highWarning = hasHighSeverity(warnings);

  let verdict: Verdict;
  let actionType: RecommendedRunAction["type"];
  const reasons: string[] = [];

  if (run.tradeCount < 10) {
    verdict = "invalid";
    actionType = "review_data";
    reasons.push(`Moins de 10 trades (${run.tradeCount}) — jeu de données trop petit pour établir un verdict`);
  } else if (!posPnl && !goodPF) {
    // Aucun indicateur positif clé
    verdict = "inconclusive";
    actionType = "discard_run";
    reasons.push("Ni le PnL ni le Profit Factor ne montrent de signal positif");
  } else if (positiveScore >= 2 && !highWarning) {
    // Clairement positif, pas de warning bloquant
    verdict = "promising";
    actionType = "use_in_variant";
    reasons.push("Bons indicateurs de performance sans warning bloquant");
  } else if (highWarning) {
    // Signal positif mais warning critique présent
    verdict = "fragile";
    actionType = "keep_testing";
    reasons.push("Signaux positifs affaiblis par un ou plusieurs warnings critiques");
  } else {
    // Un indicateur positif mais pas assez pour conclure
    verdict = "fragile";
    actionType = "keep_testing";
    reasons.push("Signaux mitigés — poursuite des tests recommandée");
  }

  // ---- 5. Résultat ----

  return {
    verdict,
    confidence: computeConfidence(warnings),
    summary: buildRunSummary(verdict, run, warnings),
    strengths,
    weaknesses,
    reasons,
    warnings,
    nextSteps: buildRunNextSteps(verdict, warnings),
    recommendedAction: { type: actionType, target: run.id },
    degradation: run.splitHalf ?? null,
  };
}
