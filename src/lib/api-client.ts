export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) { super(message); }
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({ message: "La réponse du serveur est invalide." }));
  if (!response.ok) {
    throw new ApiError(body.message ?? "L’opération a échoué.", response.status, body.details);
  }
  return body as T;
}
