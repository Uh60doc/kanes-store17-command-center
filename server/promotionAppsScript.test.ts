import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { harness, session } from './octoberVerified.ts';

const flyer = [
  '78th Anniversary Sale',
  'October 20-26, 2026',
  '',
  'Featured floor samples are 50% off.',
  'Davey Euro Top mattresses are 50% off.',
  '',
  'Palm Gate 5-piece King Bedroom was $3,999.99 now $1,899.99',
  'Oakley White/Grey 4-piece Sectional was $2,999.99 now $1,499.99',
  'Dallas Saddle 6-piece Manual Reclining Sectional was $2,799.99 now $1,399.99',
  '',
  'Queen: $599.50',
  'King: $899.50',
  '',
  'STORE 17 MARQUEE',
  '78th Anniversary Sale. October 20-26. Featured floor samples 50% off.',
  '',
  '6 months',
  'No minimum. No down payment. Discounts allowed. Ends October 26, 2026.',
  '',
  '78 months',
  '0% interest. $5,999.99 minimum. 25% deposit using another payment method. Yellow Tag only. No additional discount. Ends October 26, 2026.',
  '',
  'Exclusions: Special orders, Tempur-Pedic, Beautyrest Black.',
].join('\n');

function review(gs: Record<string, (...args: any[]) => any>, text: string, fileName = '10.20_10.26 78th Anniversary Sale - STORES.pdf') {
  gs.pdfText_ = () => text;
  return gs.reviewPromotionPdf_({
    session,
    fileName,
    base64: Buffer.from(`%PDF-1.4\n${text}\n%%EOF`).toString('base64'),
  });
}

function approve(gs: Record<string, (...args: any[]) => any>, draft: Record<string, any>) {
  const financing = (draft.financing || []).map((term: Record<string, any>) =>
    [term.months, term.end, term.zeroInterest ? 'yes' : 'no', term.summary].join(' | ')).join('\n');
  const featured = (draft.featured || []).map((item: Record<string, any>) =>
    [item.name, item.was, item.now, item.save, item.off].join(' | ')).join('\n');
  return gs.savePromotion_({
    session,
    name: draft.name,
    start: draft.start,
    end: draft.end,
    highlights: (draft.highlights || []).join('\n'),
    featured,
    floorNote: draft.floorNote || '',
    mattressName: draft.mattressName || '',
    mattressOff: draft.mattressOff || '',
    mattressLines: (draft.mattressLines || []).join('\n'),
    mattressNote: draft.mattressNote || '',
    exclusions: (draft.exclusions || []).join('\n'),
    financing,
    beddingFinance: draft.beddingFinance || '',
    marquee: draft.marquee || '',
    mainFinance: draft.mainFinance || '',
    restrictions: draft.restrictions || '',
    fullText: draft.fullText || '',
    approved: true,
  });
}

test('the morning meeting follows the approved sale for that date and keeps the old sale in history', () => {
  const { gs, tabs, setToday } = harness();
  const daily = JSON.stringify(tabs.CC_Daily);
  const written = gs.morning_({ session }).yesterday.written.actual;
  const todayGoal = gs.morning_({ session }).today.written;

  const during = gs.morning_({ session });
  assert.equal(during.date, '2026-10-17');
  assert.equal(during.promotion.name, '78th Anniversary Sale');
  assert.equal(during.promotion.start, '2026-10-13');
  assert.equal(during.promotion.end, '2026-10-19');
  assert.equal(during.financing.length, 7);
  assert.equal(during.review, null);

  setToday('2026-10-19');
  const lastDay = gs.morning_({ session });
  assert.equal(lastDay.promotion.end, '2026-10-19');
  assert.equal(lastDay.financing.some((term: { months: number }) => term.months === 6), true);

  setToday('2026-10-20');
  const gap = gs.morning_({ session });
  assert.equal(gap.promotion, null);
  assert.equal(JSON.stringify(gap.financing.map((term: { months: number }) => term.months)), '[78]');

  setToday('2026-10-27');
  const after = gs.morning_({ session });
  assert.equal(after.promotion, null);
  assert.equal(JSON.stringify(after.financing), '[]');

  setToday('2026-10-20');
  const parsed = gs.parsePromotionText_(flyer);
  assert.equal(parsed.start, '2026-10-20');
  assert.equal(parsed.end, '2026-10-26');
  assert.equal(parsed.approved, 'no');
  assert.equal(parsed.featured[0].now, 1899.99);
  assert.match(parsed.mainFinance, /Minimum purchase is \$5,999\.99/);
  assert.match(parsed.mainFinance, /Required deposit is 25%/);
  assert.match(parsed.mainFinance, /October 26, 2026/);
  assert.match(parsed.marquee, /Featured floor samples 50% off/);
  assert.equal(parsed.financingUnread, false);

  const pendingPage = review(gs, flyer);
  assert.equal(pendingPage.promotion, null);
  assert.equal(pendingPage.editor.approved, 'no');
  assert.equal(pendingPage.editor.start, '2026-10-20');
  assert.ok(pendingPage.review.changes.some((change: { label: string }) => change.label === 'Start date'));
  assert.ok(pendingPage.review.changes.some((change: { label: string, to: string }) => change.label === 'Palm Gate 5-piece King Bedroom now' && change.to === '$1,899.99'));
  assert.equal(gs.promotionForDate_('2026-10-19').end, '2026-10-19');

  const approved = approve(gs, pendingPage.editor);
  assert.equal(approved.promotion.name, '78th Anniversary Sale');
  assert.equal(approved.promotion.start, '2026-10-20');
  assert.equal(approved.promotion.end, '2026-10-26');
  assert.match(approved.promotion.mainFinance, /25%/);
  assert.match(approved.promotion.marquee, /Store 17|Featured floor samples/i);
  assert.ok(approved.financing.some((term: { months: number, end: string }) => term.months === 6 && term.end === '2026-10-26'));

  setToday('2026-10-19');
  const stillOld = gs.morning_({ session });
  assert.equal(stillOld.promotion.start, '2026-10-13');
  assert.equal(stillOld.promotion.end, '2026-10-19');
  assert.equal(stillOld.promotion.featured[0].now, 1999.99);
  assert.equal(gs.briefPromotionInfo_('2026-10-17').name, '78th Anniversary Sale');

  setToday('2026-10-26');
  assert.equal(gs.morning_({ session }).promotion.end, '2026-10-26');
  setToday('2026-10-27');
  assert.equal(gs.morning_({ session }).promotion, null);

  const ids = (tabs.CC_Promotions || []).map((row) => row[0]);
  assert.ok(ids.includes('history-2026-10-13-2026-10-19'));
  assert.equal(JSON.stringify(tabs.CC_Daily), daily);
  setToday('2026-10-17');
  const back = gs.morning_({ session });
  assert.equal(back.promotion.end, '2026-10-19');
  assert.equal(back.yesterday.written.actual, written);
  assert.equal(back.today.written, todayGoal);
});

test('a promotion PDF with no dates or no financing is not treated as the old sale', () => {
  const { gs, setToday } = harness();
  assert.throws(() => gs.parsePromotionText_('78th Anniversary Sale\nSee the showroom.'), /dates could not be read/);
  const thin = review(gs, '78th Anniversary Sale\nOctober 20-26, 2026\nCome see the store.');
  assert.equal(thin.promotion.end, '2026-10-19');
  assert.equal(thin.editor.approved, 'no');
  assert.equal(thin.editor.financingUnread, true);
  assert.equal(JSON.stringify(thin.editor.financing), '[]');
  assert.ok(thin.review.changes.some((change: { label: string }) => change.label === 'Financing'));
  setToday('2026-10-17');
  assert.equal(gs.morning_({ session }).promotion.end, '2026-10-19');
  assert.equal(gs.morning_({ session }).financing.length, 7);
});

test('the October 20 anniversary sheet keeps the same prices and moves the dates', () => {
  const text = readFileSync(new URL('./fixtures/anniversary-2026-10-20.txt', import.meta.url), 'utf8');
  const { gs, setToday } = harness();
  const parsed = gs.parsePromotionText_(text);
  assert.equal(parsed.name, '78th Anniversary Sale');
  assert.equal(parsed.start, '2026-10-20');
  assert.equal(parsed.end, '2026-10-26');
  assert.equal(parsed.featured[0].now, 1999.99);
  assert.equal(parsed.featured[1].name, 'Oakley White/Grey 4-piece Sectional');
  assert.equal(parsed.featured[1].now, 1499.99);
  assert.equal(parsed.featured[2].now, 1399.99);
  assert.equal(JSON.stringify(parsed.mattressLines), JSON.stringify(['Queen: $599.50', 'King: $899.50']));
  assert.equal(parsed.marquee, '78th Anniversary Sale - $78,000 Home Furnishing Giveaway');
  assert.match(parsed.mainFinance, /Minimum purchase is \$5,999\.99/);
  assert.match(parsed.mainFinance, /Required deposit is 25%/);
  assert.match(parsed.mainFinance, /Equal monthly payments are required/);
  assert.match(parsed.mainFinance, /October 10, 2026 through October 26, 2026/);
  assert.equal(parsed.financing.find((term: { months: number }) => term.months === 60).zeroInterest, false);
  assert.match(parsed.beddingFinance, /Twin and Twin XL minimum is \$1,099/);
  assert.match(parsed.beddingFinance, /Queen and Full minimum is \$1,299/);
  assert.match(parsed.beddingFinance, /King minimum is \$1,599/);
  assert.doesNotMatch(parsed.marquee, /Every Item/);
  const changes = gs.comparePromotions_(gs.readPromotion_(), parsed);
  assert.ok(changes.some((change: { label: string }) => change.label === 'Start date'));
  assert.ok(!changes.some((change: { label: string, to: string }) => change.label === 'Palm Gate 5-piece King Bedroom now'));
  approve(gs, { ...parsed, approved: 'yes' });
  setToday('2026-10-20');
  const page = gs.morning_({ session });
  assert.equal(page.promotion.end, '2026-10-26');
  assert.equal(page.promotion.featured[0].now, 1999.99);
  setToday('2026-10-19');
  assert.equal(gs.morning_({ session }).promotion.end, '2026-10-19');
  assert.equal(gs.morning_({ session }).promotion.featured[2].now, 1399.99);
});
