/**
 * Validation HTTP Node uniquement, destinée à une installation locale jetable.
 * PRODUCTION_TEST_URL pointe vers le port HTTP publié sur loopback ; NEXTAUTH_URL
 * est l’origine HTTPS canonique simulée par Host/Origin/X-Forwarded-*. Le jar
 * transmet volontairement les cookies Secure sur ce transport local : ce test
 * ne vérifie ni un vrai certificat TLS, ni le comportement d’un navigateur.
 * Le mot de passe de test arrive sur une seule ligne stdin, jamais dans argv/env.
 * Connexion et déconnexion modifient les audits et la version de session du compte
 * isolé ; aucune donnée métier, financière, configuration ou image n’est écrite.
 */
import http from "node:http";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readPassword() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    requireCondition(size <= 4096, "Le secret reçu sur stdin est trop volumineux.");
    chunks.push(bytes);
  }
  let value;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, ""); }
  catch { throw new Error("Le secret stdin doit être une ligne UTF-8 valide."); }
  requireCondition(value.length >= 12 && value.length <= 256 && !/[\0\r\n]/.test(value), "Fournissez un seul mot de passe de test de 12 à 256 caractères sur stdin.");
  return value;
}

function receiveCookies(headers, jar) {
  for (const line of headers["set-cookie"] ?? []) {
    const [pair, ...parts] = line.split(";");
    const equals = pair.indexOf("=");
    if (equals < 1) continue;
    const name = pair.slice(0, equals), value = pair.slice(equals + 1);
    const attributes = new Map(parts.map(part => {
      const [key, ...rest] = part.trim().split("=");
      return [key.toLowerCase(), rest.join("=")];
    }));
    if (attributes.get("max-age") === "0" || (attributes.has("expires") && Date.parse(attributes.get("expires")) <= Date.now())) jar.delete(name);
    else jar.set(name, { value, attributes });
  }
}

function json(response, context) {
  try { return JSON.parse(response.body.toString("utf8")); }
  catch { throw new Error(`Réponse JSON invalide : ${context}.`); }
}

async function validate() {
  requireCondition(process.argv.length === 2, "Aucun argument n’est accepté. Le mot de passe doit être fourni sur stdin.");
  let target, canonical;
  try {
    target = new URL(process.env.PRODUCTION_TEST_URL ?? "http://127.0.0.1:3116");
    canonical = new URL(process.env.NEXTAUTH_URL ?? "");
  } catch { throw new Error("Configurez PRODUCTION_TEST_URL et NEXTAUTH_URL avec des origines valides."); }
  requireCondition(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    && target.pathname === "/" && !target.username && !target.password && !target.search && !target.hash,
  "PRODUCTION_TEST_URL doit être une origine HTTP locale sur loopback pour une installation jetable.");
  requireCondition(canonical.protocol === "https:" && canonical.pathname === "/" && !canonical.username && !canonical.password && !canonical.search && !canonical.hash,
    "NEXTAUTH_URL doit être l’origine HTTPS canonique, sans chemin ni identifiants.");
  const identifier = process.env.ADMIN_IDENTIFIER;
  requireCondition(typeof identifier === "string" && identifier.trim().length >= 3, "ADMIN_IDENTIFIER doit désigner le compte de test isolé.");
  let password = await readPassword();
  const jar = new Map();
  let checks = 0;
  let authenticated = false;

  function request(path, { method = "GET", body, origin = canonical.origin, cookies = jar } = {}) {
    requireCondition(path.startsWith("/") && !path.startsWith("//"), "Le chemin de validation doit rester local.");
    const destination = new URL(path, target);
    requireCondition(destination.origin === target.origin, "La validation ne peut pas contacter une autre origine.");
    const payload = body instanceof URLSearchParams ? body.toString() : body;
    const headers = { Host: canonical.host, Origin: origin, "X-Forwarded-Host": canonical.host,
      "X-Forwarded-Proto": "https", Accept: "application/json" };
    if (cookies.size) headers.Cookie = [...cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join("; ");
    if (payload !== undefined) {
      headers["Content-Type"] = body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    return new Promise((resolve, reject) => {
      const outgoing = http.request(destination, { method, headers }, response => {
        const chunks = [];
        let size = 0;
        response.on("data", chunk => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024 + 65536) outgoing.destroy();
          else chunks.push(chunk);
        });
        response.on("end", () => {
          receiveCookies(response.headers, cookies);
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
        });
        response.on("error", () => reject(new Error("La réponse HTTP de validation a été interrompue.")));
      });
      outgoing.setTimeout(15000, () => outgoing.destroy());
      outgoing.on("error", () => reject(new Error("La requête HTTP de validation a échoué ou a dépassé son délai.")));
      outgoing.end(payload);
    });
  }

  async function csrf() {
    const response = await request("/api/auth/csrf");
    requireCondition(response.status === 200, "Le jeton CSRF NextAuth n’est pas accessible.");
    const token = json(response, "jeton CSRF").csrfToken;
    requireCondition(typeof token === "string" && token.length > 0, "Le jeton CSRF NextAuth est absent.");
    return token;
  }

  async function logout() {
    const response = await request("/api/auth/signout", { method: "POST", body: new URLSearchParams({ csrfToken: await csrf(), callbackUrl: `${canonical.origin}/connexion`, json: "true" }) });
    requireCondition(response.status === 200, "La déconnexion NextAuth a échoué.");
    authenticated = false;
  }

  try {
    const health = await request("/api/health");
    requireCondition(health.status === 200 && json(health, "santé").status === "ok", "Le contrôle de santé public n’est pas prêt."); checks++;
    requireCondition((await request("/api/settings/centre")).status === 401, "Une API privée est accessible sans connexion."); checks++;

    const login = await request("/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({
      identifier, password, csrfToken: await csrf(), callbackUrl: `${canonical.origin}/tableau-de-bord`, json: "true",
    }) });
    password = "";
    authenticated = [...jar.keys()].some(name => name.includes("next-auth.session-token"));
    requireCondition(login.status === 200 && typeof json(login, "connexion").url === "string", "La connexion du compte de test a échoué.");
    const sessionCookies = [...jar.keys()].filter(name => /^__Secure-next-auth\.session-token(?:\.\d+)?$/.test(name));
    requireCondition(sessionCookies.length > 0, "La connexion n’a créé aucun cookie de session sécurisé.");
    authenticated = true; checks++;
    const authenticationCookies = [...jar].filter(([name]) => name.includes("next-auth."));
    requireCondition(authenticationCookies.length > 0 && authenticationCookies.every(([, cookie]) => cookie.attributes.has("secure")
      && cookie.attributes.has("httponly") && cookie.attributes.get("samesite")?.toLowerCase() === "lax"),
    "Les cookies d’authentification n’ont pas tous les attributs Secure, HttpOnly et SameSite=Lax.");
    requireCondition(jar.has("__Host-next-auth.csrf-token") && jar.get("__Host-next-auth.csrf-token").attributes.get("path") === "/"
      && !jar.get("__Host-next-auth.csrf-token").attributes.has("domain"), "Le cookie CSRF ne respecte pas son préfixe sécurisé __Host-."); checks++;

    const session = await request("/api/auth/session");
    const user = session.status === 200 ? json(session, "session").user : null;
    requireCondition(typeof user?.id === "string" && user.id.length > 0 && Number.isSafeInteger(user.sessionVersion), "La session administrateur authentifiée est absente."); checks++;
    const settings = await request("/api/settings/centre");
    requireCondition(settings.status === 200 && typeof json(settings, "paramètres").name === "string", "L’accès authentifié aux paramètres a échoué."); checks++;
    const professors = await request("/api/professors");
    requireCondition(professors.status === 200 && Array.isArray(json(professors, "professeurs")), "L’accès authentifié aux professeurs a échoué."); checks++;
    const rejected = await request("/api/settings/centre", { method: "PATCH", body: "{}", origin: "https://origine-invalide.example" });
    requireCondition(rejected.status === 403, "Une mutation provenant d’une autre origine n’a pas été refusée avec 403."); checks++;

    const logoUrl = json(settings, "paramètres").logoUrl;
    const logo = await request(logoUrl ?? "/api/centre/logo", { cookies: new Map() });
    requireCondition(logoUrl ? logo.status === 200 && logo.headers["content-type"] === "image/webp" && logo.headers["x-content-type-options"] === "nosniff"
      : logo.status === 404, "Le logo public ne correspond pas aux paramètres du centre."); checks++;

    const copiedCookies = new Map(jar);
    await logout();
    requireCondition(![...jar.keys()].some(name => name.includes("next-auth.session-token")), "Le cookie de session n’a pas été supprimé à la déconnexion.");
    requireCondition((await request("/api/settings/centre", { cookies: copiedCookies })).status === 401, "Une copie du cookie reste autorisée après la déconnexion."); checks++;
    console.log(`Validation HTTP de production réussie : ${checks} contrôles. Aucun navigateur utilisé.`);
  } finally {
    password = "";
    if (authenticated) await logout().catch(() => { console.error("La session de test doit être fermée manuellement après cet échec."); });
  }
}

validate().catch(error => {
  console.error(error instanceof Error ? `Validation HTTP refusée : ${error.message}` : "La validation HTTP a échoué.");
  process.exitCode = 1;
});
