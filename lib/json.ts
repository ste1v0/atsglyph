export function safeParseJson(input: string): unknown {
  if (!input) return null;

  let sanitized = input.trim();

  if (sanitized.includes("```")) {
    const match = sanitized.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match?.[1]) {
      sanitized = match[1].trim();
    }
  }

  try {
    return JSON.parse(sanitized);
  } catch {
    const start = sanitized.indexOf("{");
    const end = sanitized.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Invalid JSON structure. Input length: ${input.length}`);
    }

    const isolated = sanitized.substring(start, end + 1);

    try {
      return JSON.parse(isolated);
    } catch (error) {
      let currentEnd = end;
      while (currentEnd > start) {
        const candidate = sanitized.substring(start, currentEnd + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          currentEnd = sanitized.lastIndexOf("}", currentEnd - 1);
          if (currentEnd === -1 || currentEnd <= start) break;
        }
      }

      throw error;
    }
  }
}
