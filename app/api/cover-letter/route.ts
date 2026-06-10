import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requestOpenAiCompatibleJson,
  resolveRuntimeLlmSettings,
} from "@/lib/llm/openai-compatible";
import {
  buildCoverLetterImagePrompt,
  COVER_LETTER_PROMPT_VERSION,
  SYSTEM_PROMPT_COVER_LETTER,
} from "@/lib/prompts/cover-letter";
import { safeParseJson } from "@/lib/json";
import { cleanText, getErrorDebug, getErrorMessage, getLlmFixHints } from "@/lib/sanitize";
import type { CoverLetterTone } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const CoverLetterSchema = z.object({
  images: z.array(z.string().min(100)).min(1).max(5),
  jobDescription: z.string().min(200).max(10_000),
  achievements: z.string().max(6_000).optional(),
  tone: z.enum(["informal", "formal"]).default("informal"),
  companyComment: z.string().max(700).optional(),
  settings: z
    .object({
      apiKey: z.string().max(4_000).optional(),
      baseUrl: z.string().max(300).optional(),
      model: z.string().max(120).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const parsed = CoverLetterSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid cover-letter payload.",
        details: parsed.error.flatten(),
        fixHints: [
          "Upload a PDF CV that can be rendered into page images.",
          "Paste a job description with at least 200 characters.",
          "Use one of the supported cover-letter tones: informal or formal.",
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
  const companyComment = body.companyComment
    ? cleanText(body.companyComment, 700)
    : undefined;

  try {
    const settings = resolveRuntimeLlmSettings({
      provided: body.settings,
      settingsLabel: "AI endpoint",
      providerName: "AI endpoint",
    });
    const { content, usage, durationMs } = await requestOpenAiCompatibleJson({
      settings,
      callKind: "cover-letter",
      systemPrompt: SYSTEM_PROMPT_COVER_LETTER,
      userPrompt: buildCoverLetterImagePrompt({
        jobDescription,
        achievements,
        tone: body.tone as CoverLetterTone,
        companyComment,
      }),
      images: body.images,
      maxCompletionTokens: 5000,
      promptVersion: COVER_LETTER_PROMPT_VERSION,
    });

    const result = safeParseJson(content);

    return NextResponse.json({
      traceId,
      result,
      usage,
      durationMs,
      promptVersion: COVER_LETTER_PROMPT_VERSION,
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
          route: "cover-letter",
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
