"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-shell">
      <section className="error-card">
        <p className="eyebrow">ERROR</p>
        <h1>Something broke.</h1>
        <p>{error.message}</p>
        <button className="brutal-button" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Retry
        </button>
      </section>
    </main>
  );
}
