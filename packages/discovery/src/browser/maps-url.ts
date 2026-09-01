import { createHash } from 'node:crypto';

const GOOGLE_MAPS_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com']);

export function buildGoogleMapsSearchUrl(searchText: string): string {
  const normalized = searchText.trim();
  if (!normalized) throw new Error('Google Maps search text is required');

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalized)}`;
}

export function normalizeMapsListingUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Google Maps listing URL is required');
  }

  const hostname = url.hostname.toLowerCase();
  if (!GOOGLE_MAPS_HOSTS.has(hostname) || !url.pathname.startsWith('/maps/')) {
    throw new Error('Google Maps listing URL is required');
  }

  const normalizedPath = url.pathname.length > 1 && url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname;

  return `https://www.google.com${normalizedPath}`;
}

export function mapsListingExternalId(input: string): string {
  const normalized = normalizeMapsListingUrl(input);
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `maps-url-sha256:${digest}`;
}
