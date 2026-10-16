export type EmployeeRole = 'associate' | 'management' | 'former' | 'unknown';

export interface Employee {
  code: string | null;
  aliasCodes: readonly string[];
  displayName: string;
  role: Exclude<EmployeeRole, 'unknown'>;
  onCard: boolean;
  startDate: string | null;
  note: string;
  nameAliases: readonly string[];
}

export const employees: readonly Employee[] = [
  {
    code: 'RDELSO',
    aliasCodes: [],
    displayName: 'Renzo Del Solar',
    role: 'associate',
    onCard: true,
    startDate: null,
    note: 'On vacation October 1 through October 12, 2026. Back October 13. Report lines during vacation stay on the sheet and those days are not counted as worked.',
    nameAliases: ['RENZO DEL SOLAR', 'RENZO DELSOLAR', 'DELSOLAR, RENZO'],
  },
  {
    code: 'PGANDH',
    aliasCodes: [],
    displayName: 'Prakash Gandhi',
    role: 'associate',
    onCard: true,
    startDate: null,
    note: '',
    nameAliases: ['PRAKASH GANDHI', 'PRAKASH B GANDHI', 'GANDHI, PRAKASH'],
  },
  {
    code: 'EMON0904',
    aliasCodes: [],
    displayName: 'Eric Montes Rodriguez',
    role: 'associate',
    onCard: true,
    startDate: null,
    note: '',
    nameAliases: ['ERIC MONTES', 'ERIC MONTES RODRIGUEZ', 'MONTES, ERIC'],
  },
  {
    code: 'TNASSI',
    aliasCodes: ['TNASSIF'],
    displayName: 'Ricky Nassif',
    role: 'associate',
    onCard: true,
    startDate: null,
    note: 'Report name Tarik Nassif. Display name is Ricky.',
    nameAliases: ['TARIK NASSIF', 'RICKY NASSIF', 'NASSIF, TARIK'],
  },
  {
    code: null,
    aliasCodes: [],
    displayName: 'Brenda Sanchez',
    role: 'associate',
    onCard: true,
    startDate: '2026-10-12',
    note: 'Starts October 12, 2026. Employee code is not on file.',
    nameAliases: ['BRENDA SANCHEZ'],
  },
  {
    code: null,
    aliasCodes: [],
    displayName: 'Caroline Amaro',
    role: 'former',
    onCard: false,
    startDate: null,
    note: 'Former associate. Terminated October 16, 2026. Hidden from active cards. Past sales stay in the store total.',
    nameAliases: ['CAROLINE AMARO'],
  },
  {
    code: 'CPRI0909',
    aliasCodes: [],
    displayName: 'Cordell Primous',
    role: 'management',
    onCard: false,
    startDate: '2026-10-17',
    note: 'Sales manager on leave. Expected return October 17, 2026.',
    nameAliases: ['CORDELL PRIMOUS', 'PRIMOUS, CORDELL'],
  },
  {
    code: 'JMEYERS',
    aliasCodes: [],
    displayName: 'Kelly Meyers',
    role: 'management',
    onCard: false,
    startDate: null,
    note: 'General manager. Report name James Meyers.',
    nameAliases: ['KELLY MEYERS', 'JAMES MEYERS', 'MEYERS, JAMES'],
  },
  {
    code: 'EPEREZ',
    aliasCodes: [],
    displayName: 'Elizabeth Perez',
    role: 'management',
    onCard: false,
    startDate: null,
    note: 'Operations manager.',
    nameAliases: ['ELIZABETH PEREZ', 'PEREZ, ELIZABETH'],
  },
  {
    code: null,
    aliasCodes: [],
    displayName: 'Valentina Lopez',
    role: 'former',
    onCard: false,
    startDate: null,
    note: 'Former associate. Hidden from active cards. Past sales stay in the store total.',
    nameAliases: ['VALENTINA LOPEZ'],
  },
];

export interface Identity {
  employeeCode: string | null;
  displayName: string;
  role: EmployeeRole;
  onCard: boolean;
  note: string;
}

function tokens(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((part) => part.length > 0)
    .sort();
}

function sameName(left: string, right: string): boolean {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2) return false;
  return shorter.every((token) => longer.includes(token));
}

export function identifyEmployee(code: string | null, sourceName: string): Identity {
  const normalizedCode = code?.trim().toUpperCase() || null;
  const byCode = normalizedCode
    ? employees.find((employee) => employee.code === normalizedCode || employee.aliasCodes.includes(normalizedCode))
    : undefined;
  const byName = employees.find((employee) => employee.nameAliases.some((alias) => sameName(alias, sourceName)));
  const employee = byCode ?? byName;
  if (!employee) {
    return {
      employeeCode: normalizedCode,
      displayName: titleName(sourceName),
      role: 'unknown',
      onCard: false,
      note: 'Not on the active roster. Amount stays in the store total.',
    };
  }
  return {
    employeeCode: employee.code ?? normalizedCode,
    displayName: employee.displayName,
    role: employee.role,
    onCard: employee.onCard,
    note: employee.note,
  };
}

function titleName(value: string): string {
  return value
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const cardAssociates = employees.filter((employee) => employee.onCard);
