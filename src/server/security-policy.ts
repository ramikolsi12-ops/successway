export function contentSecurityPolicy(nonce: string, development: boolean, applicationUrl?: string) {
  const connections = ["'self'"];
  if (development && applicationUrl) {
    const socket = new URL(applicationUrl);
    socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
    connections.push(socket.origin);
  }
  return [
    "default-src 'self'",
    // Fast Refresh replaces scripts in an existing document. Keep its dev policy
    // stable across requests; production retains per-response script nonces.
    development ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Ant Design generates style attributes and stylesheets at runtime.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", `connect-src ${connections.join(" ")}`,
    "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
}
