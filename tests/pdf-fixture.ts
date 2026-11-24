import PDFDocument from "pdfkit";

/**
 * Builds a small synthetic PDF with a GHG table laid out in columns, like a
 * real sustainability data table (test fixture only; values are invented).
 * Optionally adds an image-only page to exercise scanned-page detection.
 */
export function makeGhgPdf(opts: { scope1?: string[]; scope2m?: string[]; footer?: string; scannedPage?: boolean } = {}): Promise<Buffer> {
  const scope1 = opts.scope1 ?? ["51,000", "53,300", "55,900"];
  const scope2m = opts.scope2m ?? ["2,000", "1,500", "1,250"];
  const doc = new PDFDocument({ size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.fontSize(10).text("GHG emissions (metric tons CO2e)", 50, 60);
  ["2023", "2024", "2025"].forEach((y, i) => doc.text(y, 300 + i * 80, 90));
  doc.text("Scope 1", 50, 110);
  scope1.forEach((v, i) => doc.text(v, 300 + i * 80, 110));
  doc.text("Scope 2 (market-based)", 50, 130);
  scope2m.forEach((v, i) => doc.text(v, 300 + i * 80, 130));
  doc.text(opts.footer ?? "Reported for the consolidated group on an operational control basis.", 50, 160);
  if (opts.scannedPage) {
    doc.addPage();
    // A 2x2 grey PNG stands in for a scanned page image (no text layer).
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR4nGNgYGBgYAAAAAUAAeImBZsAAAAASUVORK5CYII=",
      "base64",
    );
    doc.image(png, 50, 50, { width: 400 });
  }
  doc.end();
  return done;
}
