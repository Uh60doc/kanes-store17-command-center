import type { ImportSourceDescriptor } from './types.ts';

/**
 * The only two sources that may hand a report file to the import boundary.
 * The mailbox is not downloaded automatically. A file handed to
 * `acceptIncomingReport` is parsed, and automated import stays off.
 */
export const importSources: readonly ImportSourceDescriptor[] = [
  {
    id: 'manual-upload',
    label: 'Manual upload',
    connected: false,
    handsOffTo: 'acceptIncomingReport',
  },
  {
    id: 'company-mailbox',
    label: 'Company mailbox',
    connected: false,
    handsOffTo: 'acceptIncomingReport',
  },
];
