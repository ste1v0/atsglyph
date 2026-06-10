import { NextResponse } from "next/server";
import { clearLlmCallLog, readLlmCallLog } from "@/lib/llm/call-log";
import { getErrorMessage } from "@/lib/sanitize";

export const runtime = "nodejs";

export async function GET() {
  const calls = await readLlmCallLog();
  return NextResponse.json({ calls });
}

export async function DELETE() {
  try {
    await clearLlmCallLog();
    return NextResponse.json({ ok: true, calls: [] });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
