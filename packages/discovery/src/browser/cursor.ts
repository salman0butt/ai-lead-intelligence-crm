import { Buffer } from 'node:buffer';

export interface GoogleMapsCursorV1 {
  v: 1;
  seenIds: string[];
  scrollRounds: number;
}

const MAX_SEEN_IDS = 500;
const MAX_SCROLL_ROUNDS = 100;
const MAX_CURSOR_BYTES = 128 * 1024;

function validateCursor(value: unknown): GoogleMapsCursorV1 {
  if (!value || typeof value !== 'object') {
    throw new Error('Google Maps cursor must be an object');
  }

  const candidate = value as Partial<GoogleMapsCursorV1>;
  if (candidate.v !== 1) {
    throw new Error('Unsupported Google Maps cursor version');
  }
  if (!Array.isArray(candidate.seenIds) || candidate.seenIds.length > MAX_SEEN_IDS) {
    throw new Error(`Google Maps cursor seenIds must contain at most ${MAX_SEEN_IDS} items`);
  }
  if (
    candidate.seenIds.some(
      (id) => typeof id !== 'string' || id.length === 0 || id.length > 512,
    )
  ) {
    throw new Error('Google Maps cursor seenIds contains an invalid identifier');
  }
  if (
    !Number.isInteger(candidate.scrollRounds) ||
    (candidate.scrollRounds ?? -1) < 0 ||
    (candidate.scrollRounds ?? MAX_SCROLL_ROUNDS + 1) > MAX_SCROLL_ROUNDS
  ) {
    throw new Error(`Google Maps cursor scrollRounds must be between 0 and ${MAX_SCROLL_ROUNDS}`);
  }

  return {
    v: 1,
    seenIds: [...candidate.seenIds],
    scrollRounds: candidate.scrollRounds as number,
  };
}

export function encodeGoogleMapsCursor(cursor: GoogleMapsCursorV1): string {
  const validated = validateCursor(cursor);
  const json = JSON.stringify(validated);
  if (Buffer.byteLength(json, 'utf8') > MAX_CURSOR_BYTES) {
    throw new Error('Google Maps cursor is too large');
  }
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeGoogleMapsCursor(encoded: string): GoogleMapsCursorV1 {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_CURSOR_BYTES * 2) {
    throw new Error('Google Maps cursor is invalid');
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!json || Buffer.byteLength(json, 'utf8') > MAX_CURSOR_BYTES) {
      throw new Error('Google Maps cursor is invalid');
    }
    return validateCursor(JSON.parse(json) as unknown);
  } catch (error) {
    if (error instanceof Error && /Google Maps cursor/.test(error.message)) throw error;
    throw new Error('Google Maps cursor is invalid', { cause: error });
  }
}
