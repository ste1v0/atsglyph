import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmCallLogEntry } from "@/lib/types";

const CALL_LOG_FILE = path.join(process.cwd(), "LLM_CALLS.json");
const MAX_CALLS = 200;

let writeQueue = Promise.resolve();

function isCallLogEntry(value: unknown): value is LlmCallLogEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as LlmCallLogEntry;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.durationMs === "number" &&
    Boolean(candidate.usage) &&
    typeof candidate.usage.promptTokens === "number" &&
    typeof candidate.usage.completionTokens === "number" &&
    typeof candidate.usage.totalTokens === "number"
  );
}

export async function readLlmCallLog() {
  try {
    const raw = await readFile(CALL_LOG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCallLogEntry).slice(0, MAX_CALLS);
  } catch {
    return [];
  }
}

export async function appendLlmCallLog(entry: LlmCallLogEntry) {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const existing = await readLlmCallLog();
    const next = [entry, ...existing].slice(0, MAX_CALLS);
    await writeFile(CALL_LOG_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  });

  return writeQueue;
}

export async function clearLlmCallLog() {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => writeFile(CALL_LOG_FILE, "[]\n", "utf8"));
  return writeQueue;
}
