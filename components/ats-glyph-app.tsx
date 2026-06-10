"use client";

import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CheckCircle,
  Clipboard,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { convertPdfToImages, extractPdfText } from "@/lib/pdf";
import type {
  CoverLetterResult,
  CoverLetterTone,
  CVInsightResult,
  LlmCallLogEntry,
  LlmSettings,
  MetricCheck,
  QuickScoreResult,
  QuickScoreVerdict,
  TopAction,
} from "@/lib/types";

type ActivePanel = "magic" | "calls" | "achievements" | "keys";
type CvSourceTab = "upload" | "parsed";
type RunState = "idle" | "converting" | "running" | "done";
type QuickScoreState = "idle" | "converting" | "running" | "done";
type SaveState = "idle" | "saving" | "saved" | "error";
type CallLogState = "idle" | "loading" | "clearing";

type ScoreHistoryItem = {
  id: string;
  label: string;
  jobDescription: string;
  result: QuickScoreResult;
  createdAt: number;
};

type BrowserLlmSettings = Required<LlmSettings>;

type ErrorHelp = {
  status?: number;
  providerStatus?: number;
  traceId?: string;
  details?: string;
  fixHints?: string[];
  debug?: {
    endpoint?: string;
    model?: string;
    retryNote?: string;
  };
};

type ApiErrorBody = {
  error?: string;
  details?: unknown;
  fixHints?: string[];
  traceId?: string;
  providerStatus?: number;
  debug?: ErrorHelp["debug"];
};

type ErrorWithHelp = Error & { help?: ErrorHelp };

const STORAGE_KEYS = {
  llmSettings: "atsglyph.llmSettings.v1",
  achievements: "atsglyph.achievements.v1",
} as const;

const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
const DEFAULT_LLM_SETTINGS: BrowserLlmSettings = {
  apiKey: "",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.5-flash",
};

const TONE_OPTIONS: Array<{ value: CoverLetterTone; label: string; hint: string }> = [
  { value: "informal", label: "Informal", hint: "Recommended" },
  { value: "formal", label: "Formal", hint: "Classic structure" },
];

const MENU_ITEMS: Array<{
  id: ActivePanel;
  label: string;
  eyebrow: string;
  icon: LucideIcon;
}> = [
  {
    id: "magic",
    label: "Review",
    eyebrow: "Upload, score, improve",
    icon: WandSparkles,
  },
  {
    id: "calls",
    label: "Usage Log",
    eyebrow: "Calls, tokens, latency",
    icon: Activity,
  },
  {
    id: "achievements",
    label: "Achievements",
    eyebrow: "Private proof notes",
    icon: Trophy,
  },
  {
    id: "keys",
    label: "AI Endpoint",
    eyebrow: "Bring your own key",
    icon: KeyRound,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringifyDebugValue(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function normalizeApiErrorBody(value: unknown): ApiErrorBody {
  if (!isRecord(value)) return {};

  const debug = isRecord(value.debug) ? value.debug : undefined;

  return {
    error: typeof value.error === "string" ? value.error : undefined,
    details: value.details,
    fixHints: Array.isArray(value.fixHints)
      ? value.fixHints.filter((hint): hint is string => typeof hint === "string")
      : undefined,
    traceId: typeof value.traceId === "string" ? value.traceId : undefined,
    providerStatus:
      typeof value.providerStatus === "number" ? value.providerStatus : undefined,
    debug: debug
      ? {
          endpoint: typeof debug.endpoint === "string" ? debug.endpoint : undefined,
          model: typeof debug.model === "string" ? debug.model : undefined,
          retryNote: typeof debug.retryNote === "string" ? debug.retryNote : undefined,
        }
      : undefined,
  };
}

function createApiError(status: number, body: unknown, fallback: string) {
  const normalized = normalizeApiErrorBody(body);
  const error = new Error(normalized.error || fallback) as ErrorWithHelp;
  const details = normalized.details ? stringifyDebugValue(normalized.details) : undefined;

  error.help = {
    status,
    providerStatus: normalized.providerStatus,
    traceId: normalized.traceId,
    details,
    fixHints: normalized.fixHints,
    debug: normalized.debug,
  };

  return error;
}

function normalizeCaughtError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return {
      message: error.message,
      help: (error as ErrorWithHelp).help,
    };
  }

  return {
    message: fallback,
    help: undefined,
  };
}

function isCvInsightResult(value: unknown): value is CVInsightResult {
  const candidate = value as CVInsightResult;
  return (
    Boolean(candidate) &&
    candidate.schemaVersion === "cv_analysis_actions_v2" &&
    typeof candidate.totalScore === "number" &&
    Array.isArray(candidate.topActions)
  );
}

function isCoverLetterResult(value: unknown): value is CoverLetterResult {
  const candidate = value as CoverLetterResult;
  return (
    Boolean(candidate) &&
    typeof candidate.subject === "string" &&
    typeof candidate.body === "string"
  );
}

function isQuickScoreResult(value: unknown): value is QuickScoreResult {
  const candidate = value as QuickScoreResult;
  return (
    Boolean(candidate) &&
    typeof candidate.score === "number" &&
    ["worth_it", "maybe", "skip"].includes(candidate.verdict)
  );
}

function statusLabel(status: MetricCheck["status"]) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WATCH";
  return "FIX";
}

function verdictLabel(verdict: QuickScoreVerdict) {
  if (verdict === "worth_it") return "Worth it";
  if (verdict === "maybe") return "Maybe";
  return "No";
}

function verdictTone(verdict: QuickScoreVerdict) {
  if (verdict === "worth_it") return "success";
  if (verdict === "maybe") return "warning";
  return "danger";
}

function describeJobDescription(value: string) {
  const firstUsefulLine = value
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 6);

  if (!firstUsefulLine) return "Untitled vacancy";
  return firstUsefulLine.length > 58
    ? `${firstUsefulLine.slice(0, 58).trim()}...`
    : firstUsefulLine;
}

function scoreTone(score: number) {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

function parseStoredSettings(raw: string | null, fallback: BrowserLlmSettings) {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;

    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : fallback.apiKey,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : fallback.baseUrl,
      model: typeof parsed.model === "string" ? parsed.model : fallback.model,
    };
  } catch {
    return fallback;
  }
}

function loadStoredSettings() {
  if (typeof window === "undefined") return DEFAULT_LLM_SETTINGS;

  return parseStoredSettings(
    window.localStorage.getItem(STORAGE_KEYS.llmSettings),
    DEFAULT_LLM_SETTINGS,
  );
}

function requestSettings(settings: BrowserLlmSettings): LlmSettings {
  return {
    apiKey: settings.apiKey.trim() || undefined,
    baseUrl: settings.baseUrl.trim() || undefined,
    model: settings.model.trim() || undefined,
  };
}

function hasCompleteLlmSettings(settings: BrowserLlmSettings) {
  return Boolean(
    settings.apiKey.trim() && settings.baseUrl.trim() && settings.model.trim(),
  );
}

function sourceLabel(action: TopAction) {
  if (action.exampleSource === "achievements") return "Achievement";
  if (action.exampleSource === "cv") return "CV rewrite";
  return "Idea";
}

function sourceTone(action: TopAction) {
  if (action.exampleSource === "achievements") return "achievement";
  if (action.exampleSource === "cv") return "cv";
  return "idea";
}

function callKindLabel(kind: LlmCallLogEntry["kind"]) {
  if (kind === "quick-score") return "Quick score";
  if (kind === "cv-insights") return "CV insights";
  if (kind === "json-repair") return "JSON repair";
  return "Cover letter";
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

function isAtsRiskCharacter(character: string) {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return false;

  const isAllowedWhitespace =
    character === "\n" || character === "\r" || character === "\t";

  return (
    character === "\uFFFD" ||
    (codePoint < 32 && !isAllowedWhitespace) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0xfeff ||
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff)
  );
}

function visibleRiskCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint < 32) return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  if (codePoint >= 0x200b && codePoint <= 0x200f) return "ZW";
  if (codePoint === 0xfeff) return "BOM";
  return character;
}

function parsedTokenCore(token: string) {
  return token.replace(/[^A-Za-z]/g, "").toLowerCase();
}

function isLikelyGarbledParsedToken(token: string) {
  const core = parsedTokenCore(token);
  if (core.length < 3) return false;

  return (
    ["cece", "ceceeee", "eeeeee", "eee", "eens", "teen", "ees"].includes(core) ||
    /([a-z])\1{2,}/.test(core) ||
    /^(?:ce){2,}e*$/.test(core) ||
    (core.length >= 4 && new Set(core).size <= 2 && /[ce]/.test(core))
  );
}

function analyzeParsedCvText(text: string) {
  const characters = Array.from(text);
  const riskyCharacters = characters.filter(isAtsRiskCharacter);
  const riskyCharacterCount = riskyCharacters.length;
  const garbledTokenCount = text
    .split(/\s+/)
    .filter(isLikelyGarbledParsedToken).length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lineCount = text.trim() ? text.split(/\n/).length : 0;

  return {
    characterCount: characters.length,
    wordCount,
    lineCount,
    garbledTokenCount,
    riskyCharacterCount,
    status:
      !text.trim() ? "empty" : riskyCharacterCount || garbledTokenCount ? "watch" : "good",
  };
}

function ParsedTextPreview({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <div className="parsed-text-empty">
        Upload a text-based PDF to see the exact text Quick Score will read.
      </div>
    );
  }

  const allCharacters = Array.from(text);
  const segments = text.match(/\s+|\S+/g) ?? [];
  const previewSegments: string[] = [];
  let previewCharacterCount = 0;

  for (const segment of segments) {
    if (previewCharacterCount >= 20_000) break;

    const nextSegment = Array.from(segment).slice(0, 20_000 - previewCharacterCount).join("");
    previewSegments.push(nextSegment);
    previewCharacterCount += Array.from(nextSegment).length;
  }

  const isTrimmed = previewCharacterCount < allCharacters.length;

  return (
    <pre className="parsed-text-preview">
      {previewSegments.map((segment, segmentIndex) => {
        if (/^\s+$/.test(segment)) {
          return <span key={`${segmentIndex}-space`}>{segment}</span>;
        }

        if (isLikelyGarbledParsedToken(segment)) {
          return (
            <mark
              aria-label={`Possibly garbled PDF text token ${segment}`}
              key={`${segmentIndex}-garbled`}
              title={`Possibly garbled PDF text token: ${segment}`}
            >
              {segment}
            </mark>
          );
        }

        return Array.from(segment).map((character, characterIndex) =>
          isAtsRiskCharacter(character) ? (
            <mark
              aria-label={`Possibly unreliable ATS character ${visibleRiskCharacter(character)}`}
              key={`${segmentIndex}-${characterIndex}-risk`}
              title={`Possibly unreliable ATS character: ${visibleRiskCharacter(character)}`}
            >
              {visibleRiskCharacter(character)}
            </mark>
          ) : (
            <span key={`${segmentIndex}-${characterIndex}`}>{character}</span>
          ),
        );
      })}
      {isTrimmed && "\n\n[Preview trimmed after 20,000 characters]"}
    </pre>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 48;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={`score-ring ${scoreTone(score)}`}>
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          opacity="0.12"
          r={normalizedRadius}
          cx="56"
          cy="56"
        />
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          r={normalizedRadius}
          cx="56"
          cy="56"
          transform="rotate(-90 56 56)"
        />
      </svg>
      <strong>{Math.round(score)}</strong>
      <span>/100</span>
    </div>
  );
}

function ModuleCards() {
  return (
    <div className="hero-relics" aria-label="ATS Glyph modules">
      <article className="relic-card parse">
        <div className="relic-icon">
          <FileText aria-hidden="true" />
        </div>
        <span>01</span>
        <h2>CV Text</h2>
        <p>Preview the text parsers can read.</p>
      </article>
      <article className="relic-card glyph">
        <div className="relic-icon">
          <BadgeCheck aria-hidden="true" />
        </div>
        <span>02</span>
        <h2>Fit Score</h2>
        <p>Check the CV against one role.</p>
      </article>
      <article className="relic-card runes">
        <div className="relic-icon">
          <WandSparkles aria-hidden="true" />
        </div>
        <span>03</span>
        <h2>CV Fixes</h2>
        <p>Work on the highest-impact gaps.</p>
      </article>
      <article className="relic-card scribe">
        <div className="relic-icon">
          <ScrollText aria-hidden="true" />
        </div>
        <span>04</span>
        <h2>Cover Letter</h2>
        <p>Draft a specific first version.</p>
      </article>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: MetricCheck[] }) {
  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <div className={`metric ${metric.status}`} key={metric.id}>
          <span>{statusLabel(metric.status)}</span>
          <strong>{metric.score}</strong>
          <p>{metric.label}</p>
        </div>
      ))}
    </div>
  );
}

function QuickScoreView({ result }: { result: QuickScoreResult }) {
  const tone = verdictTone(result.verdict);

  return (
    <div className={`quick-score-result score-only ${tone}`}>
      <div className="quick-score-stamp">
        <BadgeCheck aria-hidden="true" />
        <strong>{Math.round(result.score)}</strong>
        <span>{verdictLabel(result.verdict)}</span>
      </div>
    </div>
  );
}

function LockedOverlay({
  title,
  description,
  onOpenKeys,
}: {
  title: string;
  description: string;
  onOpenKeys: () => void;
}) {
  return (
    <div className="locked-overlay">
      <KeyRound aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
      <button className="ghost-button" onClick={onOpenKeys} type="button">
        <KeyRound aria-hidden="true" />
        Keys
      </button>
    </div>
  );
}

function CoverLetterEditor({ result }: { result: CoverLetterResult }) {
  const [subject, setSubject] = useState(result.subject);
  const [body, setBody] = useState(result.body);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSubject(result.subject);
    setBody(result.body);
    setCopied(false);
  }, [result]);

  async function copyLetter() {
    await navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="result-card letter-card">
      <div className="card-heading">
        <ScrollText aria-hidden="true" />
        <div>
          <p className="eyebrow">COVER LETTER</p>
          <h2>Editable draft</h2>
        </div>
      </div>

      <label className="field">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>

      <label className="editor-block letter-editor">
        <span>cover_letter.txt</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={6_000}
        />
        <small>{body.trim().length} / 6000</small>
      </label>

      <button className="ghost-button" onClick={copyLetter} type="button">
        <Clipboard aria-hidden="true" />
        {copied ? "Copied" : "Copy letter"}
      </button>
    </section>
  );
}

function SettingsFields({
  settings,
  onChange,
}: {
  settings: BrowserLlmSettings;
  onChange: (settings: BrowserLlmSettings) => void;
}) {
  return (
    <div className="settings-fields">
      <div className="gemini-setup-card">
        <KeyRound aria-hidden="true" />
        <div>
          <strong>Gemini API key</strong>
          <span>AI Studio opens in a new tab. Paste the key here.</span>
        </div>
        <a href={GEMINI_KEY_URL} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" />
          Get key
        </a>
      </div>

      <div className="key-fields-grid">
        <label className="field">
          <span>Base URL</span>
          <input
            value={settings.baseUrl}
            onChange={(event) =>
              onChange({
                ...settings,
                baseUrl: event.target.value,
              })
            }
            placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
          />
        </label>

        <label className="field">
          <span>Model</span>
          <input
            value={settings.model}
            onChange={(event) =>
              onChange({
                ...settings,
                model: event.target.value,
              })
            }
            placeholder="gemini-3.5-flash"
          />
        </label>

        <label className="field">
          <span>API key</span>
          <input
            value={settings.apiKey}
            onChange={(event) => onChange({ ...settings, apiKey: event.target.value })}
            placeholder="Paste API key"
            type="password"
            autoComplete="off"
          />
        </label>
      </div>
    </div>
  );
}

export function ATSGlyphApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>("magic");
  const [runState, setRunState] = useState<RunState>("idle");
  const [quickScoreState, setQuickScoreState] = useState<QuickScoreState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [activeCvSourceTab, setActiveCvSourceTab] = useState<CvSourceTab>("upload");
  const [images, setImages] = useState<string[]>([]);
  const [cvText, setCvText] = useState("");
  const [cvTextState, setCvTextState] = useState<"idle" | "extracting" | "done">("idle");
  const [jobDescription, setJobDescription] = useState("");
  const [achievements, setAchievements] = useState("");
  const [llmSettings, setLlmSettings] = useState(DEFAULT_LLM_SETTINGS);
  const [achievementsSaveState, setAchievementsSaveState] = useState<SaveState>("idle");
  const [callLog, setCallLog] = useState<LlmCallLogEntry[]>([]);
  const [callLogState, setCallLogState] = useState<CallLogState>("idle");
  const [companyComment, setCompanyComment] = useState("");
  const [tone, setTone] = useState<CoverLetterTone>("informal");
  const [runCv, setRunCv] = useState(true);
  const [runCl, setRunCl] = useState(true);
  const [quickScore, setQuickScore] = useState<QuickScoreResult | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryItem[]>([]);
  const [cvResult, setCvResult] = useState<CVInsightResult | null>(null);
  const [clResult, setClResult] = useState<CoverLetterResult | null>(null);
  const [error, setError] = useState("");
  const [errorHelp, setErrorHelp] = useState<ErrorHelp | null>(null);
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const storedAchievements = window.localStorage.getItem(STORAGE_KEYS.achievements);
    const storedSettings = loadStoredSettings();

    setLlmSettings(storedSettings);

    if (storedAchievements !== null) {
      setAchievements(storedAchievements);
      setHasHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    fetch("/api/achievements")
      .then(async (response) => {
        const data = (await response.json()) as { achievements?: string };
        if (!cancelled && typeof data.achievements === "string") {
          setAchievements(data.achievements);
        }
      })
      .catch(() => {
        if (!cancelled) setAchievements("");
      })
      .finally(() => {
        if (!cancelled) setHasHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadCallLog();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    window.localStorage.setItem(STORAGE_KEYS.llmSettings, JSON.stringify(llmSettings));
    window.localStorage.setItem(STORAGE_KEYS.achievements, achievements);
  }, [achievements, hasHydrated, llmSettings]);

  const activeMenuItem = MENU_ITEMS.find((item) => item.id === activePanel) || MENU_ITEMS[0];
  const heroLine =
    "Preview the CV text an ATS can read, score it against one role, fix the biggest gaps, and draft a specific cover letter.";
  const llmSettingsReady = hasCompleteLlmSettings(llmSettings);
  const needsInitialKey = !llmSettingsReady;

  const canQuickScore =
    Boolean(file) &&
    llmSettingsReady &&
    cvText.trim().length >= 100 &&
    jobDescription.trim().length >= 200 &&
    cvTextState !== "extracting" &&
    quickScoreState !== "converting" &&
    quickScoreState !== "running" &&
    runState !== "converting" &&
    runState !== "running";

  const canRun =
    Boolean(file) &&
    llmSettingsReady &&
    jobDescription.trim().length >= 200 &&
    (runCv || runCl) &&
    quickScoreState !== "converting" &&
    quickScoreState !== "running" &&
    runState !== "converting" &&
    runState !== "running";

  const hasResult = Boolean(cvResult || clResult);
  const callTotals = useMemo(() => {
    return {
      calls: callLog.length,
      totalTokens: callLog.reduce((sum, call) => sum + call.usage.totalTokens, 0),
      promptTokens: callLog.reduce((sum, call) => sum + call.usage.promptTokens, 0),
      completionTokens: callLog.reduce((sum, call) => sum + call.usage.completionTokens, 0),
    };
  }, [callLog]);

  const cvTextAudit = useMemo(() => analyzeParsedCvText(cvText), [cvText]);

  function clearAppError() {
    setError("");
    setErrorHelp(null);
  }

  function showAppError(message: string, help?: ErrorHelp) {
    setError(message);
    setErrorHelp(help ?? null);
  }

  function showCaughtError(errorValue: unknown, fallback: string) {
    const normalized = normalizeCaughtError(errorValue, fallback);
    showAppError(normalized.message, normalized.help);
  }

  async function selectFile(nextFile: File | null | undefined) {
    if (!nextFile) return;

    if (nextFile.type !== "application/pdf") {
      showAppError("Upload a PDF CV.", {
        fixHints: ["Choose a .pdf file. ATS Glyph renders PDF pages for Full Analysis."],
      });
      return;
    }

    setFile(nextFile);
    setActiveCvSourceTab("upload");
    setImages([]);
    setCvText("");
    setCvTextState("extracting");
    setQuickScore(null);
    setScoreHistory([]);
    setQuickScoreState("idle");
    setCvResult(null);
    setClResult(null);
    clearAppError();

    try {
      const text = await extractPdfText(nextFile);
      if (text.length < 100) {
        throw new Error(
          "Quick score needs selectable CV text. You can still run the full CV analysis.",
        );
      }
      setCvText(text);
      setCvTextState("done");
      setActiveCvSourceTab("parsed");
    } catch (textError) {
      setCvTextState("idle");
      showCaughtError(textError, "Could not extract CV text.");
    }
  }

  function updateJobDescription(value: string) {
    setJobDescription(value);
    setQuickScore(null);
    setQuickScoreState("idle");
    setCvResult(null);
    setClResult(null);
  }

  function startNewVacancy() {
    setJobDescription("");
    setQuickScore(null);
    setQuickScoreState("idle");
    setCvResult(null);
    setClResult(null);
    clearAppError();
  }

  function restoreScoreHistory(item: ScoreHistoryItem) {
    setActivePanel("magic");
    setJobDescription(item.jobDescription);
    setQuickScore(item.result);
    setQuickScoreState("done");
    setCvResult(null);
    setClResult(null);
    clearAppError();
  }

  async function ensureConvertedImages() {
    if (!file) return [];
    if (images.length) return images;

    const convertedImages = await convertPdfToImages(file);
    setImages(convertedImages);
    return convertedImages;
  }

  async function persistAchievements(nextAchievements: string) {
    setAchievementsSaveState("saving");

    try {
      const response = await fetch("/api/achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievements: nextAchievements }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw createApiError(response.status, data, "Could not save ACHIEVEMENTS.md.");
      }

      setAchievements(data.achievements ?? nextAchievements);
      setAchievementsSaveState("saved");
      window.setTimeout(() => setAchievementsSaveState("idle"), 1800);
    } catch (saveError) {
      setAchievementsSaveState("error");
      showCaughtError(saveError, "Could not save achievements.");
    }
  }

  async function loadCallLog() {
    setCallLogState("loading");

    try {
      const response = await fetch("/api/calls");
      const data = (await response.json()) as { calls?: LlmCallLogEntry[]; error?: string };

      if (!response.ok) {
        throw createApiError(response.status, data, "Could not load LLM calls.");
      }

      setCallLog(Array.isArray(data.calls) ? data.calls : []);
    } catch (callError) {
      showCaughtError(callError, "Could not load LLM calls.");
    } finally {
      setCallLogState("idle");
    }
  }

  async function clearCallLog() {
    setCallLogState("clearing");

    try {
      const response = await fetch("/api/calls", { method: "DELETE" });
      const data = (await response.json()) as { calls?: LlmCallLogEntry[]; error?: string };

      if (!response.ok) {
        throw createApiError(response.status, data, "Could not clear LLM calls.");
      }

      setCallLog([]);
    } catch (callError) {
      showCaughtError(callError, "Could not clear LLM calls.");
    } finally {
      setCallLogState("idle");
    }
  }

  async function copyAction(action: TopAction) {
    await navigator.clipboard?.writeText(action.example);
    setCopiedActionId(action.id);
    window.setTimeout(() => setCopiedActionId(null), 1600);
  }

  async function runQuickScore() {
    if (!file) return;
    if (!llmSettingsReady) {
      setActivePanel("keys");
      showAppError("Add your AI endpoint under Keys first.");
      return;
    }

    setActivePanel("magic");
    clearAppError();
    setQuickScore(null);

    try {
      setQuickScoreState("running");

      const response = await fetch("/api/quick-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvText,
          jobDescription,
          settings: requestSettings(llmSettings),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createApiError(response.status, data, "The quick score failed.");
      }

      if (!isQuickScoreResult(data.result)) {
        throw new Error("The quick score returned an unexpected format.");
      }

      setQuickScore(data.result);
      setScoreHistory((items) => {
        const nextItem: ScoreHistoryItem = {
          id: `${Date.now()}`,
          label: describeJobDescription(jobDescription),
          jobDescription,
          result: data.result,
          createdAt: Date.now(),
        };
        const withoutDuplicate = items.filter(
          (item) => item.jobDescription.trim() !== jobDescription.trim(),
        );
        return [nextItem, ...withoutDuplicate].slice(0, 6);
      });
      setQuickScoreState("done");
      void loadCallLog();
    } catch (scoreError) {
      showCaughtError(scoreError, "The quick score failed.");
      setQuickScoreState("idle");
    }
  }

  async function runWorkflow() {
    if (!file) return;
    if (!llmSettingsReady) {
      setActivePanel("keys");
      showAppError("Add your AI endpoint under Keys first.");
      return;
    }

    setActivePanel("magic");
    clearAppError();
    setCvResult(null);
    setClResult(null);

    try {
      setRunState("converting");
      const convertedImages = await ensureConvertedImages();

      setRunState("running");

      const payload = {
        images: convertedImages,
        jobDescription,
        achievements: achievements || undefined,
        settings: requestSettings(llmSettings),
      };

      const requests: Array<Promise<Response>> = [];
      if (runCv) {
        requests.push(
          fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        );
      }

      if (runCl) {
        requests.push(
          fetch("/api/cover-letter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              tone,
              companyComment: companyComment || undefined,
            }),
          }),
        );
      }

      const responses = await Promise.all(requests);
      const jsonResponses = await Promise.all(
        responses.map(async (response) => ({
          ok: response.ok,
          status: response.status,
          body: await response.json().catch(() => ({})),
        })),
      );

      const failures = jsonResponses.filter((response) => !response.ok);
      if (failures.length === jsonResponses.length) {
        const failure = failures[0];
        throw createApiError(failure?.status || 500, failure?.body, "The workflow failed.");
      }

      for (const response of jsonResponses) {
        if (!response.ok) continue;
        if (isCvInsightResult(response.body.result)) {
          setCvResult(response.body.result);
        }
        if (isCoverLetterResult(response.body.result)) {
          setClResult(response.body.result);
        }
      }

      if (failures.length) {
        const failure = failures[0];
        const partialError = createApiError(
          failure.status,
          failure.body,
          "Part of the full analysis failed.",
        );
        showAppError(`Part of the full analysis failed: ${partialError.message}`, partialError.help);
      }

      setRunState("done");
      void loadCallLog();
    } catch (workflowError) {
      showCaughtError(workflowError, "The workflow failed.");
      setRunState("idle");
    }
  }

  const magicPanel = (
    <>
      <div className="magic-grid">
        <section
          className={[
            "vacancy-panel cv-source-card magic-upload-panel",
            !llmSettingsReady ? "blocked-panel" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={["magic-card-body", !llmSettingsReady ? "blocked-content" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CV SOURCE</p>
                <h3>{file ? "CV loaded" : "Upload CV"}</h3>
              </div>
              <div className={`state-pill ${cvTextState === "done" ? "done" : "idle"}`}>
                {cvTextState === "extracting" ? (
                  <Loader2 className="spin" aria-hidden="true" />
                ) : (
                  <CheckCircle aria-hidden="true" />
                )}
                {cvTextState === "extracting" ? "TEXT" : cvText ? "READY" : "WAITING"}
              </div>
            </div>

            <div className="segmented cv-source-tabs" aria-label="CV source preview">
              <button
                className={activeCvSourceTab === "upload" ? "active" : ""}
                onClick={() => setActiveCvSourceTab("upload")}
                type="button"
              >
                Upload
              </button>
              <button
                className={activeCvSourceTab === "parsed" ? "active" : ""}
                onClick={() => setActiveCvSourceTab("parsed")}
                type="button"
              >
                Parsed text
                {cvTextAudit.riskyCharacterCount + cvTextAudit.garbledTokenCount > 0 && (
                  <span className="tab-alert">
                    {formatTokenCount(
                      cvTextAudit.riskyCharacterCount + cvTextAudit.garbledTokenCount,
                    )}
                  </span>
                )}
              </button>
            </div>

            {activeCvSourceTab === "upload" ? (
              <div
                className="dropzone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void selectFile(event.dataTransfer.files[0]);
                }}
                role="button"
                tabIndex={0}
              >
                <UploadCloud aria-hidden="true" />
                <div>
                  <h3>{file ? "CV loaded" : "Drop PDF"}</h3>
                  <small>PDF parsing runs in your browser. AI calls use your endpoint.</small>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => void selectFile(event.target.files?.[0])}
                  hidden
                />
              </div>
            ) : (
              <div className="parsed-text-panel">
                <div className={`parsed-text-alert ${cvTextAudit.status}`}>
                  <FileText aria-hidden="true" />
                  <div>
                    <strong>
                      {cvTextAudit.status === "empty"
                        ? "No parsed text yet"
                        : cvTextAudit.status === "watch"
                          ? "PDF text layer looks unreliable"
                          : "Parsed text looks readable"}
                    </strong>
                    <span>
                      {cvTextAudit.status === "empty"
                        ? "Upload a PDF to preview what Quick Score will actually read."
                        : cvTextAudit.status === "watch"
                          ? "Probably a template/export issue. Re-export a simpler PDF without icon fonts, progress bars, decorative symbols, or hidden text."
                          : "Quick Score uses this extracted text, not the visual PDF layout."}
                      {cvTextAudit.status !== "empty" && (
                        <>
                          {" "}
                          {formatTokenCount(cvTextAudit.wordCount)} words /{" "}
                          {formatTokenCount(cvTextAudit.characterCount)} characters /{" "}
                          {formatTokenCount(cvTextAudit.lineCount)} lines
                          {cvTextAudit.garbledTokenCount
                            ? ` / ${formatTokenCount(cvTextAudit.garbledTokenCount)} garbled tokens`
                            : ""}
                          .
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <ParsedTextPreview text={cvText} />
              </div>
            )}

            <div className="cv-source-stats">
              <div>
                <span>Text ready</span>
                <strong>{cvTextState === "extracting" ? "..." : cvText ? "YES" : "-"}</strong>
              </div>
              <div>
                <span>Pages ready</span>
                <strong>{images.length || "-"}</strong>
              </div>
              <div>
                <span>Words parsed</span>
                <strong>{cvText ? formatTokenCount(cvTextAudit.wordCount) : "-"}</strong>
              </div>
              <div
                className={
                  cvTextAudit.riskyCharacterCount + cvTextAudit.garbledTokenCount
                    ? "warn"
                    : ""
                }
              >
                <span>ATS-risk text</span>
                <strong>
                  {cvText
                    ? formatTokenCount(
                        cvTextAudit.riskyCharacterCount + cvTextAudit.garbledTokenCount,
                      )
                    : "-"}
                </strong>
              </div>
            </div>
          </div>
          {!llmSettingsReady && (
            <LockedOverlay
              title="Add your AI endpoint"
              description="Fill Base URL, Model, and API key once under Keys."
              onOpenKeys={() => {
                setActivePanel("keys");
              }}
            />
          )}
        </section>

        <section className={["vacancy-panel", !llmSettingsReady ? "blocked-panel" : ""]
          .filter(Boolean)
          .join(" ")}
        >
          <div
            className={["magic-card-body", !llmSettingsReady ? "blocked-content" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CURRENT VACANCY</p>
                <h3>
                  {jobDescription.trim()
                    ? describeJobDescription(jobDescription)
                    : "Paste vacancy"}
                </h3>
              </div>
              <button className="ghost-button" onClick={startNewVacancy} type="button">
                <FileText aria-hidden="true" />
                New
              </button>
            </div>

            <label className="editor-block vacancy-editor">
              <span>job_description.txt</span>
              <textarea
                value={jobDescription}
                onChange={(event) => updateJobDescription(event.target.value)}
                placeholder="Paste the vacancy or job description here."
                maxLength={10_000}
              />
              <small>{jobDescription.trim().length} / 10000</small>
            </label>
          </div>
          {!llmSettingsReady && (
            <LockedOverlay
              title="Add your AI endpoint"
              description="After the three Keys fields are filled, this editor is ready."
              onOpenKeys={() => {
                setActivePanel("keys");
              }}
            />
          )}
        </section>
      </div>

      <section className={`context-status ${achievements.trim() ? "ready" : "empty"}`}>
        <div className="context-status-main">
          <div className="context-status-icon">
            <Trophy aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">ACHIEVEMENTS STATUS</p>
            <h3>
              {achievements.trim()
                ? "Achievements added. Full analysis gets extra context."
                : "No achievements yet. Add them for stronger examples."}
            </h3>
          </div>
        </div>
        <button
          className="ghost-button"
          onClick={() => setActivePanel("achievements")}
          type="button"
        >
          <Trophy aria-hidden="true" />
          {achievements.trim() ? "Edit" : "Add"}
        </button>
      </section>

      <div className="review-options-grid">
        <section
          className={[
            "quick-score-card artifact-panel glyph-score-panel",
            !llmSettingsReady ? "blocked-panel" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={["magic-card-body", !llmSettingsReady ? "blocked-content" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="quick-score-head">
              <div>
                <p className="eyebrow">FAST CHECK</p>
                <h2>Quick score</h2>
              </div>
              <div className={`state-pill ${quickScoreState}`}>
                {quickScoreState === "converting" || quickScoreState === "running" ? (
                  <Loader2 className="spin" aria-hidden="true" />
                ) : (
                  <CheckCircle aria-hidden="true" />
                )}
                {quickScoreState.toUpperCase()}
              </div>
            </div>

            {quickScore ? (
              <QuickScoreView result={quickScore} />
            ) : (
              <div className="empty-score-state">
                <BadgeCheck aria-hidden="true" />
                <strong>-</strong>
                <span>Quick score</span>
              </div>
            )}
            <button
              className="ghost-button quick-score-button"
              disabled={!canQuickScore}
              onClick={runQuickScore}
              type="button"
            >
              {quickScoreState === "converting" || quickScoreState === "running" ? (
                <Loader2 className="spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Run quick score
            </button>
          </div>
          {!llmSettingsReady && (
            <LockedOverlay
              title="Add your AI endpoint"
              description="Quick Score uses the same endpoint as Full Review."
              onOpenKeys={() => {
                setActivePanel("keys");
              }}
            />
          )}
        </section>

        <section
          className={[
            "full-check-card artifact-panel",
            !llmSettingsReady ? "blocked-panel" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={["magic-card-body", !llmSettingsReady ? "blocked-content" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">FULL REVIEW</p>
                <h2>CV insights & cover letter</h2>
              </div>
              <div className={`state-pill ${runState}`}>
                {runState === "converting" || runState === "running" ? (
                  <Loader2 className="spin" aria-hidden="true" />
                ) : (
                  <CheckCircle aria-hidden="true" />
                )}
                {runState.toUpperCase()}
              </div>
            </div>

            <div className="controls-row compact">
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={runCv}
                  onChange={(event) => setRunCv(event.target.checked)}
                />
                <span>
                  <WandSparkles aria-hidden="true" />
                  CV insights
                </span>
              </label>

              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={runCl}
                  onChange={(event) => setRunCl(event.target.checked)}
                />
                <span>
                  <ScrollText aria-hidden="true" />
                  Cover letter
                </span>
              </label>
            </div>

            <div className={["cl-options compact", !runCl ? "locked-options" : ""]
              .filter(Boolean)
              .join(" ")}
            >
              <div className={!runCl ? "blocked-content" : ""}>
                <div className="segmented" aria-label="Cover letter tone">
                  {TONE_OPTIONS.map((nextTone) => (
                    <button
                      key={nextTone.value}
                      className={tone === nextTone.value ? "active" : ""}
                      onClick={() => runCl && setTone(nextTone.value)}
                      type="button"
                      title={nextTone.hint}
                    >
                      {nextTone.label}
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>Company note</span>
                  <input
                    value={companyComment}
                    onChange={(event) => runCl && setCompanyComment(event.target.value)}
                    maxLength={700}
                    placeholder="Optional motivation or company context."
                  />
                </label>
              </div>
              {!runCl && (
                <div className="mini-locked-overlay">
                  Enable Cover letter to pick these options.
                </div>
              )}
            </div>

            <button className="launch-button" disabled={!canRun} onClick={runWorkflow}>
              {runState === "converting" || runState === "running" ? (
                <Loader2 className="spin" aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              Run full analysis
            </button>
          </div>
          {!llmSettingsReady && (
            <LockedOverlay
              title="Add your AI endpoint"
              description="Use a vision-capable model for PDF page analysis."
              onOpenKeys={() => {
                setActivePanel("keys");
              }}
            />
          )}
        </section>
      </div>
    </>
  );

  const achievementsPanel = (
    <div className="achievements-workspace">
      <section className="result-card achievements-editor-card">
        <div className="card-heading">
          <Trophy aria-hidden="true" />
          <div>
            <p className="eyebrow">ACHIEVEMENTS_RAW_INPUT</p>
            <h2>Achievements</h2>
          </div>
        </div>

        <label className="editor-block achievements-editor">
          <span>ACHIEVEMENTS.md</span>
          <textarea
            value={achievements}
            onChange={(event) => {
              setAchievements(event.target.value);
              setAchievementsSaveState("idle");
            }}
            placeholder={[
              "Weak:",
              "- I wrote code",
              "- I worked with people",
              "",
              "Better:",
              "- Increased checkout conversion by 25% after simplifying the payment flow.",
              "- Led 5 engineers through a migration that cut report generation from 4 hours to 30 minutes.",
            ].join("\n")}
            maxLength={6_000}
          />
          <small>{achievements.trim().length} / 6000</small>
        </label>

        <div className="button-row">
          <button
            className="brutal-button inline"
            onClick={() => void persistAchievements(achievements)}
            type="button"
          >
            {achievementsSaveState === "saving" ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {achievementsSaveState === "saved" ? "Saved" : "Save file"}
          </button>
          <button
            className="ghost-button danger"
            onClick={() => void persistAchievements("")}
            type="button"
          >
            <Trash2 aria-hidden="true" />
            Clear
          </button>
        </div>
      </section>

      <aside className="achievements-guide">
        <section className="guide-card primary">
          <div className="card-heading">
            <Sparkles aria-hidden="true" />
            <div>
              <p className="eyebrow">WHY THIS MATTERS</p>
              <h3>Private context</h3>
            </div>
          </div>
          <ul>
            <li>Turns private proof into stronger CV bullet suggestions.</li>
            <li>Gives cover letters facts that do not sound templated.</li>
            <li>Helps you prepare performance review and interview stories.</li>
          </ul>
        </section>

        <section className="guide-card">
          <p className="eyebrow">TIPS</p>
          <p>Use numbers, time frames, team size, money, growth, time saved, or quality gains.</p>
          <p>Keep rough notes here for the app to turn them into cleaner examples later.</p>
          <p>These facts do not affect the CV score until they are added to the submitted CV.</p>
        </section>
      </aside>
    </div>
  );

  const callsPanel = (
    <section className="result-card calls-panel">
      <div className="card-heading">
        <Activity aria-hidden="true" />
        <div>
          <p className="eyebrow">LLM_CALLS.json</p>
          <h2>Usage log</h2>
        </div>
      </div>

      <div className="button-row">
        <button
          className="ghost-button"
          disabled={callLogState !== "idle"}
          onClick={() => void loadCallLog()}
          type="button"
        >
          {callLogState === "loading" ? (
            <Loader2 className="spin" aria-hidden="true" />
          ) : (
            <Activity aria-hidden="true" />
          )}
          Refresh
        </button>
        <button
          className="ghost-button danger"
          disabled={callLogState !== "idle" || !callLog.length}
          onClick={() => void clearCallLog()}
          type="button"
        >
          {callLogState === "clearing" ? (
            <Loader2 className="spin" aria-hidden="true" />
          ) : (
            <Trash2 aria-hidden="true" />
          )}
          Clear log
        </button>
      </div>

      <div className="usage-summary-grid">
        <div>
          <span>Calls</span>
          <strong>{callTotals.calls}</strong>
        </div>
        <div>
          <span>Input tokens</span>
          <strong>{formatTokenCount(callTotals.promptTokens)}</strong>
        </div>
        <div>
          <span>Output tokens</span>
          <strong>{formatTokenCount(callTotals.completionTokens)}</strong>
        </div>
        <div>
          <span>Total tokens</span>
          <strong>{formatTokenCount(callTotals.totalTokens)}</strong>
        </div>
      </div>

      {callLog.length ? (
        <div className="call-log-list">
          {callLog.map((call) => (
            <article key={call.id}>
              <div className="call-log-main">
                <span>{callKindLabel(call.kind)}</span>
                <strong>{call.model}</strong>
                <small>
                  {call.provider} / {new Date(call.createdAt).toLocaleString()} /{" "}
                  {Math.round(call.durationMs / 100) / 10}s
                </small>
              </div>
              <div className="call-log-metrics">
                <div>
                  <span>Prompt</span>
                  <strong>{formatTokenCount(call.usage.promptTokens)}</strong>
                </div>
                <div>
                  <span>Output</span>
                  <strong>{formatTokenCount(call.usage.completionTokens)}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{formatTokenCount(call.usage.totalTokens)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">
          Run a quick score or full analysis and ATS Glyph will write local usage
          details here.
        </p>
      )}
    </section>
  );

  const keysPanel = (
    <section className="result-card keys-panel">
      <div className="card-heading">
        <KeyRound aria-hidden="true" />
        <div>
          <p className="eyebrow">AI SETTINGS</p>
          <h2>AI endpoint</h2>
        </div>
      </div>

      <div className="key-tab-panel">
        <p className="muted">
          Use Gemini defaults, or edit them for any OpenAI-compatible endpoint.
        </p>
        <p className="muted">
          The app runs locally, but AI features send CV text, rendered pages,
          job text, and optional achievements to your provider. Free tiers may
          use that data to improve their services.
        </p>
        <SettingsFields settings={llmSettings} onChange={setLlmSettings} />
      </div>
    </section>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ATS Glyph home">
          <span>AG</span>
          <strong>ATS Glyph</strong>
        </a>
        <div className="topbar-tags">
          <span>PDF parse</span>
          <span>Quick score</span>
          <span>CV insights</span>
          <span>Cover letter</span>
        </div>
      </header>

      <section className="hero-band">
        <div className="hero-copy">
          <p className="eyebrow">LOCAL APP / YOUR AI KEY / OPEN SOURCE</p>
          <h1>ATS Glyph</h1>
          <p>{heroLine}</p>
        </div>
        <ModuleCards />
      </section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="side-card app-menu-card">
            <div className="card-heading">
              <WandSparkles aria-hidden="true" />
              <div>
                <p className="eyebrow">MENU</p>
                <h2>Workspace</h2>
              </div>
            </div>

            <nav className="app-menu" aria-label="ATS Glyph menu">
              {MENU_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={[
                      activePanel === item.id ? "active" : "",
                      item.id === "keys" && needsInitialKey ? "needs-attention" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={item.id}
                    onClick={() => setActivePanel(item.id)}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.eyebrow}</small>
                      {item.id === "keys" && needsInitialKey && (
                        <em className="menu-alert">Add key</em>
                      )}
                    </span>
                  </button>
                );
              })}
            </nav>
          </section>

          <section className="side-card score-history-card">
            <div className="card-heading">
              <FileText aria-hidden="true" />
              <div>
                <p className="eyebrow">RECENT SCORES</p>
                <h2>Vacancies</h2>
              </div>
            </div>
            {scoreHistory.length ? (
              <div className="score-history-list">
                {scoreHistory.map((item) => (
                  <button
                    className={item.jobDescription === jobDescription ? "active" : ""}
                    key={item.id}
                    onClick={() => restoreScoreHistory(item)}
                    type="button"
                  >
                    <span className={verdictTone(item.result.verdict)}>
                      {Math.round(item.result.score)}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>
                        {verdictLabel(item.result.verdict)} /{" "}
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">
                Score several vacancies against this CV and compare them here.
              </p>
            )}
          </section>
        </aside>

        <section className="workbench">
          <div className="workbench-header">
            <div>
              <p className="eyebrow">{activeMenuItem.eyebrow}</p>
              <h2>{activeMenuItem.label}</h2>
            </div>
            <div className="workbench-sockets" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>

          {activePanel === "magic" && magicPanel}
          {activePanel === "calls" && callsPanel}
          {activePanel === "achievements" && achievementsPanel}
          {activePanel === "keys" && keysPanel}

          {error && (
            <div className="error-line big debug-error-card">
              <AlertTriangle aria-hidden="true" />
              <div className="error-debug-content">
                <strong>{error}</strong>

                {(errorHelp?.status || errorHelp?.providerStatus || errorHelp?.traceId) && (
                  <div className="error-debug-meta">
                    {errorHelp.status && <span>App status {errorHelp.status}</span>}
                    {errorHelp.providerStatus && (
                      <span>Provider status {errorHelp.providerStatus}</span>
                    )}
                    {errorHelp.traceId && <span>Trace {errorHelp.traceId}</span>}
                  </div>
                )}

                {errorHelp?.fixHints?.length ? (
                  <ul className="error-hints">
                    {errorHelp.fixHints.map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                ) : null}

                {(errorHelp?.details ||
                  errorHelp?.debug?.endpoint ||
                  errorHelp?.debug?.model ||
                  errorHelp?.debug?.retryNote) && (
                  <details>
                    <summary>Debug details</summary>
                    {errorHelp.debug?.endpoint && (
                      <p>
                        <strong>Endpoint:</strong> {errorHelp.debug.endpoint}
                      </p>
                    )}
                    {errorHelp.debug?.model && (
                      <p>
                        <strong>Model:</strong> {errorHelp.debug.model}
                      </p>
                    )}
                    {errorHelp.debug?.retryNote && (
                      <p>
                        <strong>Retry:</strong> {errorHelp.debug.retryNote}
                      </p>
                    )}
                    {errorHelp.details && <pre>{errorHelp.details}</pre>}
                  </details>
                )}
              </div>
            </div>
          )}

          {activePanel === "magic" && hasResult && (
            <section className="results">
              {cvResult && (
                <section className="result-card cv-card">
                  <div className="result-top">
                    <ScoreRing score={cvResult.totalScore} />
                    <div>
                      <p className="eyebrow">CV INSIGHTS / MOST IMPACT FIRST</p>
                      <h2>{cvResult.headline}</h2>
                      <p>{cvResult.summary}</p>
                    </div>
                  </div>

                  <div className="actions-list insight-list">
                    {cvResult.topActions.map((action, index) => (
                      <article className={`rune-card ${action.priority}`} key={action.id}>
                        <div className="rune-mark">
                          <Sparkles aria-hidden="true" />
                        </div>
                        <div className="action-meta">
                          <span>#{index + 1}</span>
                          <span>
                            +{action.estimatedDelta.min}-{action.estimatedDelta.max} pts
                          </span>
                        </div>
                        <h3>{action.metricLabel}</h3>
                        <div className="insight-section diagnosis">
                          <div className="insight-section-head">
                            <span>Problem</span>
                            <span>Evidence</span>
                          </div>
                          <div className="insight-pair">
                            <p>{action.issue}</p>
                            <p>{action.evidence}</p>
                          </div>
                        </div>
                        <div className="insight-section recommendation">
                          <div className="insight-section-head">
                            <span>Suggestion</span>
                            <strong className={`source-badge ${sourceTone(action)}`}>
                              {sourceLabel(action)}
                            </strong>
                          </div>
                          <p>{action.improvementPath}</p>
                          <div className="example-box">
                            <div className="example-box-head">
                              <span>Example bullet</span>
                            </div>
                            <p>{action.example}</p>
                            <button
                              className="ghost-button"
                              onClick={() => void copyAction(action)}
                              type="button"
                            >
                              <Clipboard aria-hidden="true" />
                              {copiedActionId === action.id ? "Copied" : "Copy bullet"}
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  <MetricGrid metrics={cvResult.metricChecks} />
                </section>
              )}

              {clResult && <CoverLetterEditor result={clResult} />}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
