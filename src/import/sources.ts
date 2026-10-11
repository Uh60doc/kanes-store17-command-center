import type { ImportSourceDescriptor } from './types.ts';

/**
 * The only two sources that may hand a report file to the import boundary.
 * Both stay disconnected in this slice. A later manual upload and a later
 * approved company mailbox call the same function with the same file shape.
 * There is no mailbox client here.
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
