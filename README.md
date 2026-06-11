# ATS Glyph

**Local-first ATS resume checker for job seekers.**

![License](https://img.shields.io/github/license/ste1v0/atsglyph)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen)

ATS Glyph helps you check a PDF CV against a job description, see what an ATS-style parser can read, get a practical fit score, and generate focused improvement suggestions using your own AI key.

No account. No database. No subscription. Local-first with BYOK.

<img width="2946" height="1708" alt="app-preview-2" src="https://github.com/user-attachments/assets/0edbce10-f972-4322-87e5-9e67ab1fe9d4" />

## What it does

### You bring:

* a PDF CV
* a job description
* your own AI key — a free Gemini key works too

### The app helps you to:

* a quick 0–100 fit score
* an ATS-style parser check for your PDF
* the 4 highest-impact fixes, not a 40-page audit
* a full CV review across 14 areas
* a cover letter draft based on the role, company context, and your achievements
* cleaner writing suggestions without the usual AI-sounding patterns

## Why

Applying for jobs is tedious and hard.

Things that can go wrong:

* your two, three, or four-column resume turns into soup, gradient skill bars included
* the fit score lands your application in the red zone before a human even sees it
* your CV is almost there, but misses one thing other candidates added
* the role expects a cover letter, and yours says “I generated this in 12 seconds” a bit too loudly

ATS Glyph does not pretend to know every company’s hiring system. It helps you catch practical problems that often hurt applications: unreadable PDFs, missing role keywords, weak evidence, unclear positioning, and generic cover letters.

Useful background:

* Reddit: [How 7 major ATS platforms use AI to screen your resume](https://www.reddit.com/r/jobhunting/comments/1ss6ym9/how_7_major_ats_platforms_use_ai_to_screen_your/)
* Stanford HAI: [AI Hiring Tools Can Yield Racial Bias and Systemic Rejection](https://hai.stanford.edu/news/ai-hiring-tools-can-yield-racial-bias-and-systemic-rejection)

## Privacy model

ATS Glyph is local-first:

* no account
* no hosted database
* no subscription
* your AI key is stored locally in your browser
* optional achievement notes and usage logs stay in local files

Your CV, job description, rendered PDF pages, and optional achievement/company notes are sent to the AI provider you configure, so please check provider's data policy.

## Parser check

The app renders the uploaded PDF and checks what can actually be read.

Useful for catching broken columns, icons, skill bars and other graphics read as nonsense.

If your CV looks broken here, maybe do not feed the same version to Ashby and hope for the best.

## Quick Score

Quick Score returns one number from 0 to 100:

* **75+** means probably worth applying with light tailoring
* **60–74** means possible, but fix the gaps in your CV first
* **below 60** means weak fit or a missing requirement, possibly not worth the time

It scores only what is in the CV. Achievements, if specified, are only used for suggestions.

## CV Analysis

The app checks your CV against the JD across 14 areas.

**Match**

* hard skills
* keyword coverage
* domain context
* education and certificates
* seniority and career fit

**Content**

* profile positioning
* impact metrics
* achievement framing
* ownership and collaboration
* clarity and tone

**Structure**

* timeline clarity
* ATS readability
* contact and links
* AI readiness

You get the 4 highest-impact actions, sorted by estimated score impact.

Each action includes:

* what is weak
* evidence from the CV
* what to improve
* estimated score impact range
* one paste-ready example to adapt

The app can use your achievement notes for better examples, but not for scoring.

## Cover letter draft

The app drafts a cover letter from:

* your CV
* the job description
* company context, if you add it
* private achievements, if you add them
* your preferred tone: informal or formal

Formal keeps the classic cover letter structure.

Informal keeps it shorter, with a quick intro, precise bullets, and a simple close.

It avoids the usual AI soup, yes, but please never send it blindly and treat it as a plan.

## Achievements

You can add notes under the Achievements tab or to `ACHIEVEMENTS.md`.

Example:

```md
- Reduced support queue by 30%
- Built a Telegram bot used by 50 employees
- Migrated internal scripts from X to Y
```

These notes help the app suggest better CV bullets and cover letter examples.

They do not affect scoring unless you actually add them to your CV.

## You’ll hate this if

You want a tool that:

* auto-applies to 500 jobs
* rewrites your whole CV while you look away
* promises interviews
* tells you to keyword-stuff everything

Depending on your taste, sadly or thankfully, the app does none of that.

## Tech stack

* Next.js
* React
* TypeScript
* PDF.js
* Zod
* OpenAI-compatible chat completions endpoint

## Run locally

Install:

* [Node.js 22+](https://nodejs.org)
* [Git](https://git-scm.com/downloads)

Then run:

```bash
git clone https://github.com/ste1v0/atsglyph.git
cd atsglyph
corepack enable pnpm
pnpm install
pnpm run dev
```

Open:

```text
http://localhost:3000
```

Downloaded a ZIP?

Unzip it, open Terminal or PowerShell inside the folder, then run:

```bash
corepack enable pnpm
pnpm install
pnpm run dev
```

## Add an AI key

Open the **AI Endpoint** tab.

For a simple Gemini setup:

1. Create a key: https://aistudio.google.com/apikey
2. Keep this base URL:

```text
https://generativelanguage.googleapis.com/v1beta/openai
```

3. Keep this model:

```text
gemini-3.5-flash
```

4. Paste the key in the app.

Any OpenAI-compatible chat completions endpoint can work, but Full Analysis needs a vision-capable model since it sends rendered PDF pages.

## Local files

`ACHIEVEMENTS.md`

Optional private notes for stronger suggestions.

`LLM_CALLS.json`

Local usage history for LLM calls.

Both files are ignored by git.

## Commands

```bash
pnpm run dev
pnpm run typecheck
pnpm run build
pnpm run start
pnpm run check
```

## Contributing

Issues and PRs are welcome.

Before opening a PR:

```bash
pnpm run typecheck
pnpm run build
```

## License

MIT
