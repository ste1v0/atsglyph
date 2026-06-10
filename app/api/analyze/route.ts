import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requestOpenAiCompatibleJson,
  resolveRuntimeLlmSettings,
} from "@/lib/llm/openai-compatible";
import {
  ACTION_ANALYSIS_PROMPT_VERSION,
  buildActionAnalysisImageUserPrompt,
  buildRepairAnalysisJsonPrompt,
  SYSTEM_PROMPT_ACTION_ANALYSIS,
  SYSTEM_PROMPT_REPAIR_ANALYSIS_JSON,
} from "@/lib/prompts/analysis";
import { safeParseJson } from "@/lib/json";
import { cleanText, getErrorDebug, getErrorMessage, getLlmFixHints } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 300;

const AnalyzeSchema = z.object({
  images: z.array(z.string().min(100)).min(1).max(5),
  jobDescription: z.string().min(200).max(10_000),
  achievements: z.string().max(6_000).optional(),
  settings: z
    .object({
      apiKey: z.string().max(4_000).optional(),
      baseUrl: z.string().max(300).optional(),
      model: z.string().max(120).optional(),
    })
    .optional(),
});

async function parseAnalysisJsonWithRepair(args: {
  content: string;
  settings: ReturnType<typeof resolveRuntimeLlmSettings>;
}) {
  try {
    return {
      result: safeParseJson(args.content),
      repairAttempted: false,
    };
  } catch (parseError) {
    const repair = await requestOpenAiCompatibleJson({
      settings: args.settings,
      callKind: "json-repair",
      systemPrompt: SYSTEM_PROMPT_REPAIR_ANALYSIS_JSON,
      userPrompt: buildRepairAnalysisJsonPrompt(args.content),
      maxCompletionTokens: 5000,
      promptVersion: `${ACTION_ANALYSIS_PROMPT_VERSION}-json-repair`,
      temperature: 0,
    });

    try {
      return {
        result: safeParseJson(repair.content),
        repairAttempted: true,
      };
    } catch (repairError) {
      const error = new Error(
        `Could not parse Full Analysis JSON after repair: ${getErrorMessage(repairError)}`,
      );
      (error as Error & { body?: string }).body = [
        `Original parse error: ${getErrorMessage(parseError)}`,
        "",
        "Original model response preview:",
        args.content.slice(0, 2_500),
        "",
        `Repair parse error: ${getErrorMessage(repairError)}`,
        "",
        "Repair response preview:",
        repair.content.slice(0, 2_500),
      ].join("\n");
      (error as Error & { model?: string }).model = args.settings.model;
      (error as Error & { retryNote?: string }).retryNote =
        "Tried one JSON repair pass with the same AI endpoint after the first Full Analysis response was malformed.";
      throw error;
    }
  }
}

export async function POST(request: Request) {
  const parsed = AnalyzeSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid CV analysis payload.",
        details: parsed.error.flatten(),
        fixHints: [
          "Upload a PDF CV that can be rendered into page images.",
          "Paste a job description with at least 200 characters.",
          "Keep the PDF under 9 MB and the vacancy under 10,000 characters.",
        ],
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const traceId = crypto.randomUUID();
  const jobDescription = cleanText(body.jobDescription, 10_000);
  const achievements = body.achievements
    ? cleanText(body.achievements, 6_000)
    : undefined;

  try {
    const settings = resolveRuntimeLlmSettings({
      provided: body.settings,
      settingsLabel: "AI endpoint",
      providerName: "AI endpoint",
    });
    const { content, usage, durationMs } = await requestOpenAiCompatibleJson({
      settings,
      callKind: "cv-insights",
      systemPrompt: SYSTEM_PROMPT_ACTION_ANALYSIS,
      userPrompt: buildActionAnalysisImageUserPrompt(jobDescription, achievements),
      images: body.images,
      maxCompletionTokens: 5000,
      promptVersion: ACTION_ANALYSIS_PROMPT_VERSION,
    });

    const { result, repairAttempted } = await parseAnalysisJsonWithRepair({
      content,
      settings,
    });

    return NextResponse.json({
      traceId,
      result,
      usage,
      durationMs,
      promptVersion: ACTION_ANALYSIS_PROMPT_VERSION,
      repairAttempted,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const debug = getErrorDebug(error);

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
          route: "full-analysis",
        }),
      },
      {
        status: message.includes("settings are incomplete") || message.includes("key is not ready")
          ? 400
          : debug.providerStatus
            ? 502
            : 500,
      },
    );
  }
}
