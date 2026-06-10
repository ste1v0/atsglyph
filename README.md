# ATS Glyph

Local-first ATS resume checker.

<img width="1758" height="1463" alt="app-preview" src="https://github.com/user-attachments/assets/c443044d-659d-4b77-872d-b42eca53f1b8" />

You bring:

* PDF CV
* job description
* your AI key, a free Gemini key works too

You get:

* a quick 0-100 fit score
* what an ATS-style PDF parser can read from your CV
* 4 highest-impact fixes, not a 40-page audit
* 14 CV checks across match, content, and structure
* an okay cover letter draft with company and achievement context, with AI-sounding patterns cleaned up

No account. No database. No subscription. All local and free.

## Why

Applying for jobs is tedious and hard.

Things that can go wrong:

* your two, three, four column resume turns into soup, gradient skill bars included
* the fit score lands your application in the red zone before a human even sees it
* your CV is almost there, but misses one thing other candidates added
* the role expects a cover letter, and yours says “I generated this in 12 seconds” a bit too loudly

Useful background:

* Reddit: [How 7 major ATS platforms use AI to screen your resume](https://www.reddit.com/r/jobhunting/comments/1ss6ym9/how_7_major_ats_platforms_use_ai_to_screen_your/)
* Stanford HAI: [AI Hiring Tools Can Yield Racial Bias and Systemic Rejection](https://hai.stanford.edu/news/ai-hiring-tools-can-yield-racial-bias-and-systemic-rejection)

## What it does

### Quick Score

Paste CV text and a job description.

Quick Score returns one number from 0 to 100:

* 75+ means probably worth applying with light tailoring
* 60-74 means possible, but fix the gaps in your CV first
* below 60 means weak fit or a missing requirement, possibly not worth the time

It scores only what is in the CV. Achievements, if specified, are only used for suggestions.

### Parser check

The app renders the uploaded PDF and checks what can actually be read.

Useful for catching:

* broken columns
* missing sections
* weird section order
* icons read as nonsense
* skill bars that say nothing
* text trapped inside graphics

If your CV looks broken here, maybe do not feed the same version to Ashby and hope for the best.

### Full Review

The app checks your CV against the job description across 14 areas:

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

### Cover letter draft

The app drafts a cover letter from:

* your CV
* the job description
* company context, if you add it
* private achievements, if you add them
* your preferred tone: informal or formal

Formal keeps the classic cover letter structure. Informal keeps it shorter, with a quick intro, precise bullets, and a simple close.

It avoids the usual AI soup, yes, but please never send it blindly.

## Achievements

You can add notes under the Achievements tab or to `ACHIEVEMENTS.md`.

Example:

```md
- Reduced support queue by 30%
- Built a Telegram bot used by 50 employees
- Migrated internal scripts from X to Y
```

These would help the app suggest better CV bullets and cover letter examples.

They do not affect scoring unless you actually add them to your CV.

## You’ll hate this if

You want a tool that:

* auto-applies to 500 jobs in a blink of an eye
* rewrites your whole CV while you look away
* promises interviews
* tells you to keyword-stuff everything

Depending on your taste, sadly or thankfully, the app does none of that.

## Run locally

Install:

* [Node.js 22+](https://nodejs.org)
* [Git](https://git-scm.com/downloads)

Then run:

```bash
git clone https://github.com/ste1v0/atsglyph.git
cd ats-glyph
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

Open the AI Endpoint tab.

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

Check your provider’s data policy before uploading sensitive documents. Some free API providers may use submitted data to improve their models.

Any OpenAI-compatible chat completions endpoint can work.

Full Review needs a vision-capable model because it sends rendered PDF pages.

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
