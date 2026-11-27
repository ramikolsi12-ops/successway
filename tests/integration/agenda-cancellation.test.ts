import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));

import { db as serviceDatabase } from "@/server/db";
import { cancelAgendaSession, changeAgendaStatus, createAgendaSession, endRecurrence, getAgenda, updateAgendaSession, updateRecurrence } from "@/services/agenda";
import { previewPayment, recordPayment } from "@/services/payments";
import { cancellationSchema } from "@/validations/agenda";
import { addDays, atTunis, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";
import type { SessionInput } from "@/types/agenda";

const database = testDatabase();
let actor: { id: string };
const monday = addDays(weekMonday(tunisDate().format("YYYY-MM-DD")), 14);
const secondMonday = addDays(monday, 7);
const thirdMonday = addDays(monday, 14);

beforeAll(async () => { actor = { id: (await database.adminUser.findFirstOrThrow()).id }; });
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const teacher = await database.teacher.create({ data: { firstName: "Annulation", lastName: suffix, phone: "20000000" } });
  const replacementTeacher = await database.teacher.create({ data: { firstName: "Remplaçant", lastName: suffix, phone: "21000000" } });
  const room = await database.classroom.create({ data: { name: `Annulation ${suffix}` } });
  const otherRoom = await database.classroom.create({ data: { name: `Autre ${suffix}` } });
  await database.professorRateAgreement.create({ data: { teacherId: teacher.id, pricePerSession: "20.125", startDate: new Date("2020-01-01T00:00:00Z") } });
  await database.professorRateAgreement.create({ data: { teacherId: replacementTeacher.id, pricePerSession: "47.875", startDate: new Date("2020-01-01T00:00:00Z") } });
  return { teacher, replacementTeacher, room, otherRoom };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, overrides: Partial<SessionInput> = {}): SessionInput {
  return { teacherId: f.teacher.id, classroomId: f.room.id, date: monday, startTime: "08:00", endTime: "10:00", type: "PROVISOIRE", notes: "Note conservée", ...overrides };
}
function fixed(f: Fixture, overrides: Partial<SessionInput> = {}) {
  return createAgendaSession(input(f, { type: "FIXE", weekday: 1, recurrenceStartDate: monday, recurrenceEndDate: null, ...overrides }), actor);
}
function cancellation(scope: "OCCURRENCE" | "FOLLOWING", reason: string | null = null) {
  return { scope, reason, confirm: true as const, idempotencyKey: randomUUID() };
}
async function seriesDay(date: string, recurrenceId: string) {
  return (await getAgenda(date)).events.filter(event => event.recurrenceId === recurrenceId);
}
async function financialRecords(teacherId: string) {
  return {
    charges: await database.sessionCharge.findMany({ where: { teacherId }, orderBy: { id: "asc" } }),
    payments: await database.professorPayment.findMany({ where: { teacherId }, orderBy: { id: "asc" } }),
    allocations: await database.paymentAllocation.findMany({ where: { payment: { teacherId } }, orderBy: { id: "asc" } }),
  };
}
async function receive(teacherId: string, amount: string) {
  const fields = { teacherId, amount, paymentDate: tunisDate().format("YYYY-MM-DD"), notes: null };
  const preview = await previewPayment(fields);
  return recordPayment({ ...fields, previewToken: preview.token, confirm: true, idempotencyKey: randomUUID() }, actor);
}

describe("Annulation de l’agenda : portée et historique", () => {
  it("exige une confirmation, une portée et un identifiant d’opération valides", () => {
    expect(cancellationSchema.safeParse({ scope: "FOLLOWING", confirm: false, idempotencyKey: randomUUID() }).success).toBe(false);
    expect(cancellationSchema.safeParse({ scope: "TOUT", confirm: true, idempotencyKey: randomUUID() }).success).toBe(false);
    expect(cancellationSchema.safeParse({ scope: "OCCURRENCE", confirm: true }).success).toBe(false);
    expect(cancellationSchema.parse({ ...cancellation("OCCURRENCE"), reason: "  Indisponibilité  " }).reason).toBe("Indisponibilité");
  });

  it("annule uniquement une occurrence, conserve son prix et permet une réservation provisoire immédiate", async () => {
    const f = await fixture();
    const original = await fixed(f, { priceOverride: "33.375" });
    const command = cancellation("OCCURRENCE", "Professeur indisponible");
    const cancelled = await cancelAgendaSession(original.id, command, actor);
    expect(cancelled).toMatchObject({ id: original.id, status: "ANNULEE", priceOverride: "33.375", notes: "Note conservée", isException: true });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect((await seriesDay(secondMonday, original.recurrenceId!))[0].status).toBe("PLANIFIEE");
    expect(await database.sessionCharge.count({ where: { sessionId: cancelled.sessionId! } })).toBe(0);
    expect((await database.auditLog.findUniqueOrThrow({ where: { id: command.idempotencyKey } })).reason).toBe("Professeur indisponible");
    const replacement = await createAgendaSession(input(f, { teacherId: f.replacementTeacher.id, notes: null }), actor);
    expect(replacement).toMatchObject({ status: "PLANIFIEE", type: "PROVISOIRE", priceOverride: null, expectedPrice: "47.875" });
    expect(replacement.id).not.toBe(cancelled.id);
    await expect(fixed(f, { teacherId: f.replacementTeacher.id })).rejects.toMatchObject({ status: 409 });
  });

  it("explique pourquoi une annulation isolée ne permet pas une programmation fixe concurrente", async () => {
    const f = await fixture();
    const original = await fixed(f);
    await cancelAgendaSession(original.id, cancellation("OCCURRENCE"), actor);
    await expect(fixed(f, { teacherId: f.replacementTeacher.id })).rejects.toThrow("Ce créneau est disponible cette semaine uniquement. Une séance fixe existe encore pour les semaines suivantes.");
    const otherSlot = await createAgendaSession(input(f, { classroomId: f.otherRoom.id, startTime: "10:00", endTime: "12:00" }), actor);
    await expect(updateAgendaSession(otherSlot.id, input(f), actor)).resolves.toMatchObject({ status: "PLANIFIEE" });
  });

  it("libère les créneaux de salle et de professeur d’une provisoire sans créer de charge", async () => {
    const f = await fixture();
    const provisional = await createAgendaSession(input(f), actor);
    await expect(cancelAgendaSession(provisional.id, cancellation("FOLLOWING"), actor)).rejects.toThrow(/provisoire/);
    await cancelAgendaSession(provisional.id, cancellation("OCCURRENCE"), actor);
    const replacement = await createAgendaSession(input(f), actor);
    expect(replacement.id).not.toBe(provisional.id);
    expect(await database.teachingSession.count({ where: { id: provisional.id, status: "ANNULEE" } })).toBe(1);
    expect(await database.sessionCharge.count({ where: { sessionId: provisional.id } })).toBe(0);
  });

  it("arrête une seule série, préserve les anciens paiements et permet une nouvelle série indépendante", async () => {
    const f = await fixture();
    const original = await fixed(f, { priceOverride: "31.375" });
    const completed = await changeAgendaStatus(original.id, { status: "TERMINEE", confirm: true }, actor);
    await receive(f.teacher.id, "10.125");
    const before = await financialRecords(f.teacher.id);
    const completedBefore = await database.teachingSession.findUniqueOrThrow({ where: { id: completed.sessionId! } });
    const parallel = await fixed(f, { startTime: "12:00", endTime: "13:00" });
    const selected = (await seriesDay(secondMonday, original.recurrenceId!))[0];
    const command = cancellation("FOLLOWING", "Fin de programmation");
    const cancelled = await cancelAgendaSession(selected.id, command, actor);
    expect(cancelled).toMatchObject({ id: selected.id, status: "ANNULEE", occurrenceWeek: secondMonday });
    expect(await financialRecords(f.teacher.id)).toEqual(before);
    expect(await database.teachingSession.findUniqueOrThrow({ where: { id: completed.sessionId! } })).toEqual(completedBefore);
    expect((await seriesDay(monday, original.recurrenceId!))[0].id).toBe(completed.id);
    expect(await seriesDay(thirdMonday, original.recurrenceId!)).toHaveLength(0);
    expect((await seriesDay(thirdMonday, parallel.recurrenceId!))[0].status).toBe("PLANIFIEE");
    expect((await database.recurrenceSeries.findUniqueOrThrow({ where: { id: original.recurrenceId! } })).active).toBe(true);
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId! } })).toBe(2);
    const replacement = await fixed(f, { teacherId: f.replacementTeacher.id, date: secondMonday, recurrenceStartDate: secondMonday, priceOverride: null });
    expect(replacement.recurrenceId).not.toBe(original.recurrenceId);
    expect(replacement).toMatchObject({ expectedPrice: "47.875", priceOverride: null });
    expect((await seriesDay(thirdMonday, replacement.recurrenceId!))[0].status).toBe("PLANIFIEE");
    const marker = await database.auditLog.findFirstOrThrow({ where: { action: "FIN_PROGRAMMATION_PAR_ANNULATION", entityId: original.recurrenceId! } });
    expect(marker.reason).toBe("Fin de programmation");
    expect(marker.after).toMatchObject({ effectiveDate: secondMonday });
    await expect(updateRecurrence(original.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.room.id, weekday: 1, startTime: "14:00", endTime: "16:00", effectiveDate: thirdMonday, endDate: null, notes: null, confirm: true }, actor)).rejects.toThrow(/arrêtée définitivement/);
    await expect(endRecurrence(original.recurrenceId!, { effectiveDate: thirdMonday, confirm: true }, actor)).rejects.toThrow(/arrêtée définitivement/);
  });

  it("ferme à la date réelle choisie, annule les exceptions futures déplacées et conserve absences et anciennes semaines virtuelles", async () => {
    const f = await fixture();
    const original = await fixed(f, { date: addDays(monday, 2), recurrenceStartDate: addDays(monday, 2), weekday: 3 });
    const selected = (await seriesDay(addDays(secondMonday, 2), original.recurrenceId!))[0];
    const movedSelected = await updateAgendaSession(selected.id, input(f, { type: "FIXE", date: addDays(secondMonday, 1) }), actor);
    const future = (await seriesDay(addDays(thirdMonday, 2), original.recurrenceId!))[0];
    const movedFuture = await updateAgendaSession(future.id, input(f, { type: "FIXE", date: addDays(thirdMonday, 4), classroomId: f.otherRoom.id, priceOverride: "88.875", notes: "Exception à conserver" }), actor);
    await changeAgendaStatus(movedFuture.id, { status: "EN_COURS", confirm: true }, actor);
    const absentWeek = addDays(monday, 21);
    const absent = await changeAgendaStatus(`${original.recurrenceId}@${absentWeek}`, { status: "ABSENT", confirm: true }, actor);
    const absentBefore = await database.teachingSession.findUniqueOrThrow({ where: { id: absent.sessionId! } });
    await updateRecurrence(original.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.room.id, weekday: 4, startTime: "11:00", endTime: "13:00", effectiveDate: thirdMonday, endDate: null, notes: null, confirm: true }, actor);
    const countBefore = await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId! } });
    await cancelAgendaSession(movedSelected.id, cancellation("FOLLOWING"), actor);
    expect((await seriesDay(addDays(monday, 2), original.recurrenceId!))[0].persisted).toBe(false);
    const futureStored = await database.teachingSession.findUniqueOrThrow({ where: { id: movedFuture.sessionId! } });
    expect(futureStored).toMatchObject({ status: "ANNULEE", notes: "Exception à conserver" });
    expect(futureStored.priceOverride?.toFixed(3)).toBe("88.875");
    expect(await database.teachingSession.findUniqueOrThrow({ where: { id: absent.sessionId! } })).toEqual(absentBefore);
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId!, status: { in: ["PLANIFIEE", "EN_COURS"] } } })).toBe(0);
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId! } })).toBe(countBefore);
    expect(await seriesDay(addDays(thirdMonday, 3), original.recurrenceId!)).toHaveLength(0);
    expect(await seriesDay(addDays(monday, 70), original.recurrenceId!)).toHaveLength(0);
    const versions = await database.recurrenceSchedule.findMany({ where: { recurrenceId: original.recurrenceId! }, orderBy: { startDate: "asc" } });
    expect(versions[0].endDate?.toISOString().slice(0, 10)).toBe(secondMonday);
    expect(versions[1].supersededAt).not.toBeNull();
    expect((await seriesDay(addDays(secondMonday, 1), original.recurrenceId!))[0].id).toBe(selected.id);
  });

  it("refuse atomiquement un arrêt qui toucherait une séance terminée future", async () => {
    const f = await fixture();
    const original = await fixed(f);
    const future = (await seriesDay(thirdMonday, original.recurrenceId!))[0];
    await changeAgendaStatus(future.id, { status: "TERMINEE", confirm: true, priceOverride: "41.625" }, actor);
    await receive(f.teacher.id, "12.125");
    const before = await financialRecords(f.teacher.id);
    const schedules = await database.recurrenceSchedule.findMany({ where: { recurrenceId: original.recurrenceId! } });
    const selected = (await seriesDay(secondMonday, original.recurrenceId!))[0];
    await expect(cancelAgendaSession(selected.id, cancellation("FOLLOWING"), actor)).rejects.toThrow(/contient une séance terminée/);
    await expect(endRecurrence(original.recurrenceId!, { effectiveDate: secondMonday, confirm: true }, actor)).rejects.toThrow(/contient une séance terminée/);
    expect(await financialRecords(f.teacher.id)).toEqual(before);
    expect(await database.recurrenceSchedule.findMany({ where: { recurrenceId: original.recurrenceId! } })).toEqual(schedules);
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId!, occurrenceWeek: new Date(secondMonday) } })).toBe(0);
    expect((await seriesDay(secondMonday, original.recurrenceId!))[0].status).toBe("PLANIFIEE");
    expect(await database.auditLog.count({ where: { action: "FIN_PROGRAMMATION_PAR_ANNULATION", entityId: original.recurrenceId! } })).toBe(0);
    await expect(cancelAgendaSession(future.id, cancellation("OCCURRENCE"), actor)).rejects.toThrow(/terminée ne peut pas être annulée/);
  });

  it("applique aussi l’arrêt définitif aux exceptions futures depuis l’ancienne API de fin", async () => {
    const f = await fixture();
    const original = await fixed(f);
    const future = (await seriesDay(thirdMonday, original.recurrenceId!))[0];
    const moved = await updateAgendaSession(future.id, input(f, { type: "FIXE", date: addDays(thirdMonday, 2), classroomId: f.otherRoom.id, priceOverride: "55.625" }), actor);
    await endRecurrence(original.recurrenceId!, { effectiveDate: secondMonday, confirm: true }, actor);
    expect((await seriesDay(monday, original.recurrenceId!))[0].status).toBe("PLANIFIEE");
    expect(await seriesDay(secondMonday, original.recurrenceId!)).toHaveLength(0);
    expect((await seriesDay(addDays(thirdMonday, 2), original.recurrenceId!))[0]).toMatchObject({ id: moved.id, status: "ANNULEE", priceOverride: "55.625" });
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId!, status: { in: ["PLANIFIEE", "EN_COURS"] }, occurrenceWeek: { gte: new Date(secondMonday) } } })).toBe(0);
    await expect(updateRecurrence(original.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.room.id, weekday: 1, startTime: "08:00", endTime: "10:00", effectiveDate: thirdMonday, endDate: null, notes: null, confirm: true }, actor)).rejects.toThrow(/arrêtée définitivement/);
  });

  it("rejoue une annulation concurrente sans doubler ses écritures et refuse la réutilisation contradictoire d’une clé", async () => {
    const f = await fixture();
    const original = await fixed(f);
    const command = cancellation("FOLLOWING", "Arrêt confirmé");
    const results = await Promise.all([cancelAgendaSession(original.id, command, actor), cancelAgendaSession(original.id, command, actor)]);
    expect(results[0].id).toBe(original.id);
    expect(results[1].sessionId).toBe(results[0].sessionId);
    expect(await database.teachingSession.count({ where: { recurrenceId: original.recurrenceId! } })).toBe(1);
    expect(await database.auditLog.count({ where: { action: "FIN_PROGRAMMATION_PAR_ANNULATION", entityId: original.recurrenceId! } })).toBe(1);
    await expect(cancelAgendaSession(original.id, { ...command, scope: "OCCURRENCE" }, actor)).rejects.toThrow(/déjà été utilisé/);
  });

  it("protège le créneau libéré contre deux remplacements simultanés", async () => {
    const f = await fixture();
    const original = await fixed(f);
    await cancelAgendaSession(original.id, cancellation("FOLLOWING"), actor);
    const results = await Promise.allSettled([
      fixed(f, { teacherId: f.replacementTeacher.id }),
      createAgendaSession(input(f), actor),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const active = (await getAgenda(monday)).events.filter(event => event.classroomId === f.room.id && event.status !== "ANNULEE");
    expect(active).toHaveLength(1);
    expect(active[0].startAt).toBe(atTunis(monday, "08:00").toISOString());
  });
});
