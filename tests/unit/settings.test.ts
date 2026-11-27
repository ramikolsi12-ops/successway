import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { centreSettingsSchema, openingHoursSchema } from "@/validations/settings";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ db: {} }));

import { getCentreBranding, getCentreLogo, getCentreSettings, maximumLogoBytes, normalizeCentreLogo } from "@/services/settings";

const fields = { name: "Centre Exemple", phone: "+216 20 123 456", address: "12 avenue de Tunis", email: null,
  openingMinute: 480, closingMinute: 1200, openingDays: [1, 2, 3, 4, 5, 6, 7] };
function reader(records: { key: string; value: unknown }[]) {
  return { appSetting: { findMany: vi.fn(async () => records), findUnique: vi.fn(async ({ where }: { where: { key: string } }) => records.find(record => record.key === where.key) ?? null) } } as unknown as NonNullable<Parameters<typeof getCentreSettings>[0]>;
}

describe("Paramètres du centre", () => {
  it("normalise les contacts et trie les jours sans accepter de champs supplémentaires", () => {
    expect(centreSettingsSchema.parse({ ...fields, name: "  Centre Exemple  ", email: "CONTACT@EXEMPLE.TN", openingDays: [7, 1] }))
      .toMatchObject({ name: "Centre Exemple", email: "contact@exemple.tn", openingDays: [1, 7] });
    expect(centreSettingsSchema.safeParse({ ...fields, logoUrl: "https://autre/image.svg" }).success).toBe(false);
    expect(centreSettingsSchema.safeParse({ ...fields, email: "invalide" }).success).toBe(false);
    expect(centreSettingsSchema.safeParse({ ...fields, phone: "123" }).success).toBe(false);
    expect(centreSettingsSchema.safeParse({ ...fields, address: " " }).success).toBe(false);
  });

  it.each([
    { openingMinute: 480, closingMinute: 480, openingDays: [1] },
    { openingMinute: 480, closingMinute: 450, openingDays: [1] },
    { openingMinute: 485, closingMinute: 1200, openingDays: [1] },
    { openingMinute: 480, closingMinute: 1441, openingDays: [1] },
    { openingMinute: 480, closingMinute: 1200, openingDays: [] },
    { openingMinute: 480, closingMinute: 1200, openingDays: [1, 1] },
    { openingMinute: 480, closingMinute: 1200, openingDays: [0, 8] },
  ])("refuse des horaires invalides %#", hours => {
    expect(openingHoursSchema.safeParse(hours).success).toBe(false);
  });

  it("préserve toute la journée et les sept jours tant que les horaires ne sont pas configurés", async () => {
    const settings = await getCentreSettings(reader([{ key: "centre", value: { name: "Mon centre", timezone: "Africa/Tunis" } }, { key: "operatingHours", value: { configured: false } }]));
    expect(settings).toEqual({ name: "Mon centre", phone: "", address: "", email: null, openingMinute: 0, closingMinute: 1440, openingDays: [1, 2, 3, 4, 5, 6, 7], logoUrl: null });
    expect(await getCentreBranding(reader([]))).toEqual({ name: "Centre Formation Manager", logoUrl: null });
  });

  it("signale une configuration enregistrée invalide sans masquer l’erreur", async () => {
    await expect(getCentreSettings(reader([{ key: "operatingHours", value: { configured: true, openingMinute: 1200, closingMinute: 480, openingDays: [1] } }]))).rejects.toThrow(/paramètres enregistrés/);
    await expect(getCentreSettings(reader([{ key: "centre", value: { name: "" } }]))).rejects.toThrow(/paramètres enregistrés/);
    await expect(getCentreSettings(reader([{ key: "centre", value: null }]))).rejects.toThrow(/paramètres enregistrés/);
  });
});

describe("Validation et normalisation du logo", () => {
  it.each(["png", "jpeg", "webp"] as const)("décode une vraie image %s et conserve uniquement une image WebP normalisée", async format => {
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#2456ac" } }).toFormat(format).toBuffer();
    const result = await normalizeCentreLogo(bytes);
    expect(result).toMatchObject({ mime: "image/webp", width: 8, height: 6 });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    const persistedReader = reader([{ key: "centre.logo", value: result }]);
    const loaded = await getCentreLogo(persistedReader);
    expect(loaded?.bytes).toEqual(Buffer.from(result.content, "base64"));
    expect((await getCentreSettings(persistedReader)).logoUrl).toBe(`/api/centre/logo?v=${result.hash}`);
    expect((await sharp(loaded!.bytes).metadata()).format).toBe("webp");
  });

  it.each([
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from("MZexecutable"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([255, 216, 255, 0]),
    Buffer.alloc(0),
  ])("refuse le contenu non image et les signatures trompeuses %#", async bytes => {
    await expect(normalizeCentreLogo(bytes)).rejects.toThrow();
  });

  it("refuse plus de 2 Mo et détecte la corruption d’une image enregistrée", async () => {
    await expect(normalizeCentreLogo(Buffer.alloc(maximumLogoBytes + 1))).rejects.toThrow(/2 Mo/);
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    const logo = await normalizeCentreLogo(bytes);
    await expect(getCentreLogo(reader([{ key: "centre.logo", value: { ...logo, hash: "0".repeat(64) } }]))).rejects.toThrow(/paramètres enregistrés/);
    expect(await getCentreLogo(reader([]))).toBeNull();
  });
});
