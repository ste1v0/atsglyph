import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanText, getErrorMessage } from "@/lib/sanitize";

export const runtime = "nodejs";

const ACHIEVEMENTS_FILE = path.join(process.cwd(), "ACHIEVEMENTS.md");

const AchievementsSchema = z.object({
  achievements: z.string().max(6_000),
});

export async function GET() {
  try {
    const achievements = await readFile(ACHIEVEMENTS_FILE, "utf8");
    return NextResponse.json({ achievements });
  } catch {
    return NextResponse.json({ achievements: "" });
  }
}

export async function POST(request: Request) {
  const parsed = AchievementsSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid achievements payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const achievements = cleanText(parsed.data.achievements, 6_000);
    await writeFile(ACHIEVEMENTS_FILE, achievements, "utf8");
    return NextResponse.json({ ok: true, achievements });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
