import type { Metadata, Viewport } from "next";
import "./globals.css";

const APP_URL = "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  applicationName: "ATS Glyph",
  title: {
    default: "ATS Glyph - Local ATS Resume Checker",
    template: "%s | ATS Glyph",
  },
  description:
    "Check a PDF CV against one job, get ranked fixes, and draft a cover letter with your own AI key.",
  keywords: [
    "ATS Glyph",
    "ATS resume checker",
    "ATS CV checker",
    "resume score",
    "CV score",
    "free AI CV review",
    "AI resume feedback",
    "cover letter generator",
    "CV insights",
    "job application tools",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ATS Glyph - Local ATS Resume Checker",
    description:
      "Local-first ATS scoring, ranked CV fixes, and cover-letter drafting with your own AI key.",
    url: APP_URL,
    siteName: "ATS Glyph",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATS Glyph - Local ATS Resume Checker",
    description:
      "Score a CV against one role, fix the biggest gaps, and draft a cover letter locally.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f3f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
