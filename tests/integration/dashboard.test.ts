import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));
vi.mock("@/server/authorization", () => ({ requireAdministrator: vi.fn(async () => ({ displayName: "Administrateur de vérification" })) }));

import { db as serviceDatabase } from "@/server/db";
import { getDashboard } from "@/services/dashboard";
import { readMonthlyFinancialOverview, financialLedger } from "@/services/financial-read";
import { readFinancialState } from "@/services/financial-state";
import { cancelPayment, getProfessorFinance, previewPayment, previewPaymentCorrection, recordPayment } from "@/services/payments";
import { createAgendaSession } from "@/services/agenda";
import { dashboardMonth } from "@/lib/dashboard";
import { atTunis } from "@/lib/scheduling";
import { money } from "@/lib/money";

const database = testDatabase();
const month = "2024-02";
let actor: { id: string };
beforeAll(async () => { actor = { id: (await database.adminUser.findFirstOrThrow()).id }; });
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

async function fixture() {
  const suffix = randomUUID();
  const teacher = await database.teacher.create({ data: { firstName: "Tableau", lastName: suffix, phone: "20000000" } });
  const room = await database.classroom.create({ data: { name: `Tableau ${suffix}` } });
  await database.professorRateAgreement.create({ data: { teacherId: teacher.id, pricePerSession: "999.000", startDate: new Date("2020-01-01") } });
  return { teacher, room };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function charge(f: Fixture, amount: string, date: string, time = "08:00") {
  return database.$transaction(async tx => {
    const startAt = atTunis(date, time);
    const session = await tx.teachingSession.create({ data: { teacherId: f.teacher.id, classroomId: f.room.id,
      startAt, endAt: new Date(startAt.getTime() + 30 * 60_000), status: "TERMINEE", rateSnapshot: amount,
      priceOverride: amount, rateOverrideReason: "Tarif exceptionnel de vérification", completedAt: new Date() } });
    return tx.sessionCharge.create({ data: { teacherId: f.teacher.id, sessionId: session.id, amount,
      pricingSource: "EXCEPTIONNEL", chargedAt: new Date(), idempotencyKey: randomUUID() } });
  });
}
async function pay(f: Fixture, amount: string, paymentDate: string) {
  const fields = { teacherId: f.teacher.id, amount, paymentDate, notes: null };
  const preview = await previewPayment(fields);
  return recordPayment({ ...fields, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
}
function overview(selectedMonth = month) {
  const period = dashboardMonth(selectedMonth);
  return database.$transaction(tx => readMonthlyFinancialOverview(tx, period.startDate, period.endDate), { isolationLevel: "RepeatableRead" });
}

describe("Tableau de bord mensuel", () => {
  it("conserve les prix historiques, règlements partiels, charges nulles et exclusions des paiements annulés", async () => {
    const f = await fixture(), boundary = await fixture();
    await charge(f, "20.100", "2024-02-10");
    await charge(f, "15.200", "2024-02-11");
    await charge(f, "30.300", "2024-02-12");
    await charge(boundary, "0.000", "2024-02-10");
    await charge(boundary, "12.345", "2024-02-11");
    const beforeCash = (await getDashboard(month)).cashReceived;
    await pay(f, "35.600", "2024-02-20");
    const cancelled = await pay(f, "5.000", "2024-02-21");
    const reason = "Encaissement annulé pour vérification du mois";
    const preview = await previewPaymentCorrection(cancelled.id, { kind: "CANCELLATION", reason });
    await cancelPayment(cancelled.id, { reason, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    const aggregate = await overview();
    for (const professor of [f, boundary]) {
      const detailed = await getProfessorFinance(professor.teacher.id);
      const ledger = await financialLedger(professor.teacher.id);
      expect(aggregate.globalSummaries.get(professor.teacher.id)).toEqual(detailed.summary);
      expect(aggregate.summaries.get(professor.teacher.id)).toEqual(ledger.summary(professor.teacher.id));
    }
    expect(aggregate.summaries.get(f.teacher.id)).toMatchObject({ totalDue: "65.600", totalReceived: "35.600", remaining: "30.000", paidSessions: 2, partiallyPaidSessions: 1, unpaidSessions: 0, lastPaymentDate: "2024-02-20" });
    expect(aggregate.summaries.get(boundary.teacher.id)).toMatchObject({ totalDue: "12.345", totalReceived: "0.000", paidSessions: 1, unpaidSessions: 1 });
    expect(aggregate.issues).toEqual([]);
    expect((await getDashboard(month)).cashReceived).toBe(money(beforeCash).plus("35.600").toFixed(3));
    expect((await database.professorPayment.findUniqueOrThrow({ where: { id: cancelled.id } })).voidedAt).not.toBeNull();
  });

  it("sépare les encaissements datés du mois des allocations aux séances de ce mois et préserve le FIFO global", async () => {
    const f = await fixture();
    await charge(f, "20.000", "2024-01-31", "23:30");
    await charge(f, "30.000", "2024-02-01", "00:00");
    await charge(f, "40.000", "2024-03-01", "00:00");
    const beforeFebruary = (await overview()).cashReceived;
    const beforeMarch = (await overview("2024-03")).cashReceived;
    await pay(f, "15.000", "2024-02-10");
    await pay(f, "25.000", "2024-03-10");
    const february = await overview(), march = await overview("2024-03"), january = await overview("2024-01");
    expect(february.summaries.get(f.teacher.id)).toMatchObject({ totalDue: "30.000", totalReceived: "20.000", remaining: "10.000", partiallyPaidSessions: 1, lastPaymentDate: "2024-02-10" });
    expect(march.summaries.get(f.teacher.id)).toMatchObject({ totalDue: "40.000", totalReceived: "0.000", remaining: "40.000", unpaidSessions: 1 });
    expect(january.summaries.get(f.teacher.id)).toMatchObject({ totalDue: "20.000", totalReceived: "20.000", remaining: "0.000", paidSessions: 1, lastPaymentDate: null });
    expect(february.cashReceived).toBe(money(beforeFebruary).plus("15.000").toFixed(3));
    expect(march.cashReceived).toBe(money(beforeMarch).plus("25.000").toFixed(3));
    const dashboard = await getDashboard(month);
    const debtor = dashboard.debtProfessors.find(row => row.id === f.teacher.id);
    expect(debtor?.monthFinance.remaining).toBe("10.000");
    expect(debtor?.finance.remaining).toBe("50.000");
    expect(dashboard).not.toHaveProperty("chart");
    expect(dashboard).not.toHaveProperty("todayStatuses");
    expect(dashboard).not.toHaveProperty("occupiedRooms");
  });

  it("filtre selon le début local de la séance et inclut exactement les bornes de février bissextile", async () => {
    const f = await fixture();
    const january = await charge(f, "5.000", "2024-01-31", "23:30");
    const first = await charge(f, "10.000", "2024-02-01", "00:00");
    const last = await charge(f, "20.000", "2024-02-29", "23:30");
    const march = await charge(f, "40.000", "2024-03-01", "00:00");
    expect((await overview()).summaries.get(f.teacher.id)).toMatchObject({ totalDue: "30.000", unpaidSessions: 2 });
    const dashboard = await getDashboard(month);
    const ids = dashboard.sessions.map(session => session.id);
    expect(ids).toContain(first.sessionId); expect(ids).toContain(last.sessionId);
    expect(ids).not.toContain(january.sessionId); expect(ids).not.toContain(march.sessionId);
    expect(dashboard).toMatchObject({ month, startDate: "2024-02-01", endDate: "2024-02-29" });
  });

  it("respecte le fuseau de Tunis aussi pour les limites des anciens mois avec heure d’été", async () => {
    const f = await fixture();
    await charge(f, "4.000", "2007-03-31", "23:30");
    await charge(f, "7.000", "2007-04-01", "00:00");
    expect((await overview("2007-03")).summaries.get(f.teacher.id)?.totalDue).toBe("4.000");
    expect((await overview("2007-04")).summaries.get(f.teacher.id)?.totalDue).toBe("7.000");
  });

  it("regroupe les occurrences fixes et statuts du mois sans changer les séances des autres mois", async () => {
    const f = await fixture();
    const before = await getDashboard(month);
    const fixed = await createAgendaSession({ teacherId: f.teacher.id, classroomId: f.room.id, date: "2024-01-29", startTime: "08:00", endTime: "09:00", type: "FIXE", weekday: 1, recurrenceStartDate: "2024-01-29", recurrenceEndDate: "2024-02-12", notes: null }, actor);
    await createAgendaSession({ teacherId: f.teacher.id, classroomId: f.room.id, date: "2024-02-29", startTime: "10:00", endTime: "11:00", type: "PROVISOIRE", notes: null }, actor);
    for (const [index, status] of (["EN_COURS", "ABSENT", "ANNULEE"] as const).entries()) {
      const startAt = atTunis(`2024-02-${13 + index}`, "09:00");
      await database.teachingSession.create({ data: { teacherId: f.teacher.id, classroomId: f.room.id, startAt, endAt: new Date(startAt.getTime() + 30 * 60_000), status } });
    }
    const after = await getDashboard(month);
    expect(after.sessionsCount).toBe(before.sessionsCount + 6);
    expect(after.statuses).toEqual({ planned: before.statuses.planned + 3, running: before.statuses.running + 1,
      completed: before.statuses.completed, absent: before.statuses.absent + 1, cancelled: before.statuses.cancelled + 1 });
    expect(after.roomsUsed).toBe(before.roomsUsed + 1);
    expect(after.scheduledProfessors).toBe(before.scheduledProfessors + 1);
    expect(after.sessions.filter(session => session.id.startsWith(fixed.recurrenceId!)).map(session => session.date)).toEqual(["2024-02-05", "2024-02-12"]);
    expect(after.sessions.every(session => session.date.startsWith(month))).toBe(true);
    expect(after.sessions.every((session, index, rows) => index === 0 || `${rows[index - 1].date} ${rows[index - 1].time.split("–")[0]}` <= `${session.date} ${session.time.split("–")[0]}`)).toBe(true);
  });

  it("affiche un mois vide sans reprendre les totaux des autres mois", async () => {
    const empty = await getDashboard("1900-02");
    expect(empty.sessionsCount).toBe(0); expect(empty.sessions).toEqual([]); expect(empty.debtProfessors).toEqual([]);
    expect(empty.cashReceived).toBe("0.000");
    expect(empty.finance).toMatchObject({ totalDue: "0.000", totalReceived: "0.000", remaining: "0.000", paidSessions: 0, unpaidSessions: 0 });
    expect(empty.statuses).toEqual({ planned: 0, running: 0, completed: 0, absent: 0, cancelled: 0 });
  });

  it("signale toujours les charges manquantes sans inventer de montant mensuel", async () => {
    const f = await fixture();
    const rollback = new Error("Annulation volontaire du seul scénario incohérent");
    await expect(database.$transaction(async tx => {
      const startAt = atTunis("2024-02-16", "08:00");
      await tx.teachingSession.create({ data: { teacherId: f.teacher.id, classroomId: f.room.id, startAt, endAt: new Date(startAt.getTime() + 30 * 60_000),
        status: "TERMINEE", rateSnapshot: "20.000", priceOverride: "20.000", rateOverrideReason: "Tarif exceptionnel de vérification", completedAt: new Date() } });
      const aggregated = await readMonthlyFinancialOverview(tx, "2024-02-01", "2024-02-29");
      const detailed = await readFinancialState(tx, f.teacher.id);
      expect(aggregated.summaries.get(f.teacher.id)?.totalDue).toBe("0.000");
      expect(aggregated.completedCounts.get(f.teacher.id)).toBe(1);
      expect(aggregated.issues.some(issue => issue.includes("sans charge valide"))).toBe(true);
      expect(detailed.issues).toHaveLength(1);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await database.teachingSession.count({ where: { teacherId: f.teacher.id } })).toBe(0);
  });
});
