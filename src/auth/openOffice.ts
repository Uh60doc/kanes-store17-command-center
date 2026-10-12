import { sealedOffice } from './sealedOffice.ts';
import type { OfficeTargets } from '../config/targets.ts';

function bytesFromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readTargets(value: unknown): OfficeTargets | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const management = record.managementGoals;
  const stretch = record.corporateStretch;
  if (!management || typeof management !== 'object' || !stretch || typeof stretch !== 'object') {
    return null;
  }
  const goals = management as Record<string, unknown>;
  const stretchGoals = stretch as Record<string, unknown>;
  const writtenSales = goals.writtenSales;
  const deliveredSales = goals.deliveredSales;
  const beddingMinimum = goals.beddingMinimum;
  const closingRatioTarget = goals.closingRatioTarget;
  const stretchWritten = stretchGoals.writtenSales;
  const stretchDelivered = stretchGoals.deliveredSales;
  if (
    !isFiniteNumber(writtenSales) ||
    !isFiniteNumber(deliveredSales) ||
    !isFiniteNumber(beddingMinimum) ||
    !isFiniteNumber(closingRatioTarget) ||
    !isFiniteNumber(stretchWritten) ||
    !isFiniteNumber(stretchDelivered)
  ) {
    return null;
  }
  if (writtenSales < 0 || deliveredSales < 0 || stretchWritten < 0 || stretchDelivered < 0) return null;
  if (beddingMinimum < 0 || beddingMinimum > 1 || closingRatioTarget < 0 || closingRatioTarget > 1) {
    return null;
  }
  return {
    managementGoals: {
      writtenSales,
      deliveredSales,
      beddingMinimum,
      closingRatioTarget,
    },
    corporateStretch: {
      writtenSales: stretchWritten,
      deliveredSales: stretchDelivered,
    },
  };
}

/**
 * Opens the October targets for this browser session only.
 * A wrong access code yields null. Nothing is written to disk.
 */
export async function openOffice(accessCode: string): Promise<OfficeTargets | null> {
  const trimmed = accessCode.trim();
  if (trimmed === '') return null;

  try {
    const salt = bytesFromBase64(sealedOffice.salt);
    const iv = bytesFromBase64(sealedOffice.iv);
    const cipher = bytesFromBase64(sealedOffice.cipher);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(trimmed),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: sealedOffice.iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    return readTargets(parsed);
  } catch {
    return null;
  }
}
