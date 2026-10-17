/** Morning-meeting rules. An example dollar amount is arithmetic, not a stored sale. */

export interface StaffLine {
  name: string;
  role: 'associate' | 'management' | 'former' | 'unknown';
  /** Null means the working roster did not say whether this person worked. */
  worked: boolean | null;
  onLeave: boolean;
  nwdsrWritten: number | null;
}

export interface DailyWinner {
  name: string;
  written: number;
  share: number;
  above: number;
}

export type WinnerResult =
  | { status: 'pending'; reason: string }
  | { status: 'ready'; share: number; winners: DailyWinner[] };

export interface FinanceTerm {
  months: number;
  summary: string;
  end: string;
  zeroInterest: boolean;
  highlight: boolean;
  bedding: boolean;
}

export interface SalePromotion {
  name: string;
  start: string;
  end: string;
  approved: boolean;
  highlights: string[];
  featured: { name: string; was: number; now: number; save: number; off: string }[];
  floorNote: string;
  mattressName: string;
  mattressOff: string;
  mattressLines: string[];
  mattressNote: string;
  exclusions: string[];
  financing: FinanceTerm[];
}

const MANAGEMENT_NAMES = new Set([
  'kelly meyers',
  'james meyers',
  'meyers james',
  'cordell primous',
  'primous cordell',
  'elizabeth perez',
  'perez elizabeth',
]);

function normalizedName(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z, ]/g, ' ').replace(/\s+/g, ' ').trim();
  const comma = key.split(',');
  if (comma.length === 2) return `${comma[1]} ${comma[0]}`.replace(/\s+/g, ' ').trim();
  return key;
}

export function managementName(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z, ]/g, ' ').replace(/\s+/g, ' ').trim();
  return MANAGEMENT_NAMES.has(key) || MANAGEMENT_NAMES.has(normalizedName(name));
}

/** A term summary names 0% only when that rate is its own token, so "20% down" does not count. */
export function claimsZeroInterest(summary: string): boolean {
  return /(^|[^0-9.])0\s*%/.test(summary);
}

function eligibleAssociate(line: StaffLine): boolean {
  return line.worked === true && line.role === 'associate' && !line.onLeave && !managementName(line.name);
}

/** Strictly above the individual share. A tie is not a win, and a miss is not listed. */
export function dailyWinners(lines: readonly StaffLine[], storeGoal: number | null): WinnerResult {
  if (storeGoal === null || storeGoal <= 0) {
    return { status: 'pending', reason: 'Yesterday\'s saved written goal is not on file.' };
  }
  if (lines.some((line) => line.worked === null)) {
    return { status: 'pending', reason: 'Yesterday\'s working roster is not on file.' };
  }
  if (lines.some((line) => line.worked === true && line.role === 'unknown')) {
    return { status: 'pending', reason: 'Yesterday\'s staffing roles are incomplete.' };
  }
  const eligible = lines.filter(eligibleAssociate);
  if (!eligible.length) {
    return { status: 'pending', reason: 'No eligible salesperson is marked as worked.' };
  }
  if (eligible.some((line) => line.nwdsrWritten === null)) {
    return { status: 'pending', reason: 'NWDSR Written by salesperson is not on file.' };
  }
  const share = Math.round((storeGoal / eligible.length) * 100) / 100;
  const winners = eligible
    .filter((line) => (line.nwdsrWritten as number) > share)
    .map((line) => ({
      name: line.name,
      written: line.nwdsrWritten as number,
      share,
      above: Math.round(((line.nwdsrWritten as number) - share) * 100) / 100,
    }));
  return { status: 'ready', share, winners };
}

export interface VerifiedFigure {
  value: number | null;
  /** Yesterday's own daily result, a later or earlier daily result, or a month-to-date snapshot. */
  scope: 'yesterday' | 'latest-daily' | 'mtd' | 'none';
  date: string;
  period: string;
}

/**
 * Yesterday's daily figure wins. A different day's figure stays labeled with its date.
 * A month-to-date figure is never returned as yesterday.
 */
export function chooseVerifiedFigure(input: {
  yesterday: string;
  dailyValue: number | null;
  latestDailyValue: number | null;
  latestDailyDate: string;
  mtdValue: number | null;
  mtdThrough: string;
  mtdPeriod: string;
}): VerifiedFigure {
  if (input.dailyValue !== null) {
    return { value: input.dailyValue, scope: 'yesterday', date: input.yesterday, period: '' };
  }
  if (input.latestDailyValue !== null && input.latestDailyDate) {
    return { value: input.latestDailyValue, scope: 'latest-daily', date: input.latestDailyDate, period: '' };
  }
  if (input.mtdValue !== null) {
    return { value: input.mtdValue, scope: 'mtd', date: input.mtdThrough, period: input.mtdPeriod };
  }
  return { value: null, scope: 'none', date: '', period: '' };
}

/**
 * Confirmed staffing is the working roster. Daily PERQ names who handled opportunities.
 * A missing or zero PERQ count is not an absence. Sales activity is a separate record.
 * Purchasing customers are not assigned from the store total.
 */
export function staffingStatement(
  date: string,
  lines: readonly (StaffLine & { perqOpportunities?: number | null })[],
): string {
  const working = lines.filter((line) => line.worked === true && line.role === 'associate' && !line.onLeave);
  const off = lines.filter((line) => line.worked === false && line.role === 'associate' && !line.onLeave);
  if (!working.length) return '';
  const workingNames = working.map((line) => line.name).join(', ');
  let note = `Confirmed staff working ${date}: ${workingNames}${working.length === 1 ? ' only.' : '.'}`;
  if (off.length === 1) {
    note += ` ${off[0]?.name} was confirmed not working.`;
  } else if (off.length > 1) {
    const last = off[off.length - 1]?.name ?? '';
    const rest = off.slice(0, -1).map((line) => line.name).join(', ');
    note += ` ${rest}, and ${last} were confirmed not working.`;
  }
  const handled = working.filter((line) => typeof line.perqOpportunities === 'number' && line.perqOpportunities > 0);
  if (handled.length) {
    note += ` Daily PERQ shows ${handled
      .map((line) => `${line.name} handled ${line.perqOpportunities} ${line.perqOpportunities === 1 ? 'opportunity' : 'opportunities'}`)
      .join(', ')}.`;
  }
  note += ' A missing daily PERQ count is not zero and is not an absence.';
  note += ' Recorded sales activity is separate from confirmed staffing.';
  note += ' Store purchasing customers were not assigned to a salesperson.';
  return note;
}

export function personalShare(storeGoal: number | null, workedCount: number | null): number | null {
  if (storeGoal === null || workedCount === null || workedCount <= 0) return null;
  return Math.round((storeGoal / workedCount) * 100) / 100;
}

export function activeSale(promotion: SalePromotion | null, today: string): SalePromotion | null {
  if (!promotion || !promotion.approved) return null;
  if (today < promotion.start || today > promotion.end) return null;
  return promotion;
}

/** Approved terms only, in term-length order. A bedding plan stays on its own list. */
export function activeFinancing(terms: readonly FinanceTerm[], today: string): FinanceTerm[] {
  return terms
    .filter((term) => !term.bedding && term.end >= today)
    .slice()
    .sort((left, right) => left.months - right.months);
}

export function anniversarySale(): SalePromotion {
  return {
    name: '78th Anniversary Sale',
    start: '2026-10-13',
    end: '2026-10-19',
    approved: true,
    highlights: [
      'Featured floor samples are 50% off.',
      'Davey Euro Top mattresses are 50% off.',
      '78-month 0% financing runs through October 26.',
    ],
    featured: [
      { name: 'Palm Gate 5-piece King Bedroom', was: 3999.99, now: 1999.99, save: 2000, off: '50% OFF' },
      { name: 'Oakley White/Grey 4-piece Sectional', was: 2999.99, now: 1499.99, save: 1500, off: '50% OFF' },
      { name: 'Dallas Saddle 6-piece Manual Reclining Sectional', was: 2799.99, now: 1399.99, save: 1400, off: '50% OFF' },
    ],
    floorNote: 'Additional sale merchandise is marked on the showroom floor. A complete list will be provided.',
    mattressName: 'Davey Euro Top',
    mattressOff: '50% OFF',
    mattressLines: ['Queen: $599.50', 'King: $899.50'],
    mattressNote: 'Mattresses are not automatically eligible for additional discounts. Only an explicitly approved special applies.',
    exclusions: ['Special orders', 'Tempur-Pedic', 'Beautyrest Black'],
    financing: [
      { months: 12, summary: 'No minimum, no down payment. Discounts allowed.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
      { months: 78, summary: 'SPECIAL 0% FINANCING. $5,999.99 minimum, 25% deposit using another payment method. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-26', zeroInterest: true, highlight: true, bedding: false },
      { months: 6, summary: 'No minimum, no down payment. Discounts allowed.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
      { months: 24, summary: '$1,999 minimum, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
      { months: 18, summary: 'No minimum, no down payment. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
      { months: 60, summary: '$5,999 minimum, 20% down, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
      { months: 48, summary: '$2,999 minimum, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false, bedding: false },
    ],
  };
}
