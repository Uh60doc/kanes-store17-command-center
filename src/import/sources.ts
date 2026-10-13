import type { ImportSourceDescriptor } from './types.ts';

/**
 * Manual upload and the company mailbox still hand files to the import
 * boundary, and both stay disconnected. The command-center sheet is read
 * by the server after sign-in. A newer sheet for the same metric and date
 * range replaces the current snapshot. Snapshots are not added together.
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
  {
    id: 'sheet',
    label: 'Command center sheet',
    connected: true,
    handsOffTo: 'acceptIncomingReport',
  },
];
