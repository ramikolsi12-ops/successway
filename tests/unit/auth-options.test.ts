import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRequire } from "node:module";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/authentication", () => ({ authenticateAdministrator: mocks.authenticate }));
vi.mock("@/services/account-security", () => ({ invalidateAdministratorSession: mocks.invalidate }));
vi.mock("@/server/environment", () => ({ authenticationEnvironment: () => ({
  secret: "unit-auth-secret-with-at-least-thirty-two-characters", secureCookies: false,
}) }));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

const origin = "http://localhost:3000";
// NextAuth reads these APIs through CommonJS require. Bind that module to each
// synthetic request while retaining its real CSRF and credentials handlers.
const requestApi = createRequire(import.meta.url)("next/headers") as typeof import("next/headers");
function bindRequest(request: NextRequest) {
  vi.spyOn(requestApi, "cookies").mockResolvedValue(request.cookies as unknown as Awaited<ReturnType<typeof requestApi.cookies>>);
  vi.spyOn(requestApi, "headers").mockResolvedValue(request.headers);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "unit-auth-secret-with-at-least-thirty-two-characters");
  vi.stubEnv("NEXTAUTH_URL", origin);
  mocks.authenticate.mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function credentialsCallback() {
  const csrfRequest = new NextRequest(`${origin}/api/auth/csrf`);
  bindRequest(csrfRequest);
  const csrf = await GET(csrfRequest, { params: Promise.resolve({ nextauth: ["csrf"] }) });
  const { csrfToken } = await csrf.json();
  const cookie = csrf.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const request = new NextRequest(`${origin}/api/auth/callback/credentials`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, cookie },
    body: new URLSearchParams({ identifier: "administrateur", password: "mot-de-passe-de-test", csrfToken,
      callbackUrl: `${origin}/tableau-de-bord`, json: "true" }),
  });
  bindRequest(request);
  return POST(request, { params: Promise.resolve({ nextauth: ["callback", "credentials"] }) });
}

describe("Erreurs publiques du fournisseur de connexion", () => {
  it("ne divulgue pas une erreur Prisma dans la réponse réelle du callback NextAuth", async () => {
    const sentinel = "DATABASE-PRIVATE: postgresql://admin:secret-prive@db/centre; SELECT passwordHash FROM AdminUser";
    const failure = new Error(sentinel);
    failure.name = "PrismaClientKnownRequestError";
    mocks.authenticate.mockRejectedValue(failure);
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await credentialsCallback();
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(new URL(body.url).searchParams.get("error")).toBe("Le service de connexion est temporairement indisponible.");
    expect(JSON.stringify(body)).not.toContain("DATABASE-PRIVATE");
    expect(decodeURIComponent(JSON.stringify(body))).not.toContain("secret-prive");
    expect(diagnostic).toHaveBeenCalledWith("La vérification de connexion a échoué.", "PrismaClientKnownRequestError");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(sentinel);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });

  it("conserve le refus normal des identifiants incorrects ou limités sans erreur opérationnelle", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await credentialsCallback();
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(new URL(body.url).searchParams.get("error")).toBe("CredentialsSignin");
    expect(diagnostic).not.toHaveBeenCalled();
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });

  it("préserve la session et la destination d’une connexion réussie", async () => {
    mocks.authenticate.mockResolvedValue({ id: "admin-test", name: "Administrateur", sessionVersion: 3 });
    const response = await credentialsCallback();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${origin}/tableau-de-bord` });
    expect(response.headers.getSetCookie().some(cookie => cookie.startsWith("next-auth.session-token="))).toBe(true);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });
});
