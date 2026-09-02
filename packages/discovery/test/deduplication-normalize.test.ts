import { describe, expect, it } from 'vitest';
import * as discovery from '../src/index.js';

type NormalizationApi = {
  normalizeText?: (value: string) => string;
  normalizePostalCode?: (value: string | null | undefined) => string | null;
  normalizePhone?: (value: string | null | undefined) => string | null;
  normalizeDomain?: (value: string | null | undefined) => string | null;
  normalizeIdentity?: (input: {
    name: string;
    formattedAddress: string;
    city?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    canonicalDomain?: string | null;
  }) => {
    normalizedName: string;
    normalizedAddress: string;
    normalizedCity: string | null;
    normalizedPostalCode: string | null;
    normalizedPhone: string | null;
    canonicalDomain: string | null;
  };
};

const normalization = discovery as NormalizationApi;

describe('business identity normalization', () => {
  it('normalizes Unicode, case, punctuation, and whitespace without stripping identity words', () => {
    expect(normalization.normalizeText?.('  ＡＣＭＥ,   Dental LLC ')).toBe('acme dental llc');
    expect(normalization.normalizeText?.('Acme Clinic Ltd.')).toBe('acme clinic ltd');
  });

  it('does not expand address abbreviations', () => {
    expect(normalization.normalizeText?.('12 Main St.')).toBe('12 main st');
    expect(normalization.normalizeText?.('12 Main Street')).toBe('12 main street');
  });

  it('normalizes postal presentation without inferring country-specific meaning', () => {
    expect(normalization.normalizePostalCode?.(' SW1A 1AA ')).toBe('sw1a1aa');
    expect(normalization.normalizePostalCode?.('12-345')).toBe('12345');
    expect(normalization.normalizePostalCode?.(null)).toBeNull();
  });

  it('removes phone formatting while preserving only an explicit leading plus', () => {
    expect(normalization.normalizePhone?.('(555) 123-4567')).toBe('5551234567');
    expect(normalization.normalizePhone?.('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalization.normalizePhone?.('')).toBeNull();
  });

  it('does not infer a country code for local phone numbers', () => {
    expect(normalization.normalizePhone?.('0300 1234567')).toBe('03001234567');
  });

  it('canonicalizes URL-like and hostname domain inputs', () => {
    expect(normalization.normalizeDomain?.('https://WWW.Example.com:443/path?q=1#top')).toBe(
      'example.com',
    );
    expect(normalization.normalizeDomain?.('WWW.Example.com/path')).toBe('example.com');
    expect(normalization.normalizeDomain?.('https://bücher.example/')).toBe('xn--bcher-kva.example');
    expect(normalization.normalizeDomain?.('example.com.')).toBe('example.com');
  });

  it('returns null instead of throwing for absent or invalid domain input', () => {
    expect(normalization.normalizeDomain?.(null)).toBeNull();
    expect(normalization.normalizeDomain?.('://bad host')).toBeNull();
    expect(normalization.normalizeDomain?.('   ')).toBeNull();
  });

  it('normalizes a complete candidate identity deterministically', () => {
    expect(
      normalization.normalizeIdentity?.({
        name: ' ACME Dental, LLC ',
        formattedAddress: ' 12 Main St., Austin, TX ',
        city: ' AUSTIN ',
        postalCode: ' 787 01 ',
        phone: '+1 (512) 555-0100',
        canonicalDomain: 'https://www.AcmeDental.Example/contact',
      }),
    ).toEqual({
      normalizedName: 'acme dental llc',
      normalizedAddress: '12 main st austin tx',
      normalizedCity: 'austin',
      normalizedPostalCode: '78701',
      normalizedPhone: '+15125550100',
      canonicalDomain: 'acmedental.example',
    });
  });
});
