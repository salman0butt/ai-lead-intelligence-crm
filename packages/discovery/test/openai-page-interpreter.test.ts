import { describe, expect, it, vi } from 'vitest';
import { OpenAiBrowserPageInterpreter } from '../src/browser/openai-page-interpreter.js';

describe('OpenAiBrowserPageInterpreter', () => {
  it('sends only bounded page snapshot fields and requests structured output', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ kind: 'RESULTS_PAGE' }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const interpreter = new OpenAiBrowserPageInterpreter({
      apiKey: 'test-key',
      model: 'gpt-test',
      fetch: fetchMock,
    });

    const result = await interpreter.interpret({
      url: `https://example.test/${'x'.repeat(4000)}`,
      title: `Title ${'t'.repeat(1000)}`,
      visibleText: `Visible ${'v'.repeat(20_000)}`,
      accessibilitySnapshot: `Semantic ${'s'.repeat(20_000)}`,
    });

    expect(result).toEqual({ kind: 'RESULTS_PAGE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-test');
    expect(body.store).toBe(false);
    expect(body.text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'browser_page_classification',
        strict: true,
      },
    });

    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('localstorage');
    expect(serialized).not.toContain('sessionstorage');
    expect(serialized).not.toContain('authorization:');
    expect(serialized.length).toBeLessThan(30_000);
  });

  it('fails closed on invalid model output', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"kind":"DO_SOMETHING_ELSE"}' }],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const interpreter = new OpenAiBrowserPageInterpreter({
      apiKey: 'test-key',
      model: 'gpt-test',
      fetch: fetchMock,
    });

    await expect(
      interpreter.interpret({
        url: 'https://example.test',
        title: 'Unknown',
        visibleText: 'Unknown layout',
        accessibilitySnapshot: 'main Unknown layout',
      }),
    ).rejects.toThrow(/classification/i);
  });
});
