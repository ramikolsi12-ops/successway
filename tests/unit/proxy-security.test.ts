import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const token = vi.hoisted(() => vi.fn());
vi.mock("next-auth/jwt", () => ({ getToken: token }));
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "s".repeat(48));
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "production");
  token.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("Protection HTTP avant les routes", () => {
  it("redirige les pages privées et renvoie 401 aux API anonymes", async () => {
    const page = await proxy(new NextRequest("http://localhost:3000/paiements"));
    expect(page.status).toBe(307); expect(page.headers.get("location")).toBe("http://localhost:3000/connexion");
    expect((await proxy(new NextRequest("http://localhost:3000/api/settings/centre"))).status).toBe(401);
  });
  it("rend seulement connexion, auth et logo public accessibles sans jeton", async () => {
    for (const path of ["/connexion", "/api/auth/csrf", "/api/centre/logo"]) {
      expect((await proxy(new NextRequest(`http://localhost:3000${path}`))).headers.get("x-middleware-next")).toBe("1");
    }
    expect(token).not.toHaveBeenCalled();
  });
  it("génère un nonce nouveau, écrase les en-têtes fournis et interdit eval en production", async () => {
    const first = await proxy(new NextRequest("http://localhost:3000/connexion", { headers: { "x-nonce": "choisi", "content-security-policy": "choisie" } }));
    const second = await proxy(new NextRequest("http://localhost:3000/connexion"));
    const policy = first.headers.get("content-security-policy")!;
    expect(policy).not.toBe(second.headers.get("content-security-policy"));
    expect(policy).not.toContain("choisi"); expect(policy).not.toContain("unsafe-eval");
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(policy).toContain(`'nonce-${first.headers.get("x-middleware-request-x-nonce")}'`);
    expect(first.headers.get("cache-control")).toContain("no-store");
  });
  it("conserve la vérification serveur après le filtre initial et choisit les cookies HTTPS", async () => {
    token.mockResolvedValue({ adminId: "id" });
    vi.stubEnv("NEXTAUTH_URL", "https://centre.example");
    expect((await proxy(new NextRequest("https://centre.example/paiements"))).headers.get("x-middleware-next")).toBe("1");
    expect(token).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
  });
  it("garde une politique stable en développement et autorise la connexion Fast Refresh du même serveur", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = await proxy(new NextRequest("http://localhost:3000/connexion", { headers: { "x-nonce": "impose-par-client" } }));
    const second = await proxy(new NextRequest("http://localhost:3000/connexion"));
    const policy = first.headers.get("content-security-policy")!;
    expect(policy).toBe(second.headers.get("content-security-policy"));
    expect(policy).toContain("connect-src 'self' ws://localhost:3000");
    expect(policy).not.toContain("nonce-");
    expect(first.headers.get("x-middleware-request-x-nonce")).toBeNull();
    expect(policy).toContain("'unsafe-eval'");
  });
});
