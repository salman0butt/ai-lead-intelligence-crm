import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from 'playwright';

export interface BrowserRuntimeOptions {
  headless: boolean;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

type BrowserLauncher = Pick<BrowserType, 'launch'>;

export class BrowserSessionFactory {
  private readonly options: BrowserRuntimeOptions;
  private readonly launcher: BrowserLauncher;

  constructor(options: BrowserRuntimeOptions, launcher: BrowserLauncher = chromium) {
    if (!Number.isFinite(options.navigationTimeoutMs) || options.navigationTimeoutMs <= 0) {
      throw new Error('Browser navigation timeout must be positive');
    }
    if (!Number.isFinite(options.actionTimeoutMs) || options.actionTimeoutMs <= 0) {
      throw new Error('Browser action timeout must be positive');
    }

    this.options = options;
    this.launcher = launcher;
  }

  async open(): Promise<BrowserSession> {
    const browser = await this.launcher.launch({ headless: this.options.headless });

    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
        page.setDefaultTimeout(this.options.actionTimeoutMs);
        return { browser, context, page };
      } catch (error) {
        await context.close().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}
