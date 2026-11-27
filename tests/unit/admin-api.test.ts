import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessError } from "@/lib/business-error";
import { createClassroomSchema } from "@/validations/management";

const mocks = vi.hoisted(() => ({ administrator: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/authorization", () => ({ currentAdministrator: mocks.administrator }));
import { adminApi, readInput, readRequestBytes } from "@/server/api";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  mocks.administrator.mockResolvedValue({ id: "administrator" });
});
afterEach(() => vi.unstubAllEnvs());

const request = (origin: string | null = "http://localhost:3000", body = { name: "Salle 7" }) => new Request("http://127.0.0.1:3000/api/classrooms", {
  method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});

describe("Protection des API de gestion", () => {
  it("refuse une requête anonyme avant toute opération", async () => {
    mocks.administrator.mockResolvedValue(null);
    const operation = vi.fn();
    expect((await adminApi(request(), operation)).status).toBe(401);
    expect(operation).not.toHaveBeenCalled();
  });
  it("refuse une mutation provenant d’un autre site", async () => {
    const operation = vi.fn();
    expect((await adminApi(request("https://autre.example"), operation)).status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
  });
  it("refuse une mutation sans origine", async () => { expect((await adminApi(request(null), vi.fn())).status).toBe(403); });
  it("accepte l’origine canonique même si Next.js utilise son adresse d’écoute interne", async () => {
    const response = await adminApi(request(), async admin => ({ id: admin.id }), 201);
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: "administrator" });
  });
  it("renvoie une validation française sans enregistrer de données invalides", async () => {
    const save = vi.fn();
    const input = request("http://localhost:3000", { name: "" });
    const response = await adminApi(input, async () => { const data = await readInput(input, createClassroomSchema); return save(data); });
    expect(response.status).toBe(400); expect((await response.json()).message).toContain("nom"); expect(save).not.toHaveBeenCalled();
  });
  it("transmet les séances bloquantes dans une réponse de conflit", async () => {
    const response = await adminApi(request(), async () => { throw new BusinessError("Séances à réaffecter", 409, { sessions: [{ id: "s1" }] }); });
    expect(response.status).toBe(409); expect((await response.json()).details.sessions).toHaveLength(1);
  });
  it("borne le flux réel même si la longueur déclarée est absente ou fausse", async () => {
    const data = request("http://localhost:3000", { name: "x".repeat(65536) });
    data.headers.set("content-length", "10");
    const response = await adminApi(data, async () => readInput(data, createClassroomSchema));
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(readRequestBytes(new Request("http://localhost", { method: "POST", body: "123456" }), 5)).rejects.toMatchObject({ status: 413 });
  });
  it("refuse les formats non JSON et les flux JSON invalides", async () => {
    const text = new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost:3000" }, body: "nom=texte" });
    expect((await adminApi(text, async () => readInput(text, createClassroomSchema))).status).toBe(415);
    const invalid = new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{" });
    expect((await adminApi(invalid, async () => readInput(invalid, createClassroomSchema))).status).toBe(400);
  });
  it("masque les détails techniques et interdit le cache des erreurs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await adminApi(request(), async () => { throw new Error("postgresql://user:secret@localhost/base path/internal"); });
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toMatch(/secret|postgresql|internal/);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally { log.mockRestore(); }
  });
});
