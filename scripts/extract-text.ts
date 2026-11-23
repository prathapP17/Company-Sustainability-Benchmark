/**
 * CLI: extract page-marked text from PDFs (or strip an XHTML/iXBRL file to
 * text) so a researcher can search terms and read only relevant pages.
 *
 *   npx tsx scripts/extract-text.ts <file.pdf|file.xhtml> [...more]
 *
 * Writes <file>.txt next to each input. Never writes into data/.
 */
import { readFile, writeFile } from "node:fs/promises";
import { extractPdfPages, pagesToMarkedText } from "../src/lib/extract/pdf-text";
import { xhtmlToMarkedText } from "../src/lib/extract/xhtml-text";

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: tsx scripts/extract-text.ts <file> [...]");
    process.exit(2);
  }
  for (const f of files) {
    const started = Date.now();
    let text: string;
    if (/\.x?html?$/i.test(f)) {
      text = xhtmlToMarkedText(await readFile(f, "utf8"));
    } else {
      const pages = await extractPdfPages(f);
      text = pagesToMarkedText(pages);
    }
    await writeFile(`${f}.txt`, text, "utf8");
    console.log(`${f}: ${text.length} chars in ${Date.now() - started} ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
