export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  right: number;
}

export interface PdfLine {
  y: number;
  items: PdfTextItem[];
}

export interface PdfPage {
  lines: PdfLine[];
}

export interface Column {
  x: number;
  right: number;
  name: string;
  field: string;
}

export function groupLines(items: readonly PdfTextItem[], tolerance = 2): PdfLine[] {
  const lines: PdfLine[] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

export function lineText(line: PdfLine): string {
  return line.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
}

export function pageBlob(pages: readonly PdfPage[]): string {
  return pages.map((page) => page.lines.map(lineText).join('\n')).join('\n');
}

const HEADER_LABEL = /^(salesperson|emp code|store name|salesman|sales person|sales associate)$/i;

export function findHeaderLine(lines: readonly PdfLine[]): PdfLine | null {
  for (const line of lines) {
    if (line.items.some((item) => HEADER_LABEL.test(item.text.trim()))) return line;
    if (HEADER_LABEL.test(lineText(line))) return line;
  }
  return null;
}

export function canonicalField(columnName: string): string {
  const name = columnName.toUpperCase().replace(/\s+/g, ' ').trim();
  if (name.includes('EMP') && name.includes('CODE')) return 'employeeCode';
  if (name === 'NAME' || name === 'SALESPERSON' || name === 'SALES ASSOCIATE' || name === 'STORE NAME' || name === 'SALESMAN' || name === 'SALES PERSON') {
    return 'name';
  }
  if (name.includes('HOME STORE')) return 'homeStore';
  if (name.includes('AVG') && name.includes('VS')) return 'avgSaleVsLy';
  if (name.includes('CUST') && name.includes('VS')) return 'customersVsLy';
  if (name.includes('VS LY') || name.includes('SALES VS')) return 'salesVsLy';
  if (name.includes('AVG') && name.includes('PTS')) return 'avgSalePts';
  if (name === 'AVG SALE' || name === 'AVERAGE SALES') return 'avgSale';
  if (name === 'BED SALES') return 'bedSales';
  if (name === 'BED PCT' || name === '%') return 'bedPct';
  if (name.includes('RUG') && name.includes('SOLD')) return 'rugUnits';
  if (name.includes('RUG')) return 'rugSales';
  if (name === 'RETAIL') return 'retail';
  if (name === 'TOTAL SALES' || name === 'SALES') return 'totalSales';
  if (name === 'CUSTOMERS' || name === '# OF CUST' || name === 'CUST') return 'customers';
  if (name.includes('WARR PCT')) return 'warrPct';
  if (name.includes('FIN PCT')) return 'finPct';
  if (name.includes('FAB PCT')) return 'fabPct';
  if (name.includes('POW PCT')) return 'powPct';
  if (name.includes('LTH PCT')) return 'lthPct';
  if (name.includes('PAD PCT')) return 'padPct';
  if (name.includes('WOOD PCT')) return 'woodPct';
  if (name === 'HIT %') return 'hitPct';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || 'field';
}

export function columnsFromHeader(lines: readonly PdfLine[], header: PdfLine): Column[] {
  const band = lines.filter((line) => line.y >= header.y - 1 && line.y <= header.y + 32);
  const tokens = band.flatMap((line) => line.items);
  const sorted = [...tokens].sort((a, b) => a.x - b.x || b.y - a.y);
  const columns: { x: number; right: number; tokens: PdfTextItem[] }[] = [];
  for (const token of sorted) {
    const current = columns[columns.length - 1];
    if (current && token.x <= current.right + 4) {
      current.tokens.push(token);
      current.right = Math.max(current.right, token.right);
      current.x = Math.min(current.x, token.x);
    } else {
      columns.push({ x: token.x, right: token.right, tokens: [token] });
    }
  }
  return columns.map((column) => {
    const name = column.tokens
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((token) => token.text)
      .join(' ');
    return { x: column.x, right: column.right, name, field: canonicalField(name) };
  });
}

export function readRow(line: PdfLine, columns: readonly Column[]): Record<string, string> {
  const grouped: Record<string, string[]> = {};
  for (const item of line.items) {
    let best: Column | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const column of columns) {
      const gap = Math.abs(column.right - item.right);
      if (gap < distance) {
        distance = gap;
        best = column;
      }
    }
    if (!best || distance > 42) continue;
    grouped[best.field] ??= [];
    grouped[best.field].push(item.text);
  }
  const row: Record<string, string> = {};
  for (const [field, parts] of Object.entries(grouped)) {
    row[field] = parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return row;
}

export function isFooter(line: PdfLine): boolean {
  const text = lineText(line);
  return text === '' || /^page\b/i.test(text) || line.y < 28;
}
