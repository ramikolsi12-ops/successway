import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/server/auth-options", () => ({ authOptions: {} }));
vi.mock("@/server/db", () => ({ db: { adminUser: { findUnique: mocks.admin } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { currentAdministrator, requireAdministrator } from "@/server/authorization";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "admin-id", sessionVersion: 3 } });
  mocks.admin.mockResolvedValue({ id: "admin-id", identifier: "admin", displayName: "Administrateur", active: true, sessionVersion: 3 });
});

describe("Autorisation administrateur côté serveur", () => {
  it("refuse une session absente sans consulter la base", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await currentAdministrator()).toBeNull(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("refuse les comptes désactivés et les copies de sessions révoquées", async () => {
    mocks.admin.mockResolvedValueOnce({ active: false, sessionVersion: 3 }).mockResolvedValueOnce({ active: true, sessionVersion: 4 });
    expect(await currentAdministrator()).toBeNull(); expect(await currentAdministrator()).toBeNull();
  });
  it("retourne seulement l’administrateur correspondant à la version courante", async () => {
    expect((await currentAdministrator())?.identifier).toBe("admin");
    expect(mocks.admin.mock.calls[0][0].select.passwordHash).toBeUndefined();
  });
  it("redirige les pages privées quand la session n’est plus valide", async () => {
    mocks.session.mockResolvedValue(null);
    await requireAdministrator(); expect(mocks.redirect).toHaveBeenCalledWith("/connexion");
  });
});
