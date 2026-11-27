import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ administrator: vi.fn(), settings: vi.fn(), update: vi.fn(), setLogo: vi.fn(), removeLogo: vi.fn(), logo: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/authorization", () => ({ currentAdministrator: mocks.administrator }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/services/settings", () => ({ getCentreSettings: mocks.settings, updateCentreSettings: mocks.update,
  setCentreLogo: mocks.setLogo, removeCentreLogo: mocks.removeLogo, getCentreLogo: mocks.logo, maximumLogoBytes: 2 * 1024 * 1024 }));

import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/centre/route";
import { POST as postLogo, DELETE as deleteLogo } from "@/app/api/settings/logo/route";
import { GET as publicLogo } from "@/app/api/centre/logo/route";

const fields = { name: "Centre test", phone: "20123456", address: "12 avenue de Tunis", email: null,
  openingMinute: 480, closingMinute: 1200, openingDays: [1, 2, 3, 4, 5, 6, 7] };
const request = (path: string, method: string, body?: BodyInit, origin: string | null = "http://localhost:3000", headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:3000${path}`, { method, body, headers: { ...(origin ? { origin } : {}), ...headers } });

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  mocks.administrator.mockResolvedValue({ id: "administrator" });
  mocks.settings.mockResolvedValue({ ...fields, logoUrl: null });
  mocks.update.mockResolvedValue({ ...fields, logoUrl: null });
  mocks.setLogo.mockResolvedValue({ ...fields, logoUrl: "/api/centre/logo?v=hash" });
  mocks.removeLogo.mockResolvedValue({ ...fields, logoUrl: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("API des paramètres et du logo", () => {
  it("protège lecture privée, mise à jour, import et suppression contre les requêtes anonymes", async () => {
    mocks.administrator.mockResolvedValue(null);
    expect((await getSettings(request("/api/settings/centre", "GET"))).status).toBe(401);
    expect((await patchSettings(request("/api/settings/centre", "PATCH", JSON.stringify(fields)))).status).toBe(401);
    expect((await postLogo(request("/api/settings/logo", "POST", "image"))).status).toBe(401);
    expect((await deleteLogo(request("/api/settings/logo", "DELETE"))).status).toBe(401);
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.setLogo).not.toHaveBeenCalled(); expect(mocks.removeLogo).not.toHaveBeenCalled();
  });

  it.each([null, "https://autre.example"])("refuse toutes les mutations avec l’origine %s", async origin => {
    expect((await patchSettings(request("/api/settings/centre", "PATCH", JSON.stringify(fields), origin))).status).toBe(403);
    expect((await postLogo(request("/api/settings/logo", "POST", "image", origin))).status).toBe(403);
    expect((await deleteLogo(request("/api/settings/logo", "DELETE", undefined, origin))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.setLogo).not.toHaveBeenCalled(); expect(mocks.removeLogo).not.toHaveBeenCalled();
  });

  it("refuse les champs inattendus et invalide les vues après une mise à jour valide", async () => {
    const invalid = await patchSettings(request("/api/settings/centre", "PATCH", JSON.stringify({ ...fields, logoUrl: "https://autre.example" }), undefined, { "content-type": "application/json" }));
    expect(invalid.status).toBe(400); expect(mocks.update).not.toHaveBeenCalled();
    const response = await patchSettings(request("/api/settings/centre", "PATCH", JSON.stringify(fields), undefined, { "content-type": "application/json" }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(fields, { id: "administrator" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it.each<Record<string, string>>([{}, { "content-length": "2" }])("borne les octets réellement importés même sans longueur fiable %#", async headers => {
    const response = await postLogo(request("/api/settings/logo", "POST", new Uint8Array(2 * 1024 * 1024 + 1), undefined, headers));
    expect(response.status).toBe(413); expect(mocks.setLogo).not.toHaveBeenCalled();
  });

  it("transmet seulement le contenu binaire borné au validateur du logo", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const response = await postLogo(request("/api/settings/logo", "POST", bytes, undefined, { "content-type": "image/png" }));
    expect(response.status).toBe(200);
    expect(mocks.setLogo).toHaveBeenCalledWith(Buffer.from(bytes), { id: "administrator" });
  });

  it("rend uniquement l’image normalisée publique pour la page de connexion", async () => {
    mocks.administrator.mockResolvedValue(null);
    mocks.logo.mockResolvedValue({ bytes: Buffer.from("webp"), mime: "image/webp", hash: "abc" });
    const response = await publicLogo();
    expect(response.status).toBe(200); expect(await response.text()).toBe("webp");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.administrator).not.toHaveBeenCalled();
    mocks.logo.mockResolvedValue(null);
    expect((await publicLogo()).status).toBe(404);
  });
});
