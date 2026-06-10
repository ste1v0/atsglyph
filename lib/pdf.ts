"use client";

import type {
  TextItem as PdfTextItem,
  TextStyle as PdfTextStyle,
} from "pdfjs-dist/types/src/display/api";

const OPTIMAL_SCALE = 1.75;
const JPEG_QUALITY = 0.95;
const MAX_WIDTH = 2200;
const MAX_PAGES = 5;
const PDF_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const DECORATIVE_FONT_PATTERN =
  /fontawesome|material|icon|symbol|dingbat|glyph|icomoon|entypo|octicons|simple[-\s]?line/i;
const GARBLE_WORDS = new Set(["cece", "ceceeee", "eeeeee", "eee", "eens", "teen", "ees"]);
const LINE_Y_TOLERANCE = 3;

type PositionedTextItem = PdfTextItem & {
  x: number;
  y: number;
};

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    return pdfjsLib;
  });

  return pdfjsPromise;
}

async function loadPdf(file: File) {
  const pdfjsLib = await loadPdfJs();

  if (file.type !== "application/pdf") {
    throw new Error("Please upload a PDF CV.");
  }

  if (file.size > 9 * 1024 * 1024) {
    throw new Error("Keep the PDF under 9 MB.");
  }

  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
}

function normalizePdfText(value: string) {
  return value
    .replace(/-\u00ad[\u2010-]/g, "-")
    .replace(/\u00ad/g, "")
    .normalize("NFKC");
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return item !== null && typeof item === "object" && "str" in item;
}

function tokenCore(token: string) {
  return token.replace(/[^A-Za-z]/g, "").toLowerCase();
}

function isStrongGarbledToken(token: string) {
  const core = tokenCore(token);
  if (core.length < 3) return false;

  return (
    GARBLE_WORDS.has(core) ||
    /([a-z])\1{2,}/.test(core) ||
    /^(?:ce){2,}e*$/.test(core) ||
    (core.length >= 4 && new Set(core).size <= 2 && /[ce]/.test(core))
  );
}

function isWeakGarbledToken(token: string) {
  const core = tokenCore(token);
  return core === "e" || core === "t" || GARBLE_WORDS.has(core);
}

function cleanGarbledLine(line: string) {
  const normalizedLine = line
    .replace(/^(?:[a-z]{1,3}[%);:]*|0\))\s+(?=[A-ZА-ЯЁ])/u, "")
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .trim();
  const tokens = normalizedLine.split(/\s+/).filter(Boolean);
  const strongCount = tokens.filter(isStrongGarbledToken).length;
  const weakCount = tokens.filter(
    (token) => isStrongGarbledToken(token) || isWeakGarbledToken(token),
  ).length;

  if (strongCount === 0 && weakCount < 3) return normalizedLine;

  const cleanedTokens = tokens.filter(
    (token) =>
      !isStrongGarbledToken(token) && !(strongCount > 0 && isWeakGarbledToken(token)),
  );

  return cleanedTokens.join(" ").trim() || normalizedLine;
}

function isDecorativeTextItem(
  item: PdfTextItem,
  styles: Record<string, PdfTextStyle | undefined>,
) {
  const text = item.str.trim();
  const style = styles[item.fontName];
  const fontDetails = `${item.fontName} ${style?.fontFamily ?? ""}`;

  if (!DECORATIVE_FONT_PATTERN.test(fontDetails)) return false;
  return text.length <= 8 || !/[A-Za-zА-Яа-я0-9]{2,}/.test(text);
}

function getPositionedTextItem(item: PdfTextItem): PositionedTextItem | null {
  const x = item.transform[4];
  const y = item.transform[5];

  if (typeof x !== "number" || typeof y !== "number") return null;

  return {
    ...item,
    x,
    y,
  };
}

function shouldInsertSpace(
  previousItem: PositionedTextItem | null,
  nextItem: PositionedTextItem,
  currentLine: string,
  nextText: string,
) {
  if (!currentLine || /\s$/.test(currentLine) || /^\s/.test(nextText)) return false;
  if (/^[,.;:!?%)\]}]/.test(nextText)) return false;
  if (/[(\[{]$/.test(currentLine)) return false;
  if (!previousItem) return true;

  const gap = nextItem.x - (previousItem.x + previousItem.width);
  const averageCharacterWidth =
    previousItem.str.length > 0 ? previousItem.width / previousItem.str.length : 4;

  return gap > Math.max(1.5, averageCharacterWidth * 0.45);
}

function getSortedTextLines(
  items: unknown[],
  styles: Record<string, PdfTextStyle | undefined>,
) {
  const positionedItems = items
    .filter(isPdfTextItem)
    .filter((item) => !isDecorativeTextItem(item, styles))
    .map((item) => ({
      ...item,
      str: normalizePdfText(item.str),
    }))
    .filter((item) => item.str.trim())
    .map(getPositionedTextItem)
    .filter((item): item is PositionedTextItem => Boolean(item))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Array<{ y: number; items: PositionedTextItem[] }> = [];

  for (const item of positionedItems) {
    const currentLine = lines[lines.length - 1];
    const tolerance = Math.max(LINE_Y_TOLERANCE, item.height * 0.35);

    if (currentLine && Math.abs(currentLine.y - item.y) <= tolerance) {
      currentLine.items.push(item);
      currentLine.y = (currentLine.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines.map((line) => line.items.sort((a, b) => a.x - b.x));
}

function textItemsToPageText(
  items: unknown[],
  styles: Record<string, PdfTextStyle | undefined>,
) {
  const lines: string[] = [];

  function buildLine(lineItems: PositionedTextItem[]) {
    let currentLine = "";
    let previousItem: PositionedTextItem | null = null;

    for (const item of lineItems) {
      if (shouldInsertSpace(previousItem, item, currentLine, item.str)) {
        currentLine += " ";
      }
      currentLine += item.str;
      previousItem = item;
    }

    const line = cleanGarbledLine(currentLine.replace(/[^\S\r\n]+/g, " "));
    return line;
  }

  for (const lineItems of getSortedTextLines(items, styles)) {
    const line = buildLine(lineItems);
    if (line) lines.push(line);
  }

  return lines.join("\n");
}

export async function convertPdfToImages(file: File): Promise<string[]> {
  const pdf = await loadPdf(file);

  try {
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);

    const pages = await Promise.all(
      Array.from({ length: pageCount }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(OPTIMAL_SCALE, MAX_WIDTH / viewport.width);
        const scaledViewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas rendering is unavailable in this browser.");
        }

        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        try {
          await page.render({
            canvas,
            canvasContext: context,
            viewport: scaledViewport,
          }).promise;

          return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
        } finally {
          page.cleanup();
        }
      }),
    );

    return pages;
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfText(file: File): Promise<string> {
  const pdf = await loadPdf(file);

  try {
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, async (_, index) => {
        const page = await pdf.getPage(index + 1);

        try {
          const content = await page.getTextContent();
          return textItemsToPageText(content.items, content.styles);
        } finally {
          page.cleanup();
        }
      }),
    );

    return pages.filter(Boolean).join("\n\n").trim();
  } finally {
    await pdf.destroy();
  }
}
