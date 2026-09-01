export interface GeographyInput {
  country: string;
  region?: string | null;
  city?: string | null;
}

export interface GeographicTarget {
  country: string;
  region: string;
  city: string;
  geographicCell: string;
}

export interface GeographyCatalog {
  expand(input: GeographyInput): GeographicTarget[];
}

const UNITED_STATES_REGIONS = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'District of Columbia',
] as const;

const UNITED_STATES_ALIASES = new Set([
  'united states',
  'united states of america',
  'usa',
  'u.s.a.',
  'us',
  'u.s.',
]);

function target(country: string, region = '', city = ''): GeographicTarget {
  return { country, region, city, geographicCell: '' };
}

export class DefaultGeographyCatalog implements GeographyCatalog {
  expand(input: GeographyInput): GeographicTarget[] {
    const country = input.country.trim();
    const region = input.region?.trim() ?? '';
    const city = input.city?.trim() ?? '';

    if (city) return [target(country, region, city)];
    if (region) return [target(country, region)];

    if (UNITED_STATES_ALIASES.has(country.toLowerCase())) {
      return UNITED_STATES_REGIONS.map((state) => target(country, state));
    }

    return [target(country)];
  }
}
