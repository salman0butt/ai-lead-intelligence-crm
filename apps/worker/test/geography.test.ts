import { describe, expect, it } from 'vitest';
import { DefaultGeographyCatalog } from '../src/search-planner/geography.js';

describe('DefaultGeographyCatalog', () => {
  const catalog = new DefaultGeographyCatalog();

  it('preserves explicit city and region targeting as one search target', () => {
    expect(
      catalog.expand({
        country: 'United States',
        region: 'CA',
        city: 'San Diego',
      }),
    ).toEqual([
      {
        country: 'United States',
        region: 'CA',
        city: 'San Diego',
        geographicCell: '',
      },
    ]);
  });

  it('expands United States country-only targeting into all states plus DC', () => {
    const targets = catalog.expand({ country: 'United States' });
    const regions = targets.map((target) => target.region);

    expect(targets).toHaveLength(51);
    expect(new Set(regions).size).toBe(51);
    expect(regions).toEqual(expect.arrayContaining(['California', 'Texas', 'New York', 'District of Columbia']));
    expect(targets.every((target) => target.country === 'United States')).toBe(true);
    expect(targets.every((target) => target.city === '' && target.geographicCell === '')).toBe(true);
  });

  it('falls back to one country-level target when no subdivision catalog exists', () => {
    expect(catalog.expand({ country: 'Pakistan' })).toEqual([
      {
        country: 'Pakistan',
        region: '',
        city: '',
        geographicCell: '',
      },
    ]);
  });
});
