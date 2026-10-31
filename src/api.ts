/** JSON requests to the mail service. Writes carry the session's CSRF token. */
export async function request<T>(url: string, options: { method?: string; csrf?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "The request failed. Try again.");
  return data as T;
}
