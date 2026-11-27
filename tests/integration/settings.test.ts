import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { Prisma } from "@/generated/prisma/client";
import { testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));

import { db as serviceDatabase } from "@/server/db";
import { getCentreLogo, getCentreSettings, removeCentreLogo, setCentreLogo, updateCentreSettings } from "@/services/settings";
import { addDays, atTunis, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";

const database = testDatabase();
let actor: { id: string };
let original: Awaited<ReturnType<typeof database.appSetting.findMany>> = [];
const keys = ["centre", "operatingHours", "centre.logo"];
const settings = { name: "Centre test", phone: "20123456", address: "12 avenue de Tunis", email: "contact@exemple.tn", openingMinute: 0, closingMinute: 1440, openingDays: [1, 2, 3, 4, 5, 6, 7] };

beforeAll(async () => { actor = { id: (await database.adminUser.findFirstOrThrow()).id }; });
beforeEach(async () => { original = await database.appSetting.findMany({ where: { key: { in: keys } } }); });
afterEach(async () => {
  for (const key of keys) {
    const saved = original.find(record => record.key === key);
    if (saved) await database.appSetting.upsert({ where: { key }, create: { key, value: saved.value === null ? Prisma.JsonNull : saved.value }, update: { value: saved.value === null ? Prisma.JsonNull : saved.value } });
    else await database.appSetting.deleteMany({ where: { key } });
  }
});
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

describe("Paramètres persistants PostgreSQL", () => {
  it("enregistre informations et horaires sans modifier les métadonnées fixes ni les autres paramètres", async () => {
    const initialCentre = await database.appSetting.findUniqueOrThrow({ where: { key: "centre" } });
    const before = await database.appSetting.findMany({ where: { key: { notIn: keys } }, orderBy: { key: "asc" } });
    const next = { ...settings, name: "Centre modifié", phone: "21123456", address: "34 avenue de Tunis" };
    expect(await updateCentreSettings(next, actor)).toMatchObject(next);
    expect(await getCentreSettings(database)).toMatchObject(next);
    const persistedCentre = await database.appSetting.findUniqueOrThrow({ where: { key: "centre" } });
    expect(persistedCentre.value).toMatchObject({ ...(initialCentre.value as object), ...{ name: next.name, phone: next.phone, address: next.address, email: next.email } });
    expect(await database.appSetting.findMany({ where: { key: { notIn: keys } }, orderBy: { key: "asc" } })).toEqual(before);
    expect(await database.auditLog.findFirst({ where: { action: "MODIFICATION_PARAMETRES_CENTRE", adminId: actor.id }, orderBy: { createdAt: "desc" } })).not.toBeNull();
  });

  it("refuse une réduction incompatible sans changer les réservations ni les paramètres", async () => {
    await updateCentreSettings(settings, actor);
    const suffix = randomUUID().slice(0, 8);
    const teacher = await database.teacher.create({ data: { firstName: "Horaires", lastName: suffix, phone: "20000000" } });
    const room = await database.classroom.create({ data: { name: `Horaires ${suffix}` } });
    const date = addDays(weekMonday(tunisDate().format("YYYY-MM-DD")), 14);
    const session = await database.teachingSession.create({ data: { teacherId: teacher.id, classroomId: room.id, startAt: atTunis(date, "07:00"), endAt: atTunis(date, "09:00") } });
    const before = await getCentreSettings(database);
    await expect(updateCentreSettings({ ...settings, openingMinute: 480 }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await getCentreSettings(database)).toEqual(before);
    expect(await database.teachingSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    // Leave no active future booking that would affect another settings test.
    await database.teachingSession.update({ where: { id: session.id }, data: { status: "ANNULEE", cancelledAt: new Date() } });
  });

  it("conserve le logo entre lecteurs, permet remplacement et suppression sans recopier ses octets dans l’audit", async () => {
    const first = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2256d8" } }).png().toBuffer();
    const second = await sharp({ create: { width: 9, height: 6, channels: 3, background: "#22884b" } }).jpeg().toBuffer();
    const saved = await setCentreLogo(first, actor);
    expect((await getCentreSettings(database)).logoUrl).toBe(saved.logoUrl);
    const persisted = await getCentreLogo(database);
    expect(persisted?.mime).toBe("image/webp");
    const replacement = await setCentreLogo(second, actor);
    expect(replacement.logoUrl).not.toBe(saved.logoUrl);
    expect((await getCentreLogo(database))?.bytes).not.toEqual(persisted?.bytes);
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "MODIFICATION_LOGO_CENTRE", entityId: "centre.logo" }, orderBy: { createdAt: "desc" } });
    expect(audit.after).not.toHaveProperty("content");
    expect(JSON.stringify(audit.after).length).toBeLessThan(500);
    expect((await removeCentreLogo(actor)).logoUrl).toBeNull();
    expect(await getCentreLogo(database)).toBeNull();
  });

  it("relit les réservations après le verrou partagé lorsqu’une réservation arrive en même temps qu’un changement d’horaires", async () => {
    await updateCentreSettings(settings, actor);
    const suffix = randomUUID().slice(0, 8);
    const teacher = await database.teacher.create({ data: { firstName: "Concurrence", lastName: suffix, phone: "20000000" } });
    const room = await database.classroom.create({ data: { name: `Paramètres ${suffix}` } });
    const date = addDays(weekMonday(tunisDate().format("YYYY-MM-DD")), 14);
    let attempt!: Promise<{ accepted: boolean }>;
    let sessionId!: string;
    await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
      attempt = updateCentreSettings({ ...settings, openingMinute: 480 }, actor).then(() => ({ accepted: true }), () => ({ accepted: false }));
      const session = await tx.teachingSession.create({ data: { teacherId: teacher.id, classroomId: room.id, startAt: atTunis(date, "07:00"), endAt: atTunis(date, "09:00") } });
      sessionId = session.id;
    });
    expect(await attempt).toEqual({ accepted: false });
    expect((await getCentreSettings(database)).openingMinute).toBe(0);
    expect((await database.teachingSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("PLANIFIEE");
    await database.teachingSession.update({ where: { id: sessionId }, data: { status: "ANNULEE", cancelledAt: new Date() } });
  });
});
