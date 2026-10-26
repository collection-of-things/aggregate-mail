// The renderer's typed call into the local mail service, and reload coalescing.
export type Api = <T>(url: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export type Perform = (task: () => Promise<unknown>, success?: string) => Promise<void>;

// Asks the service for a single-use sign-in link, then hands it to the browser.
export async function startGoogleSignIn(api: Api, options: { calendar?: boolean; accountId?: string } = {}) {
  const { url } = await api<{ url: string }>("/oauth/google/start", "POST", options);
  const base = new URL(window.desktop?.oauthUrl || "/", window.location.href);
  window.location.assign(new URL(url, base).href);
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function coalesceReload<T>(load: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  let pending = false;
  return () => {
    if (running) { pending = true; return running; }
    running = Promise.resolve().then(async () => {
      while (true) {
        pending = false;
        try {
          const data = await load();
          if (!pending) return data;
        } catch (error) {
          if (!pending) throw error;
        }
      }
    }).finally(() => { running = undefined; });
    return running;
  };
}
