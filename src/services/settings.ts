import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import { z } from "@/validations/locale";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/business-error";
import { defaultOpeningHours } from "@/lib/opening-hours";
import { centreSettingsSchema, openingHoursSchema } from "@/validations/settings";
import { audit, type Actor, type Transaction } from "@/services/management-shared";
import { assertOpeningHoursCompatible } from "@/services/opening-hours";
import type { CentreBranding, CentreSettings } from "@/types/settings";

type SettingsReader = Pick<Transaction, "appSetting">;
const logoKey = "centre.logo";
export const maximumLogoBytes = 2 * 1024 * 1024;
const logoRecordSchema = z.object({ content: z.string(), mime: z.literal("image/webp"), hash: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(), size: z.number().int().positive().max(maximumLogoBytes) });
const centreRecordSchema = z.object({ name: z.string().trim().min(1).max(150), phone: z.string().max(30).optional(), address: z.string().max(1000).optional(),
  email: z.string().email().nullable().optional() });

function configurationError(): never { throw new BusinessError("Les paramètres enregistrés du centre sont invalides. Vérifiez leur configuration avant de continuer.", 500); }

export async function getCentreSettings(reader: SettingsReader = db): Promise<CentreSettings> {
  const records = await reader.appSetting.findMany({ where: { key: { in: ["centre", "operatingHours", logoKey] } } });
  const centreValue = records.find(record => record.key === "centre")?.value;
  const centre = centreRecordSchema.safeParse(centreValue === undefined ? { name: "Centre Formation Manager" } : centreValue);
  if (!centre.success) configurationError();
  const information = centre.data;
  const hoursValue = records.find(record => record.key === "operatingHours")?.value;
  let hours = defaultOpeningHours;
  if (hoursValue !== undefined) {
    if (!hoursValue || typeof hoursValue !== "object" || Array.isArray(hoursValue)) configurationError();
    const configured = hoursValue as Record<string, unknown>;
    if (configured.configured !== false) {
      const parsed = openingHoursSchema.safeParse({ openingMinute: configured.openingMinute, closingMinute: configured.closingMinute, openingDays: configured.openingDays });
      if (!parsed.success) configurationError();
      hours = { openingMinute: parsed.data.openingMinute, closingMinute: parsed.data.closingMinute, openingDays: parsed.data.openingDays };
    }
  }
  const savedLogo = records.find(record => record.key === logoKey)?.value;
  const logo = savedLogo === undefined || savedLogo === null ? null : logoRecordSchema.safeParse(savedLogo);
  if (logo && !logo.success) configurationError();
  return { name: information.name, phone: information.phone ?? "", address: information.address ?? "", email: information.email ?? null,
    ...hours, openingDays: [...hours.openingDays], logoUrl: logo?.success ? `/api/centre/logo?v=${logo.data.hash}` : null };
}

export const getCentreBranding = cache(async (reader: SettingsReader = db): Promise<CentreBranding> => {
  const { name, logoUrl } = await getCentreSettings(reader);
  return { name, logoUrl };
});

export async function updateCentreSettings(input: unknown, actor: Actor): Promise<CentreSettings> {
  const data = centreSettingsSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    const before = await getCentreSettings(tx);
    await assertOpeningHoursCompatible(tx, data);
    const original = await tx.appSetting.findUnique({ where: { key: "centre" } });
    const metadata = original?.value && typeof original.value === "object" && !Array.isArray(original.value) ? original.value : {};
    const { name, phone, address, email, openingMinute, closingMinute, openingDays } = data;
    const centre = { ...metadata, name, phone, address, email };
    const hours = { configured: true, openingMinute, closingMinute, openingDays };
    await tx.appSetting.upsert({ where: { key: "centre" }, create: { key: "centre", value: centre }, update: { value: centre } });
    await tx.appSetting.upsert({ where: { key: "operatingHours" }, create: { key: "operatingHours", value: hours }, update: { value: hours } });
    const { logoUrl: previousLogoUrl, ...previousSettings } = before;
    void previousLogoUrl;
    await audit(tx, actor, "MODIFICATION_PARAMETRES_CENTRE", "AppSetting", "centre", previousSettings, data);
    return getCentreSettings(tx);
  }, { timeout: 20000, maxWait: 15000 });
}

function imageSignature(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function normalizeCentreLogo(bytes: Buffer) {
  if (!bytes.length || bytes.length > maximumLogoBytes) throw new BusinessError("Le logo doit être une image de 2 Mo maximum.");
  const signature = imageSignature(bytes);
  if (!signature) throw new BusinessError("Choisissez une image PNG, JPEG ou WebP valide.");
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning", animated: true });
    const metadata = await image.metadata();
    if (metadata.format !== signature || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("Image invalide");
    const output = await image.rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (!output.data.length || output.data.length > maximumLogoBytes) throw new Error("Image trop grande");
    return { content: output.data.toString("base64"), mime: "image/webp" as const, hash: createHash("sha256").update(output.data).digest("hex"),
      width: output.info.width, height: output.info.height, size: output.data.length };
  } catch { throw new BusinessError("Cette image est invalide, animée ou trop volumineuse. Choisissez un autre logo PNG, JPEG ou WebP."); }
}

export async function setCentreLogo(bytes: Buffer, actor: Actor): Promise<CentreSettings> {
  const logo = await normalizeCentreLogo(bytes);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    const before = await getCentreSettings(tx);
    await tx.appSetting.upsert({ where: { key: logoKey }, create: { key: logoKey, value: logo }, update: { value: logo } });
    await audit(tx, actor, "MODIFICATION_LOGO_CENTRE", "AppSetting", logoKey, { logoUrl: before.logoUrl },
      { mime: logo.mime, hash: logo.hash, width: logo.width, height: logo.height, size: logo.size });
    return getCentreSettings(tx);
  }, { timeout: 20000, maxWait: 15000 });
}

export async function removeCentreLogo(actor: Actor): Promise<CentreSettings> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    const before = await getCentreSettings(tx);
    await tx.appSetting.upsert({ where: { key: logoKey }, create: { key: logoKey, value: Prisma.JsonNull }, update: { value: Prisma.JsonNull } });
    await audit(tx, actor, "SUPPRESSION_LOGO_CENTRE", "AppSetting", logoKey, { logoUrl: before.logoUrl }, { logoUrl: null });
    return getCentreSettings(tx);
  }, { timeout: 20000, maxWait: 15000 });
}

export async function getCentreLogo(reader: SettingsReader = db) {
  const record = await reader.appSetting.findUnique({ where: { key: logoKey } });
  if (!record || record.value === null) return null;
  const logo = logoRecordSchema.safeParse(record.value);
  if (!logo.success) configurationError();
  const bytes = Buffer.from(logo.data.content, "base64");
  if (bytes.length !== logo.data.size || createHash("sha256").update(bytes).digest("hex") !== logo.data.hash) configurationError();
  return { bytes, mime: logo.data.mime, hash: logo.data.hash };
}
