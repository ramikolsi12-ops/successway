import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ default: () => auth }));
vi.mock("@/server/auth-options", () => ({ authOptions: {} }));
import { POST } from "@/app/api/auth/[...nextauth]/route";

const context = { params: Promise.resolve({ nextauth: ["callback", "credentials"] }) };
const request = (body: string, type = "application/x-www-form-urlencoded") => new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
  method: "POST", headers: { "content-type": type, cookie: "csrf=valeur", origin: "http://localhost:3000" }, body,
});
beforeEach(() => { auth.mockReset().mockResolvedValue(new Response(null, { status: 204 })); });

describe("Limite des requêtes publiques d’authentification", () => {
  it("borne le corps avant NextAuth même sans Content-Length", async () => {
    expect((await POST(request("x".repeat(16385)), context)).status).toBe(413);
    expect(auth).not.toHaveBeenCalled();
  });
  it("conserve le contenu, cookies et contexte nécessaires au contrôle CSRF de NextAuth", async () => {
    const body = "identifier=admin&password=mot-de-passe&csrfToken=nonce&json=true";
    expect((await POST(request(body), context)).status).toBe(204);
    const [forwarded, forwardedContext] = auth.mock.calls[0];
    expect(forwarded).toBeInstanceOf(NextRequest);
    expect(await forwarded.text()).toBe(body);
    expect(forwarded.headers.get("cookie")).toBe("csrf=valeur");
    expect(forwardedContext).toBe(context);
  });
  it("refuse les formats et JSON invalides sans transmettre de données", async () => {
    expect((await POST(request("{", "application/json"), context)).status).toBe(400);
    expect((await POST(request("texte", "text/plain"), context)).status).toBe(415);
    expect(auth).not.toHaveBeenCalled();
  });
});
