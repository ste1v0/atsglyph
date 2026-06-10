const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value: string, maxLength: number) {
  return value.replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

export function getErrorDebug(error: unknown) {
  if (!error || typeof error !== "object") return {};

  const candidate = error as {
    status?: unknown;
    body?: unknown;
    endpoint?: unknown;
    model?: unknown;
    retryNote?: unknown;
  };

  return {
    providerStatus: typeof candidate.status === "number" ? candidate.status : undefined,
    providerBody: typeof candidate.body === "string" ? candidate.body : undefined,
    endpoint: typeof candidate.endpoint === "string" ? candidate.endpoint : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    retryNote: typeof candidate.retryNote === "string" ? candidate.retryNote : undefined,
  };
}

export function getLlmFixHints(args: {
  message: string;
  providerStatus?: number;
  providerBody?: string;
  route: "quick-score" | "full-analysis" | "cover-letter";
}) {
  const combined = `${args.message}\n${args.providerBody || ""}`.toLowerCase();
  const hints: string[] = [];

  if (combined.includes("api key") || combined.includes("unauthorized")) {
    hints.push("Open Keys and check that the API key belongs to the endpoint you entered.");
  }

  if (combined.includes("settings are incomplete") || combined.includes("key is not ready")) {
    hints.push("Open Keys and fill Base URL, Model, and API key.");
  }

  if (combined.includes("model") || combined.includes("not found")) {
    hints.push("Open Keys and verify the model name exactly matches your endpoint account.");
  }

  if (
    combined.includes("image") ||
    combined.includes("vision") ||
    combined.includes("multimodal") ||
    combined.includes("unsupported content")
  ) {
    hints.push("Use a vision-capable model for Full Analysis. Text-only models can run Quick Score but cannot inspect CV page images.");
  }

  if (combined.includes("response_format") || combined.includes("json_object")) {
    hints.push("The provider rejected JSON mode. ATS Glyph retries without response_format, but a provider that cannot follow JSON reliably may still fail.");
  }

  if (combined.includes("max_tokens") || combined.includes("max_completion_tokens")) {
    hints.push("The provider rejected a token-limit field. Try another OpenAI-compatible base URL or provider model.");
  }

  if (combined.includes("invalid score format") || combined.includes("expected json")) {
    hints.push("The provider answered, but not with a clean score. Try a simpler fast model, a different OpenAI-compatible endpoint, or keep temperature at 0.");
  }

  if (
    combined.includes("could not parse") ||
    combined.includes("malformed") ||
    combined.includes("json at position")
  ) {
    hints.push("The provider returned malformed JSON. ATS Glyph now retries once with a JSON repair pass; if it still fails, use Debug details to inspect the raw response.");
  }

  if (combined.includes("base url") || combined.includes("404") || combined.includes("not found")) {
    hints.push("Check the base URL. ATS Glyph appends /chat/completions unless the URL already ends with it.");
  }

  if (args.providerStatus === 400) {
    hints.push("A 400 from the model provider usually means the base URL, model name, vision support, or request format is incompatible.");
  }

  if (args.route === "full-analysis" || args.route === "cover-letter") {
    hints.push("For Gemini OpenAI compatibility, use https://generativelanguage.googleapis.com/v1beta/openai with a vision-capable Gemini model.");
  }

  return Array.from(new Set(hints)).slice(0, 5);
}
