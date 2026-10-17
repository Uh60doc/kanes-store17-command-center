/**
 * PERQ Performance Stats exports print no filter date, only the time they were exported. Each export is tied to its
 * business date here by its sha256, with the evidence that places it. An export without that evidence is never given
 * a date: it is held and counted only inside a verified block total.
 */

import { employees } from '../src/config/roster.ts';

export const PERQ_SOURCE = 'PERQ Ups + Be Backs';

type Cell = string | number | null;

export interface PerqPerson {
  code: string;
  name: string;
  opportunities: number;
}

export interface PerqExport {
  kind: 'location' | 'salesperson';
  store17: number | null;
  people: PerqPerson[];
  exportedAt: string;
}

export interface PerqDay {
  date: string;
  location: string[];
  salesperson: string[];
  evidence: string;
}

export interface HeldExport {
  location: string;
  salesperson: string[];
  exportOrderDate: string;
}

export interface PerqSnapshot {
  scope: 'store' | 'person';
  start: string;
  end: string;
  through: string;
  code: string;
  name: string;
  opportunities: number;
  note: string;
}

function personFor(code: string): { code: string; name: string } {
  const upper = code.trim().toUpperCase();
  const found = employees.find((person) => person.code === upper || (person.aliasCodes ?? []).some((alias) => alias.toUpperCase() === upper));
  return found?.code ? { code: found.code, name: found.displayName } : { code: upper, name: upper };
}

/** Read either Performance Stats export from its first sheet. A blank count in a listed row is 0. */
export function parsePerqExport(rows: readonly (readonly Cell[])[]): PerqExport {
  const title = String(rows[0]?.[0] ?? '').trim();
  if (title === 'Performance Stats by Location') {
    const store = rows.find((row) => /^Store 17\b/i.test(String(row[0] ?? '').trim()));
    return { kind: 'location', store17: store ? Number(store[1] ?? 0) || 0 : null, people: [], exportedAt: '' };
  }
  if (title !== 'Performance Stats by Salesperson') throw new Error(`"${title}" is not a PERQ Performance Stats export.`);
  const headerIndex = rows.findIndex((row) => String(row[0] ?? '').trim() === 'EmployeeCode');
  const header = (rows[headerIndex] ?? []).map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim());
  const column = header.findIndex((cell) => /^Ups \+ Be Backs$/i.test(cell));
  if (headerIndex < 0 || column < 0) throw new Error('The salesperson export has no Ups + Be Backs column.');
  const active = header.find((cell) => /^Active Deals/i.test(cell)) ?? '';
  const people = rows.slice(headerIndex + 1).filter((row) => String(row[0] ?? '').trim()).map((row) => ({
    ...personFor(String(row[0])),
    opportunities: Number(row[column] ?? 0) || 0,
  }));
  return { kind: 'salesperson', store17: null, people, exportedAt: active.replace(/^Active Deals\s*/i, '') };
}

const PROVES_OCT_1 = 'The October 1-31 and October 2-31 salesperson snapshots differ only by Ricky Nassif (32 and 28), so October 1 was Ricky 4 and no one else. This is the only export with Ricky 4 and no one else, and the store export beside it shows 4 (104 - 100).';
const PROVES_OCT_12_13 = 'The October 1-11 salesperson snapshot (Eric 29, Prakash 31, Ricky 29, Renzo 0) and the October 1-31 snapshot through October 13 (32, 31, 32, 7) leave exactly Eric 3, Ricky 3, Renzo 7 and Prakash 0 for October 12-13. Only this export and the Renzo 4 / Eric 0 / Ricky 0 export add up to that. SNAP Written shows Ricky with 2 written tickets and Renzo with 3 on October 12 and Renzo with 4 on October 13, which fits this export on October 12 and the other on October 13, not the reverse.';

/** Exports with evidence for their date. */
export const PERQ_DAYS: readonly PerqDay[] = [
  {
    date: '2026-10-01',
    location: ['41d0d7e769a5f52630cd1bea2542cc5f44798f040dc4631f23389f699df44834'],
    salesperson: ['73086306f40a23d733618a42c6926518574e1919575e5094dbbec015dd476dac'],
    evidence: PROVES_OCT_1,
  },
  {
    date: '2026-10-12',
    location: ['db5b3eebede2ee656ac34f9c8a747536911b91569c86d93bcb20381ae9756a94'],
    salesperson: ['4ce5ff2a57cbed33e604998642463fd29d257d0c3582c1a2333e1aab3a6bf297', '107be9405b5820a95eebd3131b743dad29c9b280f013b59041bc0445e3f437b4'],
    evidence: PROVES_OCT_12_13,
  },
  {
    date: '2026-10-13',
    location: ['0f759d4fafc1205879879244ba076c6d8e41142352ca020484eba8770a2b4dbc'],
    salesperson: ['1e7fe628c55662cd4569b29e8f19907261caf0555f136ae08d541bb91692fb6f'],
    evidence: PROVES_OCT_12_13,
  },
  {
    date: '2026-10-14',
    location: ['839a2d49f834bee4d86c87e40af82e376059c98c2599e53122105b71913bc697'],
    salesperson: ['fbef35f9267bf35f06585ca0652b20169321fbb3ffa40b8aca0ac78901c416f9'],
    evidence: 'Matches the October 14 daily PERQ already on file (store 4, Renzo Del Solar 4) and the General Manager confirmation that Renzo was the only salesperson working.',
  },
  {
    date: '2026-10-15',
    location: ['10b2d1c2417feaa99db41e7beee5c6f1f41256a3d93195937ac3e1f4e60189b9', 'e409b53b502b4e5111a0596db96601636e249f507f607f72818951d470b1bbeb'],
    salesperson: ['607ec62f22035cd97c1bda9a9cb961c57049835121afcd03e5320a1a4a0cbb01', '456194b1861cf9e3691249984ce0c228386788bdc1008270fe4c3926a060cc05'],
    evidence: 'Same counts as the export saved on October 15 at 8:15 PM (header "Active Deals 10/15/26 08:15pm"), and the October 15 SNAP Written report lists only Eric Montes and Ricky Nassif.',
  },
];

/**
 * Ten store exports and their salesperson exports belong to October 2-11 as a group (they add to 87, the October 1-11
 * snapshot of 91 less October 1), but no evidence fixes which day each one is. The export order is kept only as a
 * proposal for the General Manager to confirm.
 */
export const HELD_BLOCK = {
  start: '2026-10-02',
  end: '2026-10-11',
  store: 87,
  exports: [
    { location: '3514854668c874e4862a07990022e442156829544ced2956f7bc43d79b13c15a', salesperson: ['fd8cf3981f9a530e3a40ebb2dea9d20ffe9df1de227424cb30541bca0533e6cf'], exportOrderDate: '2026-10-02' },
    { location: 'fafa95606657f8f55002eaf74eab76f8468ad2222faca4e18aa5455d4cd4db89', salesperson: ['9cf89147daef1416232ed0b4be46b71324e370c4cc6c8aa36175f7b66ab935e0'], exportOrderDate: '2026-10-03' },
    { location: '2fff3e69ceac9169e3056b339c26423f45243c80cbd7d736a4a3d6a0c48d4c44', salesperson: ['87d7dd0ce3ec09d97f234ccc395a8630d84a62443c261f0163f3935f7c8dfc06'], exportOrderDate: '2026-10-04' },
    { location: 'b26d42814db57cf8b6176e82cf36c89dc56accbb92ca1a728fc6094cb0a4f59d', salesperson: ['e2e700d20cdf716265f684263392a99dde4b47af5fb7911c701cd09f3adc2c38'], exportOrderDate: '2026-10-05' },
    { location: '03226dc1e29879e8ecbec55e0e0a45794c61dfb4471c973d0e08915db21459c6', salesperson: ['a5b31683457b8beab5611e178667e59975374447e67377f15e65021a7bdeba1d'], exportOrderDate: '2026-10-06' },
    { location: '83aad192831ac1403fdde636ee693f6b3821e26e1023735a45bb852ee72cd8f4', salesperson: ['ce273e30a4d7e924e41820f047bc97059233959cad7eb5941767a461dcf5ba13'], exportOrderDate: '2026-10-07' },
    { location: '60478ef6a6a4a66a6f92cd4e13643341eb45c9232e282b1e04e4e50994e906ad', salesperson: ['a71c0db667c94405492b8e7bce8d67958aeae23fd92de9b174866dae77482970'], exportOrderDate: '2026-10-08' },
    { location: 'cc8ad53380e7e3b51c4844934f34184dbc170fcdb85c142af90c197aa5be90ff', salesperson: ['6a4afc85870da0673230fdbd6bf7f8a15aeba891a23e70cc8e2a9f770addc9ea', '007088f7d7e94cdf811cced0cedd8e63e81fea37d64f4232490a621bab7dcd2c'], exportOrderDate: '2026-10-09' },
    { location: '4c74f51d3fdb67372f0a4bafe07e9d50b6f6686ad518579e717d0c6755efd73d', salesperson: ['62ba5e328f7377e10c9ec62bbefe784bec346c0edb5ae51078c779c3aa163af7'], exportOrderDate: '2026-10-10' },
    { location: 'fae4b406924d6347fddf435384ae6ed0c99f8c3a41713467c55b8ba9c0bd8808', salesperson: ['b30c0bd9181477f7521969cec2f3fe1cbc50b9a96e9ed3d0cf5c24adfd28b670'], exportOrderDate: '2026-10-11' },
  ] as HeldExport[],
};

const OCT_1_11_SOURCE = 'PERQ salesperson screenshot, filter October 1 through October 11 (image(6).png in the October PERQ package).';

/** Cumulative counts that are verified without a daily date for every export. */
export const PERQ_SNAPSHOTS: readonly PerqSnapshot[] = [
  {
    scope: 'store', start: '2026-10-02', end: '2026-10-11', through: '2026-10-11', code: '', name: '', opportunities: 87,
    note: 'Store 17 Ups + Be Backs for October 2 through October 11. The October 1-11 salesperson snapshot totals 91, less October 1 (4), and the ten undated daily exports for these days also add to 87. Not added to any daily count.',
  },
  {
    scope: 'store', start: '2026-10-02', end: '2026-10-13', through: '2026-10-13', code: '', name: '', opportunities: 100,
    note: 'October 2-11 (87) plus the daily exports for October 12 (9) and October 13 (4) equal the October 2-31 snapshot of 100, so that snapshot ended October 13. Same count, not added again.',
  },
  ...[
    ['EMON0904', 29], ['PGANDH', 31], ['TNASSI', 29], ['RDELSO', 0], ['JMEYERS', 2], ['CPRI0909', 0], ['EPEREZ', 0],
  ].map(([code, opportunities]) => ({
    scope: 'person' as const, start: '2026-10-01', end: '2026-10-11', through: '2026-10-11', code: String(code), name: personFor(String(code)).name,
    opportunities: Number(opportunities), note: `${OCT_1_11_SOURCE} Not added to any daily count.`,
  })),
];

export const NOT_PERQ: Record<string, string> = {
  '63946a913cfc2f41c980cea9037c763ea106ca97d84bc58896aabe5edb0bf248': 'Saved as "Performance Stats by Salesperson.xlsx" but it is the Group ASL written report, cell for cell the same as DATA_ANALYSIS_KPI_ASL_WRITTEN_2026-10-15_2026-10-15.xlsx. Not PERQ. Not used again.',
};

export interface DayCounts {
  date: string;
  store: number;
  people: PerqPerson[];
  unassigned: number;
  files: string[];
  evidence: string;
}

/** Every export of a day must agree. A day whose salesperson rows do not add to the store count keeps the gap unassigned. */
export function dayCounts(day: PerqDay, exports: ReadonlyMap<string, PerqExport>): DayCounts | null {
  const locations = day.location.map((sha) => exports.get(sha)).filter((item): item is PerqExport => Boolean(item));
  const people = day.salesperson.map((sha) => exports.get(sha)).filter((item): item is PerqExport => Boolean(item));
  if (!locations.length || !people.length) return null;
  const stores = new Set(locations.map((item) => item.store17));
  if (stores.size !== 1 || locations[0].store17 === null) throw new Error(`The store exports for ${day.date} disagree or do not list Store 17.`);
  const lists = new Set(people.map((item) => JSON.stringify(item.people)));
  if (lists.size !== 1) throw new Error(`The salesperson exports for ${day.date} disagree.`);
  const store = locations[0].store17;
  const sum = people[0].people.reduce((total, person) => total + person.opportunities, 0);
  if (sum > store) throw new Error(`Salesperson opportunities for ${day.date} (${sum}) exceed the store count (${store}).`);
  const files = [...day.location, ...day.salesperson].filter((sha) => exports.has(sha));
  return { date: day.date, store, people: people[0].people, unassigned: store - sum, files, evidence: day.evidence };
}
