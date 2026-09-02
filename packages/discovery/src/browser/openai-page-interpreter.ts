import {
  sanitizeBrowserPageSnapshot,
  type BrowserPageInterpretation,
  type BrowserPageInterpreter,
  type BrowserPageKind,
  type BrowserPageSnapshot,
} from './page-interpreter.js';

const PAGE_KINDS: readonly BrowserPageKind[] = [
  'RESULTS_PAGE',
  'NO_RESULTS',
  'BLOCKED_OR_CAPTCHA',
  'CONSENT_PAGE',
  'UNKNOWN_LAYOUT',
];

interface OpenAiBrowserPageInterpreterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

function outputText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

function validateInterpretation(value: unknown): BrowserPageInterpretation {
  if (!value || typeof value !== 'object') {
    throw new Error('Browser page classification response must be an object');
  }

  const candidate = value as { kind?: unknown; resultContainerHint?: unknown };
  if (
    typeof candidate.kind !== 'string' ||
    !PAGE_KINDS.includes(candidate.kind as BrowserPageKind)
  ) {
    throw new Error('Browser page classification returned an invalid kind');
  }

  if (
    candidate.resultContainerHint !== undefined &&
    candidate.resultContainerHint !== null &&
    typeof candidate.resultContainerHint !== 'string'
  ) {
    throw new Error('Browser page classification returned an invalid result hint');
  }

  const hint =
    typeof candidate.resultContainerHint === 'string'
      ? candidate.resultContainerHint.trim().slice(0, 256)
      : '';

  return hint
    ? { kind: candidate.kind as BrowserPageKind, resultContainerHint: hint }
    : { kind: candidate.kind as BrowserPageKind };
}

export class OpenAiBrowserPageInterpreter implements BrowserPageInterpreter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiBrowserPageInterpreterOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.fetchImpl = options.fetch ?? fetch;

    if (!this.apiKey) throw new Error('OpenAI browser page interpreter requires an API key');
    if (!this.model) throw new Error('OpenAI browser page interpreter requires a model');
  }

  async interpret(input: BrowserPageSnapshot): Promise<BrowserPageInterpretation> {
    const snapshot = sanitizeBrowserPageSnapshot(input);
    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions:
          'Classify this rendered public business-search page. Return only the requested structured classification. Do not propose interactions or navigation steps.',
        input: JSON.stringify(snapshot),
        text: {
          format: {
            type: 'json_schema',
            name: 'browser_page_classification',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: PAGE_KINDS },
                resultContainerHint: { type: ['string', 'null'] },
              },
              required: ['kind', 'resultContainerHint'],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Browser page classification request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const text = outputText(payload);
    if (!text) throw new Error('Browser page classification returned no structured output');

    try {
      return validateInterpretation(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof Error && /classification/.test(error.message)) throw error;
      throw new Error('Browser page classification response was invalid', { cause: error });
    }
  }
}
