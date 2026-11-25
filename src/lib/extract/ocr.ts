/**
 * OCR for image-only ("scanned") PDF pages (phase 7).
 *
 * Pages are rendered with pdf.js onto @napi-rs/canvas (pdf.js's own Node
 * canvas) at 2x scale and read with Tesseract (English, LSTM). Language data
 * comes from the @tesseract.js-data/eng package, so nothing is downloaded at
 * run time. OCR text is less reliable than a text layer: pages read this way
 * are labelled "(OCR)", their proposals get lower confidence, and reviewers
 * are told to check values against the page image.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";

export const MAX_OCR_PAGES = 30;
const SCALE = 2;

function langPath(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
}

/** Recognises text on the given 1-based pages; returns page -> text. Pages beyond MAX_OCR_PAGES are left out. */
export async function ocrPdfPages(filePath: string, pageNumbers: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const wanted = pageNumbers.slice(0, MAX_OCR_PAGES);
  if (!wanted.length) return out;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { createWorker } = await import("tesseract.js");
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(filePath)), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const worker = await createWorker("eng", 1, { langPath: langPath(), gzip: true, cacheMethod: "none", logger: () => {} });
  try {
    for (const n of wanted) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      const png = await canvas.encode("png");
      const { data } = await worker.recognize(png);
      out.set(n, data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await task.destroy();
  }
  return out;
}
