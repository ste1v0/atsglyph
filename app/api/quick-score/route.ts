import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requestOpenAiCompatibleJson,
  resolveRuntimeLlmSettings,
} from "@/lib/llm/openai-compatible";
import {
  buildQuickScoreUserPrompt,
  QUICK_SCORE_PROMPT_VERSION,
  SYSTEM_PROMPT_QUICK_SCORE,
} from "@/lib/prompts/quick-score";
import { safeParseJson } from "@/lib/json";
import { cleanText, getErrorDebug, getErrorMessage, getLlmFixHints } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 30;

const QuickScoreSchema = z.object({
  cvText: z.string().min(100).max(20_000),
  jobDescription: z.string().min(200).max(10_000),
  settings: z
    .object({
      apiKey: z.string().max(4_000).optional(),
      baseUrl: z.string().max(300).optional(),
      model: z.string().max(120).optional(),
    })
    .optional(),
});

const QuickScoreResponseSchema = z
  .object({
    score: z.coerce.number().int().min(0).max(100),
  })
  .passthrough();

function verdictFromScore(score: number) {
  if (score >= 75) return "worth_it";
  if (score >= 60) return "maybe";
  return "skip";
}

function parseQuickScore(content: string) {
  let parsed = QuickScoreResponseSchema.safeParse(null);

  try {
    parsed = QuickScoreResponseSchema.safeParse(safeParseJson(content));
  } catch {
    // Fall through to the single-number recovery below.
  }

  if (parsed.success) {
    return parsed;
  }

  const numericMatches = content.match(/\b(?:100|[1-9]?\d)\b/g) || [];
  const uniqueScores = Array.from(
    new Set(
      numericMatches
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 100),
    ),
  );

  if (uniqueScores.length === 1) {
    return QuickScoreResponseSchema.safeParse({ score: uniqueScores[0] });
  }

  return parsed;
}

function throwInvalidQuickScore(content: string, model?: string): never {
  const error = new Error("Quick score model returned an invalid score format.");
  const details = [
    "Expected JSON like {\"score\": 72}.",
    "Raw model response:",
    content.slice(0, 1_500),
  ].join("\n\n");

  (error as Error & { body?: string }).body = details;
  (error as Error & { model?: string }).model = model;

  throw error;
}

export async function POST(request: Request) {
  const parsed = QuickScoreSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid quick score payload.",
        details: parsed.error.flatten(),
        fixHints: [
          "Upload a text-selectable PDF CV so ATS Glyph can extract at least 100 characters.",
          "Paste a job description with at least 200 characters.",
          "If your CV is scanned, Full Analysis may work but Quick Score needs selectable text.",
        ],
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const traceId = crypto.randomUUID();
  const cvText = cleanText(body.cvText, 20_000);
  const jobDescription = cleanText(body.jobDescription, 10_000);

  try {
    const settings = resolveRuntimeLlmSettings({
      provided: body.settings,
      settingsLabel: "AI endpoint",
      providerName: "AI endpoint",
    });
    let llmResult = await requestOpenAiCompatibleJson({
      settings,
      callKind: "quick-score",
      systemPrompt: SYSTEM_PROMPT_QUICK_SCORE,
      userPrompt: buildQuickScoreUserPrompt(cvText, jobDescription),
      promptVersion: QUICK_SCORE_PROMPT_VERSION,
    });
    let parsedScore = parseQuickScore(llmResult.content);

    if (!parsedScore.success) {
      llmResult = await requestOpenAiCompatibleJson({
        settings,
        callKind: "quick-score",
        systemPrompt: SYSTEM_PROMPT_QUICK_SCORE,
        userPrompt: buildQuickScoreUserPrompt(cvText, jobDescription),
        promptVersion: QUICK_SCORE_PROMPT_VERSION,
      });
      parsedScore = parseQuickScore(llmResult.content);
    }

    if (!parsedScore.success) {
      throwInvalidQuickScore(llmResult.content, llmResult.model);
    }

    const result = {
      score: parsedScore.data.score,
      verdict: verdictFromScore(parsedScore.data.score),
    };

    return NextResponse.json({
      traceId,
      result,
      usage: llmResult.usage,
      durationMs: llmResult.durationMs,
      promptVersion: QUICK_SCORE_PROMPT_VERSION,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const debug = getErrorDebug(error);
    const status = message.includes("settings are incomplete") || message.includes("key is not ready")
      ? 400
      : debug.providerStatus
        ? 502
        : message.includes("invalid score format")
          ? 502
          : 500;

    return NextResponse.json(
      {
        error: message,
        traceId,
        details: debug.providerBody,
        providerStatus: debug.providerStatus,
        debug: {
          endpoint: debug.endpoint,
          model: debug.model,
          retryNote: debug.retryNote,
        },
        fixHints: getLlmFixHints({
          message,
          providerStatus: debug.providerStatus,
          providerBody: debug.providerBody,
          route: "quick-score",
        }),
      },
      { status },
    );
  }
}
