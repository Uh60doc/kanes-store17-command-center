import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require("../logic.js");
const logic = globalThis.FloorLogic;

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docsDir = "/cursor/stores/bc-bb2f1b0c-bb7b-4d6c-a72c-b16e41316edd/docs";

function sheet(names, title, fileName, otherFile, otherLabel) {
  const cards = names.map((name) => {
    const svg = logic.code128Svg(name, { module: 3, height: 108, quiet: 12 });
    return `    <article class="code" data-payload="${name}">
      <div class="bars">${svg}</div>
      <p class="name">${name}</p>
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #fff;
        color: #161616;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      }
      .sheet-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        align-items: center;
        padding: 0.8rem 1.2rem;
        border-bottom: 1px solid #ddd;
      }
      h1 { font-size: 1.4rem; margin: 0; }
      .note { margin: 0; color: #444; }
      button, a.nav {
        font: inherit;
        min-height: 44px;
        padding: 0.4rem 0.8rem;
        border-radius: 8px;
        border: 2px solid #1b4634;
        background: #fff;
        color: inherit;
        text-decoration: none;
        cursor: pointer;
      }
      button { background: #1b4634; color: #fff; font-weight: 700; }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.2rem 1.4rem;
        padding: 1rem 1.2rem 2rem;
      }
      .code {
        border: 1px solid #e6e6e6;
        border-radius: 12px;
        padding: 0.7rem 0.6rem 0.3rem;
        text-align: center;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .bars svg { width: min(100%, 420px); height: auto; }
      .name {
        margin: 0.15rem 0 0.2rem;
        font-size: 3.2rem;
        font-weight: 800;
        line-height: 1;
        letter-spacing: 0.04em;
      }
      @media print {
        .sheet-tools { display: none !important; }
        .grid { gap: 0.45rem 0.6rem; padding: 0; }
        .code { border: 0; padding: 0.2rem 0.1rem; }
        .name { font-size: 2.4rem; }
      }
      @page { size: letter; margin: 0.45in; }
    </style>
  </head>
  <body>
    <div class="sheet-tools">
      <h1>${title}</h1>
      <p class="note">Each barcode is the zone name. Scan it in Floor count.</p>
      <button type="button" onclick="window.print()">Print</button>
      <a class="nav" href="http://127.0.0.1:8765/">Back to count</a>
      <a class="nav" href="${otherFile}">${otherLabel}</a>
    </div>
    <div class="grid">
${cards}
    </div>
  </body>
</html>
`;
}

function namesFrom(start, count) {
  return Array.from({ length: count }, (_, i) => logic.zoneNameAt(start + i));
}

mkdirSync(docsDir, { recursive: true });
const sheets = [
  {
    file: "zone-barcodes-a-z.html",
    html: sheet(namesFrom(0, 26), "Zone barcodes A–Z", "zone-barcodes-a-z.html", "zone-barcodes-a1-z1.html", "A1–Z1 sheet"),
  },
  {
    file: "zone-barcodes-a1-z1.html",
    html: sheet(namesFrom(26, 26), "Zone barcodes A1–Z1", "zone-barcodes-a1-z1.html", "zone-barcodes-a-z.html", "A–Z sheet"),
  },
];
for (const item of sheets) {
  writeFileSync(path.join(appDir, item.file), item.html);
  writeFileSync(path.join(docsDir, item.file), item.html);
}
console.log(`Wrote ${sheets.map((item) => item.file).join(", ")}`);
