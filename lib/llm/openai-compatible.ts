import "server-only";
import { appendLlmCallLog } from "@/lib/llm/call-log";
import type { LlmCallKind, LlmSettings } from "@/lib/types";

interface OpenAiCompatibleUsage {
  prompt_tokens?: number | string;
  completion_tokens?: number | string;
  total_tokens?: number | string;
}

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: OpenAiCompatibleUsage;
}

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface OpenAiCompatibleMessage {
  role: "system" | "user";
  content: MessageContent;
}

type TokenLimitMode = "max_tokens" | "max_completion_tokens" | "none";

interface RequestBodyOptions {
  includeResponseFormat: boolean;
  includeTemperature: boolean;
  tokenLimitMode: TokenLimitMode;
}

export interface RuntimeLlmSettings extends Required<LlmSettings> {
  providerName: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = trimTrailingSlash(baseUrl.trim());

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

function shouldRetryWithoutResponseFormat(status: number, body: string) {
  if (/response_format|json_object|json mode/i.test(body)) return true;
  return status >= 500 && status <= 504;
}

function shouldRetryWithDifferentTokenLimit(body: string) {
  return /max_tokens|max_completion_tokens|max output tokens|token limit/i.test(body);
}

function shouldRetryWithoutTemperature(status: number, body: string) {
  if (status !== 400 && status !== 422) return false;
  return /temperature/i.test(body);
}

function coerceFiniteNumber(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildRequestBody(args: {
  model: string;
  messages: OpenAiCompatibleMessage[];
  temperature: number;
  maxCompletionTokens: number;
  options: RequestBodyOptions;
}) {
  return {
    model: args.model,
    messages: args.messages,
    stream: false,
    ...(args.options.includeTemperature
      ? {
          temperature: args.temperature,
        }
      : {}),
    ...(args.options.tokenLimitMode === "max_tokens"
      ? {
          max_tokens: args.maxCompletionTokens,
        }
      : {}),
    ...(args.options.tokenLimitMode === "max_completion_tokens"
      ? {
          max_completion_tokens: args.maxCompletionTokens,
        }
      : {}),
    ...(args.options.includeResponseFormat
      ? {
          response_format: {
            type: "json_object",
          },
        }
      : {}),
  };
}

function chooseFallback(
  options: RequestBodyOptions,
  status: number,
  body: string,
): { options: RequestBodyOptions; note: string } | null {
  if (options.includeResponseFormat && shouldRetryWithoutResponseFormat(status, body)) {
    return {
      options: {
        ...options,
        includeResponseFormat: false,
      },
      note: "Retried without response_format after provider rejected or failed JSON mode.",
    };
  }

  if (
    options.tokenLimitMode === "max_tokens" &&
    shouldRetryWithDifferentTokenLimit(body)
  ) {
    return {
      options: {
        ...options,
        tokenLimitMode: "max_completion_tokens",
      },
      note: "Retried with max_completion_tokens after provider rejected max_tokens.",
    };
  }

  if (
    options.tokenLimitMode === "max_completion_tokens" &&
    shouldRetryWithDifferentTokenLimit(body)
  ) {
    return {
      options: {
        ...options,
        tokenLimitMode: "none",
      },
      note: "Retried without a token-limit field after provider rejected token controls.",
    };
  }

  if (options.includeTemperature && shouldRetryWithoutTemperature(status, body)) {
    return {
      options: {
        ...options,
        includeTemperature: false,
      },
      note: "Retried without temperature after provider rejected temperature controls.",
    };
  }

  return null;
}

function createProviderError(args: {
  providerName: string;
  status: number;
  statusText: string;
  body: string;
  endpoint: string;
  model: string;
  retryNotes: string[];
}) {
  const error = new Error(
    `${args.providerName} API error: ${args.status} ${args.statusText}`,
  );
  (error as Error & {
    status?: number;
    body?: string;
    endpoint?: string;
    model?: string;
    retryNote?: string;
  }).status = args.status;
  (error as Error & { body?: string }).body = args.body.slice(0, 1_500);
  (error as Error & { endpoint?: string }).endpoint = args.endpoint;
  (error as Error & { model?: string }).model = args.model;

  if (args.retryNotes.length) {
    (error as Error & { retryNote?: string }).retryNote = args.retryNotes.join(" ");
  }

  return error;
}

export function resolveRuntimeLlmSettings(args: {
  provided?: LlmSettings;
  settingsLabel: string;
  providerName: string;
}) {
  const apiKey = args.provided?.apiKey?.trim() || "";
  const baseUrl = args.provided?.baseUrl?.trim() || "";
  const model = args.provided?.model?.trim() || "";

  if (!apiKey || !baseUrl || !model) {
    throw new Error(
      `${args.settingsLabel} is not ready. Open Keys and fill Base URL, Model, and API key.`,
    );
  }

  return {
    apiKey,
    baseUrl,
    model,
    providerName: args.providerName,
  };
}

export async function requestOpenAiCompatibleJson(args: {
  settings: RuntimeLlmSettings;
  callKind: LlmCallKind;
  systemPrompt: string;
  userPrompt: string;
  images?: string[];
  maxCompletionTokens?: number;
  promptVersion?: string;
  temperature?: number;
}) {
  const startedAt = Date.now();
  const userContent: MessageContent = args.images?.length
    ? [
        { type: "text", text: args.userPrompt },
        ...args.images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:image/jpeg;base64,${image}` },
        })),
      ]
    : args.userPrompt;

  const messages: OpenAiCompatibleMessage[] = [
    { role: "system", content: args.systemPrompt },
    { role: "user", content: userContent },
  ];

  const endpoint = chatCompletionsUrl(args.settings.baseUrl);
  const headers = {
    Authorization: `Bearer ${args.settings.apiKey}`,
    "Content-Type": "application/json",
  };
  const requestBody = {
    model: args.settings.model,
    messages,
    temperature: args.temperature ?? 0.2,
    maxCompletionTokens: args.maxCompletionTokens ?? 5000,
  };
  let options: RequestBodyOptions = {
    includeResponseFormat: true,
    includeTemperature: true,
    tokenLimitMode: "max_tokens",
  };
  const retryNotes: string[] = [];

  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildRequestBody({ ...requestBody, options })),
  });

  while (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const fallback = chooseFallback(options, response.status, errorText);

    if (!fallback) {
      throw createProviderError({
        providerName: args.settings.providerName,
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        endpoint,
        model: args.settings.model,
        retryNotes,
      });
    }

    options = fallback.options;
    retryNotes.push(fallback.note);
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildRequestBody({ ...requestBody, options })),
    });
  }

  const durationMs = Date.now() - startedAt;

  const data = (await response.json()) as OpenAiCompatibleResponse;
  const content = data.choices?.[0]?.message?.content || "";
  const usage = {
    promptTokens: coerceFiniteNumber(data.usage?.prompt_tokens) ?? 0,
    completionTokens: coerceFiniteNumber(data.usage?.completion_tokens) ?? 0,
    totalTokens: coerceFiniteNumber(data.usage?.total_tokens) ?? 0,
  };

  await appendLlmCallLog({
    id: crypto.randomUUID(),
    kind: args.callKind,
    createdAt: new Date(startedAt).toISOString(),
    provider: args.settings.providerName,
    model: args.settings.model,
    durationMs,
    promptVersion: args.promptVersion,
    usage,
  }).catch((error) => {
    console.warn("Could not write LLM call log.", error);
  });

  if (!content) {
    throw new Error(`${args.settings.providerName} returned an empty response.`);
  }

  return {
    content,
    usage,
    durationMs,
    model: args.settings.model,
    provider: args.settings.providerName,
  };
}
