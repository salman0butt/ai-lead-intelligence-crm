import type { Page } from 'playwright';

export type BrowserPageKind =
  | 'RESULTS_PAGE'
  | 'NO_RESULTS'
  | 'BLOCKED_OR_CAPTCHA'
  | 'CONSENT_PAGE'
  | 'UNKNOWN_LAYOUT';

export interface BrowserPageSnapshot {
  url: string;
  title: string;
  visibleText: string;
  accessibilitySnapshot: string;
}

export interface BrowserPageInterpretation {
  kind: BrowserPageKind;
  resultContainerHint?: string;
}

export interface BrowserPageInterpreter {
  interpret(input: BrowserPageSnapshot): Promise<BrowserPageInterpretation>;
}

const MAX_URL_CHARS = 2_048;
const MAX_TITLE_CHARS = 512;
const MAX_VISIBLE_TEXT_CHARS = 8_000;
const MAX_ACCESSIBILITY_CHARS = 8_000;
const MAX_SEMANTIC_NODES = 200;

function bounded(value: string, maxChars: number): string {
  return value.replaceAll('\u0000', '').slice(0, maxChars);
}

export function sanitizeBrowserPageSnapshot(input: BrowserPageSnapshot): BrowserPageSnapshot {
  return {
    url: bounded(input.url, MAX_URL_CHARS),
    title: bounded(input.title, MAX_TITLE_CHARS),
    visibleText: bounded(input.visibleText, MAX_VISIBLE_TEXT_CHARS),
    accessibilitySnapshot: bounded(input.accessibilitySnapshot, MAX_ACCESSIBILITY_CHARS),
  };
}

export async function captureBrowserPageSnapshot(page: Page): Promise<BrowserPageSnapshot> {
  const raw = await page.evaluate((maxSemanticNodes) => {
    const clean = (value: string | null | undefined) => (value ?? '').trim();
    const selectors = [
      '[role]',
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      'h1',
      'h2',
      'h3',
      'main',
      'nav',
    ].join(',');

    const semanticNodes = Array.from(document.querySelectorAll<HTMLElement>(selectors))
      .slice(0, maxSemanticNodes)
      .map((element) => {
        const role = clean(element.getAttribute('role')) || element.tagName.toLowerCase();
        const label = clean(element.getAttribute('aria-label'));
        const text = clean(element.innerText || element.textContent);
        return [role, label, text].filter(Boolean).join(' | ');
      })
      .filter(Boolean);

    return {
      url: window.location.href,
      title: document.title,
      visibleText: document.body?.innerText ?? '',
      accessibilitySnapshot: semanticNodes.join('\n'),
    };
  }, MAX_SEMANTIC_NODES);

  return sanitizeBrowserPageSnapshot(raw);
}
