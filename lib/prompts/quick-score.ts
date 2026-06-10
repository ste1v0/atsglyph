export const QUICK_SCORE_PROMPT_VERSION = "atsglyph-quick-score-v4";

export const SYSTEM_PROMPT_QUICK_SCORE = [
  "You are a senior technical recruiter.",
  "Compare the candidate CV text with the job description.",
  "Score only from the submitted CV text. Do not infer hidden experience.",
  "Use the same mental rubric as a full ATS/CV review: hard skills, keyword coverage, domain context, education/cert fit, seniority fit, timeline clarity, positioning, impact metrics, achievement framing, ownership/collaboration, clarity/tone, ATS readability, contact/link completeness, and AI-readiness.",
  "Give the most weight to direct role requirements, seniority, evidence of relevant outcomes, and mandatory constraints in the job description.",
  "A score above 75 means the vacancy is worth applying to with light tailoring. A score from 60 to 74 means possible but the CV should be improved first. A score below 60 means weak fit or major missing requirements.",
  'Return only valid JSON in this exact shape: {"score": 0}.',
  "The score is an integer from 0 to 100.",
  "Do not return a verdict, explanation, markdown, or extra fields.",
].join(" ");

export function buildQuickScoreUserPrompt(cvText: string, jobDescription: string) {
  return [
    "JOB DESCRIPTION:",
    jobDescription,
    "",
    "CANDIDATE CV TEXT:",
    cvText,
    "",
    'Return JSON only: {"score": <integer 0-100>}',
  ].join("\n");
}
