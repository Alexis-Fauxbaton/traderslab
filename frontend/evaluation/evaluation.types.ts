// ============================================================
// evaluation.types.ts — Tous les types du moteur d'évaluation
// ============================================================

export type RunType = "backtest" | "forward" | "live";
export type Severity = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";
export type Verdict = "promising" | "fragile" | "inconclusive" | "invalid";
export type ComparisonVerdict = "promote_a" | "promote_b" | "keep_testing" | "inconclusive";
export type WinnerSide = "a" | "b" | null;
export type WarningTarget = "run" | "variant" | "a" | "b" | "comparison";

// ---- Warning ----

export interface Warning {
  code: string;
  severity: Severity;
  title: string;
  message: string;
  target: WarningTarget;
  meta?: Record<string, unknown>;
}

// ---- Metrics inputs ----

export interface RunMetrics {
  id: string;
  name: string;
  runType: RunType;
  tradeCount: number;
  pnl: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  totalPositivePnl: number | null;
  totalNegativePnl: number | null;
  periodStart: string | Date | null;
  periodEnd: string | Date | null;
  coveredDays: number | null;
}

export interface VariantMetrics {
  id: string;
  name: string;
  tradeCount: number;
  pnl: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  totalPositivePnl: number | null;
  totalNegativePnl: number | null;
  periodStart: string | Date | null;
  periodEnd: string | Date | null;
  coveredDays: number | null;
  runTypes: RunType[];
  runsCount: number | null;
}

export interface ComparisonInput {
  variantA: VariantMetrics;
  variantB: VariantMetrics;
}

// ---- Score breakdown (comparison) ----

export type MetricWinner = "a" | "b" | "tie" | "n/a";

export interface ScoreDetail {
  metric: string;
  winner: MetricWinner;
  weight: number;
  gainA: number;
  gainB: number;
}

export interface ScoreResult {
  scoreA: number;
  scoreB: number;
  /** Nombre total de points jouables (métriques disponibles des deux côtés) */
  total: number;
  details: ScoreDetail[];
}

// ---- Evaluation outputs ----

export interface RecommendedRunAction {
  type: "use_in_variant" | "keep_testing" | "discard_run" | "review_data";
  target: string | null;
}

export interface RecommendedVariantAction {
  type:
    | "promote_to_active_candidate"
    | "keep_testing"
    | "split_by_run_type"
    | "create_iteration"
    | "archive_variant"
    | "review_data";
  target: string | null;
}

export interface RecommendedComparisonAction {
  type: "promote" | "archive_old" | "iterate" | "keep_testing" | "no_action";
  target: WinnerSide;
}

export interface EvaluationResult {
  verdict: Verdict;
  confidence: Confidence;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  reasons: string[];
  warnings: Warning[];
  nextSteps: string[];
  recommendedAction: RecommendedRunAction | RecommendedVariantAction;
}

export interface ComparisonResult {
  verdict: ComparisonVerdict;
  confidence: Confidence;
  winner: WinnerSide;
  summary: string;
  strengthsA: string[];
  weaknessesA: string[];
  strengthsB: string[];
  weaknessesB: string[];
  reasons: string[];
  warnings: Warning[];
  nextSteps: string[];
  score: ScoreResult;
  recommendedAction: RecommendedComparisonAction;
}
