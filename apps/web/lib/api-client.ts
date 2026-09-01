export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  fetcher?: Fetcher;
}

export function createApiClient({ baseUrl, token, fetcher = fetch }: ApiClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetcher(`${normalizedBaseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch {
        // Preserve the status-based message for non-JSON failures.
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  return {
    get<T>(path: string) {
      return request<T>(path, { method: 'GET' });
    },
    post<T>(path: string, body: unknown) {
      return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    },
  };
}

export function createBrowserApiClient(token?: string | null) {
  return createApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    ...(token === undefined ? {} : { token }),
  });
}
