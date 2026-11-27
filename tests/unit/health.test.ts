import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("@/server/db", () => ({ db: { $transaction: mocks.transaction } }));
import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([{ ready: true }]);
  mocks.transaction.mockImplementation(async operation => operation({ $queryRaw: mocks.query }));
});

describe("Contrôle de santé public minimal", () => {
  it("vérifie réellement la base, les migrations et le fuseau sans exposer de détails", async () => {
    const response = await GET();
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const sql = mocks.query.mock.calls[1][0].join("");
    expect(sql).toContain("_prisma_migrations"); expect(sql).toContain("Africa/Tunis"); expect(sql).toContain("to_regclass");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000, maxWait: 3000 });
  });

  it("renvoie 503 si les migrations, le schéma ou le fuseau ne sont pas prêts", async () => {
    mocks.query.mockResolvedValue([{ ready: false }]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "indisponible", message: "Le service est temporairement indisponible." });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("masque les erreurs de connexion et ne les imprime pas", async () => {
    mocks.transaction.mockRejectedValue(new Error("postgresql://secret@serveur/base /chemin/interne"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toMatch(/secret|postgresql|interne/);
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
