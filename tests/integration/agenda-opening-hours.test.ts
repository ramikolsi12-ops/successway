import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));
import { Prisma } from "@/generated/prisma/client";
import { db as serviceDatabase } from "@/server/db";
import { cancelAgendaSession, changeAgendaStatus, createAgendaSession, getAgenda, updateAgendaSession, updateRecurrence } from "@/services/agenda";
import { addDays, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";
import type { SessionInput } from "@/types/agenda";

const database = testDatabase();
let actor: { id: string };
let savedHours: { value: Prisma.JsonValue } | null;
const monday = addDays(weekMonday(tunisDate().format("YYYY-MM-DD")), 14);

beforeAll(async () => { actor = { id: (await database.adminUser.findFirstOrThrow()).id }; });
beforeEach(async () => { savedHours = await database.appSetting.findUnique({ where: { key: "operatingHours" }, select: { value: true } }); await setHours(0, 1440, [1, 2, 3, 4, 5, 6, 7]); });
afterEach(async () => {
  if (savedHours) await database.appSetting.update({ where: { key: "operatingHours" }, data: { value: savedHours.value === null ? Prisma.JsonNull : savedHours.value } });
  else await database.appSetting.deleteMany({ where: { key: "operatingHours" } });
});
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

// This fixture uses only the guarded disposable database. Settings are restored
// after every test; no centre data or financial history is rewritten.
async function setHours(openingMinute: number, closingMinute: number, openingDays: number[]) {
  const value = { configured: true, openingMinute, closingMinute, openingDays };
  await database.appSetting.upsert({ where: { key: "operatingHours" }, create: { key: "operatingHours", value }, update: { value } });
}
async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const teacher = await database.teacher.create({ data: { firstName: "Horaires", lastName: suffix, phone: "20000000" } });
  const room = await database.classroom.create({ data: { name: `Horaires ${suffix}` } });
  await database.professorRateAgreement.create({ data: { teacherId: teacher.id, pricePerSession: "20.125", startDate: new Date("2020-01-01") } });
  return { teacher, room };
}
function input(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<SessionInput> = {}): SessionInput {
  return { teacherId: f.teacher.id, classroomId: f.room.id, date: monday, startTime: "08:30", endTime: "10:00", type: "PROVISOIRE", notes: null, ...overrides };
}

describe("Horaires du centre : validation autoritaire de l’agenda", () => {
  it("accepte les limites et séances adjacentes, refuse les créneaux et jours fermés", async () => {
    const f = await fixture(); await setHours(510, 1200, [1, 2, 3, 4, 5]);
    const first = await createAgendaSession(input(f), actor);
    expect(first.startAt).toContain("07:30:00");
    await expect(createAgendaSession(input(f, { startTime: "10:00", endTime: "11:00" }), actor)).resolves.toMatchObject({ status: "PLANIFIEE" });
    await expect(createAgendaSession(input(f, { startTime: "19:00", endTime: "20:00" }), actor)).resolves.toMatchObject({ status: "PLANIFIEE" });
    await expect(createAgendaSession(input(f, { startTime: "08:00" }), actor)).rejects.toThrow(/horaires/);
    await expect(createAgendaSession(input(f, { startTime: "20:00", endTime: "20:30" }), actor)).rejects.toThrow(/horaires/);
    await expect(createAgendaSession(input(f, { date: addDays(monday, 6) }), actor)).rejects.toThrow(/fermé/);
    expect((await getAgenda(monday)).openingHours).toEqual({ openingMinute: 510, closingMinute: 1200, openingDays: [1, 2, 3, 4, 5] });
  });

  it("contrôle toutes les occurrences d’une création ou modification de série sans horizon", async () => {
    const f = await fixture(); await setHours(510, 1200, [1, 2, 3, 4, 5]);
    await expect(createAgendaSession(input(f, { type: "FIXE", weekday: 7, date: addDays(monday, 6), recurrenceStartDate: monday }), actor)).rejects.toThrow(/fermé/);
    const fixed = await createAgendaSession(input(f, { type: "FIXE", weekday: 1, recurrenceStartDate: monday }), actor);
    await expect(updateRecurrence(fixed.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.room.id, weekday: 7, startTime: "09:00", endTime: "10:00", effectiveDate: addDays(monday, 7), endDate: null, notes: null, confirm: true }, actor)).rejects.toThrow(/fermé/);
    await expect(updateRecurrence(fixed.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.room.id, weekday: 1, startTime: "07:00", endTime: "08:00", effectiveDate: addDays(monday, 7), endDate: null, notes: null, confirm: true }, actor)).rejects.toThrow(/horaires/);
  });

  it("refuse un déplacement hors horaires et conserve la réservation précédente", async () => {
    const f = await fixture(); await setHours(510, 1200, [1, 2, 3, 4, 5]);
    const original = await createAgendaSession(input(f), actor);
    await expect(updateAgendaSession(original.id, input(f, { startTime: "07:00", endTime: "08:00" }), actor)).rejects.toThrow(/horaires/);
    expect((await getAgenda(monday)).events.find(event => event.id === original.id)).toMatchObject({ startAt: original.startAt, endAt: original.endAt });
  });

  it("conserve l’accès, les prix, les changements de statut et l’annulation des anciens créneaux", async () => {
    const f = await fixture(); const date = addDays(monday, -35);
    const historical = await createAgendaSession(input(f, { date, startTime: "06:00", endTime: "07:00" }), actor);
    const cancelled = await createAgendaSession(input(f, { date, startTime: "07:00", endTime: "08:00" }), actor);
    await setHours(510, 1200, [2]);
    expect((await getAgenda(date)).events.some(event => event.id === historical.id)).toBe(true);
    await expect(updateAgendaSession(historical.id, input(f, { date, startTime: "06:00", endTime: "07:00", notes: "Note historique", priceOverride: "25.125" }), actor)).resolves.toMatchObject({ priceOverride: "25.125" });
    await changeAgendaStatus(historical.id, { status: "EN_COURS", confirm: true }, actor);
    await expect(changeAgendaStatus(historical.id, { status: "TERMINEE", confirm: true }, actor)).resolves.toMatchObject({ status: "TERMINEE", rateSnapshot: "25.125" });
    await expect(cancelAgendaSession(cancelled.id, { scope: "OCCURRENCE", reason: null, confirm: true, idempotencyKey: randomUUID() }, actor)).resolves.toMatchObject({ status: "ANNULEE" });
    expect(await database.sessionCharge.count({ where: { teacherId: f.teacher.id } })).toBe(1);
    await expect(createAgendaSession(input(f, { date, startTime: "07:00", endTime: "08:00" }), actor)).rejects.toThrow(/fermé/);
  });
});
