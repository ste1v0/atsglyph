export type AnalysisPriority = "high" | "medium" | "low";
export type MetricStatus = "pass" | "warn" | "fail";
export type MetricGroup = "match" | "content" | "structure";
export type ExampleSource = "cv" | "achievements" | "example_pattern";

export interface LlmSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type LlmCallKind = "quick-score" | "cv-insights" | "cover-letter" | "json-repair";

export interface LlmCallUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCallLogEntry {
  id: string;
  kind: LlmCallKind;
  createdAt: string;
  provider: string;
  model: string;
  durationMs: number;
  promptVersion?: string;
  usage: LlmCallUsage;
}

export interface ScoreDeltaRange {
  min: number;
  max: number;
}

export interface TopAction {
  id: string;
  priority: AnalysisPriority;
  metricId: string;
  metricLabel: string;
  currentScore: number;
  estimatedDelta: ScoreDeltaRange;
  evidence: string;
  issue: string;
  improvementPath: string;
  example: string;
  exampleSource: ExampleSource;
}

export interface MetricCheck {
  id: string;
  label: string;
  score: number;
  status: MetricStatus;
  group: MetricGroup;
}

export interface GoodPoint {
  metricId: string;
  label: string;
  score: number;
}

export interface CVInsightResult {
  schemaVersion: "cv_analysis_actions_v2";
  totalScore: number;
  headline: string;
  summary: string;
  topActions: TopAction[];
  metricChecks: MetricCheck[];
  goodPoints?: GoodPoint[];
}

export type QuickScoreVerdict = "worth_it" | "maybe" | "skip";

export interface QuickScoreResult {
  score: number;
  verdict: QuickScoreVerdict;
}

export type CoverLetterTone = "informal" | "formal";

export interface CoverLetterResult {
  subject: string;
  body: string;
}
