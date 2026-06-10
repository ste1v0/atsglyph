"use client";

import { RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="error-shell">
          <section className="error-card">
            <p className="eyebrow">ERROR</p>
            <h1>ATS Glyph hit a problem.</h1>
            <p>{error.message}</p>
            <button className="brutal-button" onClick={reset}>
              <RotateCcw aria-hidden="true" />
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
