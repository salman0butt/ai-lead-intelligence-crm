import { describe, expect, it } from 'vitest';
import { expandNiche } from '../src/search-planner/niche-expander.js';

describe('expandNiche', () => {
  it('expands Dentist into the agreed deterministic query set', () => {
    expect(expandNiche('Dentist')).toEqual([
      'Dentist',
      'Dental Clinic',
      'Family Dentist',
      'Cosmetic Dentist',
      'Orthodontist',
      'Pediatric Dentist',
      'Emergency Dentist',
    ]);
    expect(expandNiche('dentists')).toEqual([
      'Dentist',
      'Dental Clinic',
      'Family Dentist',
      'Cosmetic Dentist',
      'Orthodontist',
      'Pediatric Dentist',
      'Emergency Dentist',
    ]);
  });

  it('falls back to one trimmed query for an unknown niche', () => {
    expect(expandNiche('  Plumber  ')).toEqual(['Plumber']);
  });
});
