import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));

import { db as serviceDatabase } from "@/server/db";
import { createAgendaSession, getAgenda, updateAgendaSession, changeAgendaStatus, updateRecurrence, endRecurrence } from "@/services/agenda";
import { setClassroomActive, upcomingClassroomSessions } from "@/services/classrooms";
import { setProfessorActive } from "@/services/professors";
import { createRateAgreement } from "@/services/pricing";
import type { AgendaEvent, SessionInput } from "@/types/agenda";
import { addDays, atTunis, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";

const database = testDatabase();
let actor: { id: string };
const monday = addDays(weekMonday(tunisDate().format("YYYY-MM-DD")), 14);
const secondMonday = addDays(monday, 7);
const thirdMonday = addDays(monday, 14);

beforeAll(async () => {
  actor = { id: (await database.adminUser.findFirstOrThrow()).id };
});
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

async function fixture(withRate = true) {
  const suffix = randomUUID().slice(0, 8);
  const teacher = await database.teacher.create({ data: { firstName: "Agenda", lastName: suffix, phone: "20000000" } });
  const otherTeacher = await database.teacher.create({ data: { firstName: "Autre", lastName: suffix, phone: "21000000" } });
  const room = await database.classroom.create({ data: { name: `Agenda ${suffix}` } });
  const otherRoom = await database.classroom.create({ data: { name: `Annexe ${suffix}` } });
  const agreement = withRate ? await database.professorRateAgreement.create({ data: {
    teacherId: teacher.id, pricePerSession: "20.125", startDate: new Date("2020-01-01T00:00:00Z"),
  } }) : null;
  return { teacher, otherTeacher, room, otherRoom, agreement };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, overrides: Partial<SessionInput> = {}): SessionInput {
  return { teacherId: f.teacher.id, classroomId: f.room.id, date: monday, startTime: "08:00", endTime: "10:00", type: "PROVISOIRE", notes: null, ...overrides };
}
function fixed(f: Fixture, overrides: Partial<SessionInput> = {}) {
  return createAgendaSession(input(f, { type: "FIXE", weekday: 1, recurrenceStartDate: monday, recurrenceEndDate: null, ...overrides }), actor);
}
async function seriesDay(date: string, recurrenceId: string) {
  return (await getAgenda(date)).events.filter(event => event.recurrenceId === recurrenceId);
}
function idOf(event: AgendaEvent) { return event.id; }

describe("Agenda PostgreSQL : réservations et récurrences", () => {
  it("crée une séance provisoire précise de 90 minutes sans la répéter", async () => {
    const f = await fixture();
    const event = await createAgendaSession(input(f, { startTime: "08:30", endTime: "10:00" }), actor);
    expect(event.type).toBe("PROVISOIRE");
    expect(event.startAt).toBe(atTunis(monday, "08:30").toISOString());
    expect(new Date(event.endAt).getTime() - new Date(event.startAt).getTime()).toBe(90 * 60_000);
    expect((await getAgenda(secondMonday)).events.some(value => value.id === event.id)).toBe(false);
  });

  it("développe une série hebdomadaire sans écrire de lignes lors de la lecture", async () => {
    const f = await fixture();
    const first = await fixed(f);
    const count = await database.teachingSession.count({ where: { recurrenceId: first.recurrenceId } });
    for (const date of [monday, secondMonday, thirdMonday]) {
      const [event] = await seriesDay(date, first.recurrenceId!);
      expect(event.type).toBe("FIXE");
      expect(event.startAt.slice(0, 10)).toBe(date);
      expect(event.status).toBe("PLANIFIEE");
    }
    expect(await database.teachingSession.count({ where: { recurrenceId: first.recurrenceId } })).toBe(count);
    const event = (await seriesDay(secondMonday, first.recurrenceId!))[0];
    expect((await seriesDay(secondMonday, first.recurrenceId!))[0].id).toBe(event.id);
  });

  it("respecte la fin de récurrence inclusive", async () => {
    const f = await fixture();
    const event = await fixed(f, { recurrenceEndDate: secondMonday });
    expect(await seriesDay(secondMonday, event.recurrenceId!)).toHaveLength(1);
    expect(await seriesDay(thirdMonday, event.recurrenceId!)).toHaveLength(0);
  });

  it("autorise fixe et provisoire adjacentes, mais refuse un conflit de salle", async () => {
    const f = await fixture();
    await fixed(f);
    await expect(createAgendaSession(input(f, { teacherId: f.otherTeacher.id, startTime: "09:30", endTime: "11:00" }), actor)).rejects.toMatchObject({ status: 409 });
    const adjacent = await createAgendaSession(input(f, { teacherId: f.otherTeacher.id, startTime: "10:00", endTime: "11:30" }), actor);
    expect(adjacent.status).toBe("PLANIFIEE");
  });

  it("refuse un conflit de professeur dans une autre salle", async () => {
    const f = await fixture();
    await fixed(f);
    await expect(createAgendaSession(input(f, { classroomId: f.otherRoom.id, startTime: "09:00", endTime: "10:30" }), actor)).rejects.toMatchObject({ status: 409 });
  });

  it("refuse le conflit entre deux programmations fixes, y compris loin dans le futur", async () => {
    const f = await fixture();
    await fixed(f);
    await expect(fixed(f, {
      teacherId: f.otherTeacher.id, date: addDays(monday, 7 * 160), recurrenceStartDate: addDays(monday, 7 * 160), startTime: "08:30", endTime: "09:30",
    })).rejects.toMatchObject({ status: 409 });
  });

  it("déplace uniquement une occurrence dans sa semaine sans la dupliquer", async () => {
    const f = await fixture();
    const series = await fixed(f);
    const original = (await seriesDay(secondMonday, series.recurrenceId!))[0];
    const moved = await updateAgendaSession(original.id, input(f, { type: "FIXE", classroomId: f.otherRoom.id, date: addDays(secondMonday, 2), startTime: "08:30", endTime: "10:00" }), actor);
    expect(moved.isException).toBe(true);
    expect(await seriesDay(secondMonday, series.recurrenceId!)).toHaveLength(0);
    const day = await seriesDay(addDays(secondMonday, 2), series.recurrenceId!);
    expect(day).toHaveLength(1);
    expect(day[0].classroomId).toBe(f.otherRoom.id);
    expect((await seriesDay(thirdMonday, series.recurrenceId!))[0].classroomId).toBe(f.room.id);
    expect(await database.teachingSession.count({ where: { recurrenceId: series.recurrenceId, occurrenceWeek: new Date(secondMonday) } })).toBe(1);
  });

  it("refuse de déplacer une occurrence hors de sa semaine", async () => {
    const f = await fixture();
    const event = await fixed(f);
    await expect(updateAgendaSession(event.id, input(f, { type: "FIXE", date: secondMonday }), actor)).rejects.toThrow();
  });

  it("annule une semaine, libère le créneau et laisse les semaines suivantes prévues", async () => {
    const f = await fixture();
    const first = await fixed(f);
    const cancelled = await changeAgendaStatus(first.id, { status: "ANNULEE", confirm: true }, actor);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect((await seriesDay(monday, first.recurrenceId!))[0].status).toBe("ANNULEE");
    expect((await seriesDay(secondMonday, first.recurrenceId!))[0].status).toBe("PLANIFIEE");
    await expect(createAgendaSession(input(f, { teacherId: f.otherTeacher.id }), actor)).resolves.toBeDefined();
    expect(cancelled.id).toBe(first.id);
    expect(await database.sessionCharge.count({ where: { sessionId: cancelled.sessionId! } })).toBe(0);
  });

  it("marque une seule occurrence absente et libère son occupation", async () => {
    const f = await fixture();
    const first = await fixed(f);
    const absent = await changeAgendaStatus(first.id, { status: "ABSENT", confirm: true }, actor);
    expect(absent.status).toBe("ABSENT");
    expect(absent.absentAt).not.toBeNull();
    expect((await seriesDay(secondMonday, first.recurrenceId!))[0].status).toBe("PLANIFIEE");
    await expect(createAgendaSession(input(f, { teacherId: f.otherTeacher.id }), actor)).resolves.toBeDefined();
    expect(await database.sessionCharge.count({ where: { sessionId: absent.sessionId! } })).toBe(0);
  });

  it("conserve les exceptions et séances terminées lors d’un changement futur de programmation", async () => {
    const f = await fixture();
    const first = await fixed(f);
    const completed = await changeAgendaStatus(first.id, { status: "TERMINEE", confirm: true }, actor);
    const second = (await seriesDay(secondMonday, first.recurrenceId!))[0];
    const exception = await updateAgendaSession(second.id, input(f, { type: "FIXE", date: secondMonday, classroomId: f.otherRoom.id, startTime: "10:00", endTime: "11:30" }), actor);
    await updateRecurrence(first.recurrenceId!, {
      teacherId: f.teacher.id, classroomId: f.room.id, weekday: 3, startTime: "14:00", endTime: "16:00", effectiveDate: secondMonday, endDate: null, notes: "Nouvelle programmation", confirm: true,
    }, actor);
    expect((await seriesDay(monday, first.recurrenceId!))[0].id).toBe(completed.id);
    expect((await seriesDay(secondMonday, first.recurrenceId!))[0].id).toBe(exception.id);
    expect(await seriesDay(addDays(secondMonday, 2), first.recurrenceId!)).toHaveLength(0);
    const future = await seriesDay(addDays(thirdMonday, 2), first.recurrenceId!);
    expect(future).toHaveLength(1);
    expect(future[0].startAt).toBe(atTunis(addDays(thirdMonday, 2), "14:00").toISOString());
    expect((await database.teachingSession.findUniqueOrThrow({ where: { id: completed.sessionId! } })).rateSnapshot?.toFixed(3)).toBe("20.125");
  });

  it("termine une programmation sans supprimer les occurrences et exceptions précédentes", async () => {
    const f = await fixture();
    const series = await fixed(f);
    const second = (await seriesDay(secondMonday, series.recurrenceId!))[0];
    await changeAgendaStatus(second.id, { status: "ABSENT", confirm: true }, actor);
    await endRecurrence(series.recurrenceId!, { effectiveDate: thirdMonday, confirm: true }, actor);
    expect(await seriesDay(monday, series.recurrenceId!)).toHaveLength(1);
    expect((await seriesDay(secondMonday, series.recurrenceId!))[0].status).toBe("ABSENT");
    expect(await seriesDay(thirdMonday, series.recurrenceId!)).toHaveLength(0);
  });
});

describe("Agenda PostgreSQL : statuts et finances", () => {
  it("enregistre explicitement le début sans générer une charge", async () => {
    const f = await fixture();
    const planned = await createAgendaSession(input(f), actor);
    const running = await changeAgendaStatus(planned.id, { status: "EN_COURS", confirm: true }, actor);
    expect(running.status).toBe("EN_COURS");
    expect(running.startedAt).not.toBeNull();
    expect(await database.sessionCharge.count({ where: { sessionId: planned.id } })).toBe(0);
  });

  it("finalise atomiquement avec le prix exact, une seule charge et aucun paiement reçu", async () => {
    const f = await fixture();
    const planned = await createAgendaSession(input(f, { startTime: "08:30", endTime: "10:00" }), actor);
    const results = await Promise.allSettled([
      changeAgendaStatus(planned.id, { status: "TERMINEE", confirm: true }, actor),
      changeAgendaStatus(planned.id, { status: "TERMINEE", confirm: true }, actor),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
    const completed = await database.teachingSession.findUniqueOrThrow({ where: { id: planned.id } });
    expect(completed.status).toBe("TERMINEE");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.rateSnapshot?.toFixed(3)).toBe("20.125");
    expect(completed.rateAgreementId).toBe(f.agreement!.id);
    const charges = await database.sessionCharge.findMany({ where: { sessionId: planned.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0].amount.toFixed(3)).toBe("20.125");
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
  });

  it("annule la finalisation sans tarif, sans laisser de statut ou de charge partiels", async () => {
    const f = await fixture(false);
    const planned = await createAgendaSession(input(f), actor);
    await expect(changeAgendaStatus(planned.id, { status: "TERMINEE", confirm: true }, actor)).rejects.toThrow(/tarif/i);
    const session = await database.teachingSession.findUniqueOrThrow({ where: { id: planned.id } });
    expect(session.status).toBe("PLANIFIEE");
    expect(session.rateSnapshot).toBeNull();
    expect(session.completedAt).toBeNull();
    expect(await database.sessionCharge.count({ where: { sessionId: planned.id } })).toBe(0);
  });

  it("ne transforme pas une séance terminée en absence ou annulation et conserve ses montants", async () => {
    const f = await fixture();
    const event = await createAgendaSession(input(f), actor);
    await changeAgendaStatus(event.id, { status: "TERMINEE", confirm: true }, actor);
    await expect(changeAgendaStatus(event.id, { status: "ABSENT", confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(changeAgendaStatus(event.id, { status: "ANNULEE", confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(updateAgendaSession(event.id, input(f, { startTime: "09:00", endTime: "11:00" }), actor)).rejects.toThrow();
    await expect(database.teachingSession.update({ where: { id: event.id }, data: { rateSnapshot: "50.000" } })).rejects.toThrow();
    const charge = await database.sessionCharge.findUniqueOrThrow({ where: { sessionId: event.id } });
    await expect(database.sessionCharge.update({ where: { id: charge.id }, data: { amount: "50.000" } })).rejects.toThrow();
  });

  it("refuse les transitions contradictoires après une annulation", async () => {
    const f = await fixture();
    const event = await createAgendaSession(input(f), actor);
    await changeAgendaStatus(event.id, { status: "ANNULEE", confirm: true }, actor);
    await expect(changeAgendaStatus(event.id, { status: "EN_COURS", confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
  });
});

describe("Agenda PostgreSQL : intégration des ressources et concurrence", () => {
  it("tient compte d’une réservation historique traversant minuit", async () => {
    const f = await fixture();
    await database.teachingSession.create({ data: { teacherId: f.teacher.id, classroomId: f.room.id,
      startAt: atTunis(monday, "23:00"), endAt: atTunis(addDays(monday, 1), "02:00") } });
    await expect(fixed(f, { teacherId: f.otherTeacher.id, date: addDays(monday, 1), recurrenceStartDate: addDays(monday, 1), weekday: 2,
      startTime: "00:30", endTime: "01:30" })).rejects.toMatchObject({ status: 409 });
  });

  it("permet une annulation, absence ou finalisation historique après désactivation du professeur", async () => {
    const f = await fixture();
    const series = await fixed(f);
    await setProfessorActive(f.teacher.id, { active: false, confirmed: true }, actor);
    const cancelled = await changeAgendaStatus(series.id, { status: "ANNULEE", confirm: true }, actor);
    expect(cancelled.status).toBe("ANNULEE");
    const second = (await seriesDay(secondMonday, series.recurrenceId!))[0];
    expect((await changeAgendaStatus(second.id, { status: "ABSENT", confirm: true }, actor)).status).toBe("ABSENT");
    const third = (await seriesDay(thirdMonday, series.recurrenceId!))[0];
    expect((await changeAgendaStatus(third.id, { status: "TERMINEE", confirm: true }, actor)).chargeAmount).toBe("20.125");
  });

  it("remplace une programmation future dès sa première semaine en conservant sa version d’origine", async () => {
    const f = await fixture();
    const series = await fixed(f);
    await updateRecurrence(series.recurrenceId!, { teacherId: f.teacher.id, classroomId: f.otherRoom.id, weekday: 1,
      startTime: "10:30", endTime: "12:00", effectiveDate: monday, endDate: null, notes: null, confirm: true }, actor);
    const [changed] = await seriesDay(monday, series.recurrenceId!);
    expect(changed.id).toBe(series.id);
    expect(changed.classroomId).toBe(f.otherRoom.id);
    expect(changed.startAt).toBe(atTunis(monday, "10:30").toISOString());
    const versions = await database.recurrenceSchedule.findMany({ where: { recurrenceId: series.recurrenceId! } });
    expect(versions).toHaveLength(2);
    expect(versions.filter(version => version.supersededAt)).toHaveLength(1);
  });

  it("arrête une programmation avant son début et permet la désactivation de sa salle", async () => {
    const f = await fixture();
    const series = await fixed(f);
    await endRecurrence(series.recurrenceId!, { effectiveDate: monday, confirm: true }, actor);
    expect(await seriesDay(monday, series.recurrenceId!)).toHaveLength(0);
    expect(await seriesDay(secondMonday, series.recurrenceId!)).toHaveLength(0);
    expect(await database.recurrenceSchedule.count({ where: { recurrenceId: series.recurrenceId! } })).toBe(1);
    await expect(setClassroomActive(f.room.id, { active: false, confirmed: true }, actor)).resolves.toMatchObject({ active: false });
  });

  it("garde l’identifiant de l’occurrence et le prix historique après un nouveau tarif", async () => {
    const f = await fixture();
    const series = await fixed(f);
    const completed = await changeAgendaStatus(series.id, { status: "TERMINEE", confirm: true }, actor);
    expect(completed.id).toBe(series.id);
    await createRateAgreement(f.teacher.id, { pricePerSession: "30.375", startDate: secondMonday, closePrevious: true }, actor);
    expect((await seriesDay(monday, series.recurrenceId!))[0].chargeAmount).toBe("20.125");
    const second = (await seriesDay(secondMonday, series.recurrenceId!))[0];
    expect((await changeAgendaStatus(second.id, { status: "TERMINEE", confirm: true }, actor)).chargeAmount).toBe("30.375");
  });

  it("refuse le déplacement d’une occurrence sur une réservation d’une autre série", async () => {
    const f = await fixture();
    const original = await fixed(f);
    await fixed(f, { teacherId: f.otherTeacher.id, classroomId: f.otherRoom.id, startTime: "10:00", endTime: "12:00" });
    await expect(updateAgendaSession(original.id, input(f, { type: "FIXE", classroomId: f.otherRoom.id, startTime: "10:30", endTime: "12:00" }), actor)).rejects.toMatchObject({ status: 409 });
    expect((await seriesDay(monday, original.recurrenceId!))[0].classroomId).toBe(f.room.id);
  });

  it("refuse les réservations dans une salle inactive ou pour un professeur inactif", async () => {
    const f = await fixture();
    await setClassroomActive(f.room.id, { active: false, confirmed: true }, actor);
    await expect(createAgendaSession(input(f), actor)).rejects.toThrow(/inactive/i);
    await setClassroomActive(f.room.id, { active: true, confirmed: true }, actor);
    await setProfessorActive(f.teacher.id, { active: false, confirmed: true }, actor);
    await expect(createAgendaSession(input(f), actor)).rejects.toThrow(/inactif/i);
    expect((await getAgenda(monday)).classrooms.find(room => room.id === f.room.id)?.active).toBe(true);
  });

  it("montre une salle inactive dans l’agenda", async () => {
    const f = await fixture();
    await setClassroomActive(f.room.id, { active: false, confirmed: true }, actor);
    expect((await getAgenda(monday)).classrooms.find(room => room.id === f.room.id)?.active).toBe(false);
  });

  it("protège la désactivation d’une salle ayant une programmation fixe future", async () => {
    const f = await fixture();
    await fixed(f);
    expect((await upcomingClassroomSessions(f.room.id)).sessions.length).toBeGreaterThan(0);
    await expect(setClassroomActive(f.room.id, { active: false, confirmed: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await database.classroom.findUniqueOrThrow({ where: { id: f.room.id } })).active).toBe(true);
    await expect(database.classroom.update({ where: { id: f.room.id }, data: { active: false } })).rejects.toThrow();
  });

  it("une annulation isolée ne supprime pas la protection des semaines suivantes", async () => {
    const f = await fixture();
    const event = await fixed(f);
    await changeAgendaStatus(event.id, { status: "ANNULEE", confirm: true }, actor);
    await expect(setClassroomActive(f.room.id, { active: false, confirmed: true }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("permet la désactivation lorsque la seule occurrence fixe a été annulée", async () => {
    const f = await fixture();
    const event = await fixed(f, { recurrenceEndDate: monday });
    await changeAgendaStatus(event.id, { status: "ANNULEE", confirm: true }, actor);
    await expect(setClassroomActive(f.room.id, { active: false, confirmed: true }, actor)).resolves.toMatchObject({ active: false });
  });

  it("ne crée qu’une réservation lors de créations simultanées fixe/provisoire", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      fixed(f),
      createAgendaSession(input(f, { teacherId: f.otherTeacher.id }), actor),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("ne crée qu’une série lors de programmations fixes concurrentes incompatibles", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([fixed(f), fixed(f, { teacherId: f.otherTeacher.id })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("matérialise une occurrence une seule fois lors d’actions concurrentes", async () => {
    const f = await fixture();
    const series = await fixed(f);
    await Promise.allSettled([
      changeAgendaStatus(idOf(series), { status: "EN_COURS", confirm: true }, actor),
      changeAgendaStatus(idOf(series), { status: "EN_COURS", confirm: true }, actor),
    ]);
    const stored = await database.teachingSession.findMany({ where: { recurrenceId: series.recurrenceId, occurrenceWeek: new Date(monday) } });
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("EN_COURS");
  });
});
