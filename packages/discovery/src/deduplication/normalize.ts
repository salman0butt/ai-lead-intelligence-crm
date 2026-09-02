import type {
  BusinessIdentityInput,
  NormalizedBusinessIdentity,
} from './types.js';

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePostalCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

  return normalized || null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const hasExplicitPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  return `${hasExplicitPlus ? '+' : ''}${digits}`;
}

export function normalizeDomain(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(hasScheme(trimmed) ? trimmed : `https://${trimmed}`);
    let hostname = url.hostname.toLowerCase();
    hostname = hostname.replace(/\.$/, '');
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname || null;
  } catch {
    return null;
  }
}

export function normalizeIdentity(input: BusinessIdentityInput): NormalizedBusinessIdentity {
  const normalizedCity = input.city ? normalizeText(input.city) || null : null;

  return {
    normalizedName: normalizeText(input.name),
    normalizedAddress: normalizeText(input.formattedAddress),
    normalizedCity,
    normalizedPostalCode: normalizePostalCode(input.postalCode),
    normalizedPhone: normalizePhone(input.phone),
    canonicalDomain: normalizeDomain(input.canonicalDomain),
  };
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}
