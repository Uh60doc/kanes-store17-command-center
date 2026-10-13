import { groupLines, type PdfPage, type PdfTextItem } from './layout.ts';

interface PdfJsTextItem {
  str: string;
  width: number;
  transform: number[];
}

function isTextItem(item: object): item is PdfJsTextItem {
  return 'str' in item && 'width' in item && 'transform' in item;
}

export async function extractPdfPages(bytes: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(bytes);
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    verbosity: 0,
    disableWorker: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const document = await task.promise;
  const pages: PdfPage[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!isTextItem(item) || item.str.trim() === '') continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      items.push({ text: item.str.trim(), x, y, right: x + item.width });
    }
    pages.push({ lines: groupLines(items) });
  }
  return pages;
}
