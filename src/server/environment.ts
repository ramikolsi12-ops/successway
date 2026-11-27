type Environment = Record<string, string | undefined>;

/** Validation messages deliberately omit environment values and credentials. */
export function authenticationEnvironment(env: Environment = process.env) {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32 || secret === "GENERATE_AT_LEAST_32_RANDOM_BYTES") {
    throw new Error("NEXTAUTH_SECRET doit contenir un secret aléatoire d’au moins 32 caractères.");
  }
  let url: URL;
  try { url = new URL(env.NEXTAUTH_URL ?? ""); } catch { throw new Error("NEXTAUTH_URL doit contenir l’adresse complète de l’application."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("NEXTAUTH_URL doit être une origine HTTP ou HTTPS sans identifiants ni chemin.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
    throw new Error("L’adresse de production doit utiliser HTTPS ; HTTP est réservé à l’exécution locale.");
  }
  return { secret, url, secureCookies: url.protocol === "https:" };
}

export function databaseUrl(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("DATABASE_URL doit contenir une connexion PostgreSQL valide."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
    throw new Error("DATABASE_URL doit contenir une connexion PostgreSQL valide.");
  }
  return value!;
}
