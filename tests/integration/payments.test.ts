import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertTestDatabase, testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));

import { db as serviceDatabase } from "@/server/db";
import { changeAgendaStatus, correctSessionPrice, createAgendaSession, getAgenda, previewSessionPrice, updateAgendaSession } from "@/services/agenda";
import { cancelPayment, correctPayment, getFinancialPeriod, getPayment, getPaymentsOverview, getProfessorFinance, previewPayment, previewPaymentCorrection, recordPayment } from "@/services/payments";
import { createRateAgreement } from "@/services/pricing";
import { addDays, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";
import { money } from "@/lib/money";
import type { SessionInput } from "@/types/agenda";
import type { PaymentCommand, PaymentInput } from "@/types/payments";

const database = testDatabase();
const today = tunisDate().format("YYYY-MM-DD");
const monday = addDays(weekMonday(today), 14);
let actor: { id: string };

beforeAll(async () => { actor = { id: (await database.adminUser.findFirstOrThrow()).id }; });
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

async function fixture(price: string | null = "20.000") {
  const suffix = randomUUID().slice(0, 8);
  const teacher = await database.teacher.create({ data: { firstName: "Finance", lastName: suffix, phone: "20000000" } });
  const room = await database.classroom.create({ data: { name: `Paiements ${suffix}` } });
  const agreement = price === null ? null : await database.professorRateAgreement.create({ data: {
    teacherId: teacher.id, pricePerSession: price, startDate: new Date("2020-01-01T00:00:00Z"),
  } });
  return { teacher, room, agreement };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, overrides: Partial<SessionInput> = {}): SessionInput {
  return { teacherId: f.teacher.id, classroomId: f.room.id, date: monday, startTime: "08:00", endTime: "10:00", type: "PROVISOIRE", notes: null, ...overrides };
}
async function completed(f: Fixture, overrides: Partial<SessionInput> = {}) {
  const session = await createAgendaSession(input(f, overrides), actor);
  return changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true, idempotencyKey: randomUUID() }, actor);
}
function paymentInput(f: Fixture, amount: string, overrides: Partial<PaymentInput> = {}): PaymentInput {
  return { teacherId: f.teacher.id, amount, paymentDate: today, notes: null, ...overrides };
}
async function command(f: Fixture, amount: string, overrides: Partial<PaymentInput> = {}): Promise<PaymentCommand> {
  const data = paymentInput(f, amount, overrides);
  const preview = await previewPayment(data);
  return { ...data, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true };
}
async function pay(f: Fixture, amount: string, overrides: Partial<PaymentInput> = {}) {
  return recordPayment(await command(f, amount, overrides), actor);
}
async function finance(f: Fixture) {
  const value = await getProfessorFinance(f.teacher.id);
  expect(value.integrityIssues).toEqual([]);
  expectCurrentContract(value);
  for (const receipt of value.payments.filter(payment => payment.valid)) {
    expect(receipt.allocated).toBe(receipt.amount);
    expect(receipt.allocations.filter(allocation => allocation.valid).reduce((total, allocation) => total.plus(allocation.amount), money("0")).toFixed(3)).toBe(receipt.amount);
  }
  return { ...value, charges: [...value.charges].sort((a, b) => a.startAt.localeCompare(b.startAt)) };
}

function expectCurrentContract(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const obsolete = ["credit", "unallocated", "netBalance", "currentCredit", "method", "reference", "paymentMethod"];
  for (const [key, child] of Object.entries(value)) {
    expect(obsolete, `Ancien champ présent dans la réponse : ${key}`).not.toContain(key);
    expectCurrentContract(child);
  }
}

describe("Tarification individuelle et historique", () => {
  it("refuse un prix de finalisation devenu obsolète après un changement de convention", async () => {
    const f = await fixture();
    const session = await createAgendaSession(input(f), actor);
    await createRateAgreement(f.teacher.id, { pricePerSession: "25.000", startDate: monday, closePrevious: true }, actor);
    await expect(changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true, priceOverride: null, expectedPrice: "20.000" }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await database.sessionCharge.count({ where: { sessionId: session.sessionId! } })).toBe(0);
    expect((await database.teachingSession.findUniqueOrThrow({ where: { id: session.sessionId! } })).status).toBe("PLANIFIEE");
    expect((await changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true, priceOverride: null, expectedPrice: "25.000" }, actor)).rateSnapshot).toBe("25.000");
  });

  it("limite le prix exceptionnel saisi à la création fixe à la première occurrence", async () => {
    const f = await fixture();
    const first = await createAgendaSession(input(f, { type: "FIXE", weekday: 1, recurrenceStartDate: monday,
      recurrenceEndDate: null, priceOverride: "15.000" }), actor);
    expect(first).toMatchObject({ defaultRate: "20.000", priceOverride: "15.000", expectedPrice: "15.000", pricingSource: "EXCEPTIONNEL" });
    expect((await getAgenda(monday)).events.find(event => event.recurrenceId === first.recurrenceId)).toMatchObject({ priceOverride: "15.000", expectedPrice: "15.000" });
    for (const date of [addDays(monday, 7), addDays(monday, 14)]) {
      expect((await getAgenda(date)).events.find(event => event.recurrenceId === first.recurrenceId)).toMatchObject({
        defaultRate: "20.000", priceOverride: null, expectedPrice: "20.000", pricingSource: "HABITUEL",
      });
    }
    expect(await database.teachingSession.count({ where: { recurrenceId: first.recurrenceId } })).toBe(1);
  });

  it("isole le tarif d’une occurrence fixe, puis restaure son héritage", async () => {
    const f = await fixture();
    const first = await createAgendaSession(input(f, { type: "FIXE", weekday: 1, recurrenceStartDate: monday, recurrenceEndDate: null }), actor);
    expect(first).toMatchObject({ defaultRate: "20.000", priceOverride: null, expectedPrice: "20.000" });
    const secondDate = addDays(monday, 7);
    const second = (await getAgenda(secondDate)).events.find(event => event.recurrenceId === first.recurrenceId)!;
    const exceptional = await updateAgendaSession(second.id, input(f, { type: "FIXE", date: secondDate, priceOverride: "15.000" }), actor);
    expect(exceptional).toMatchObject({ priceOverride: "15.000", expectedPrice: "15.000", pricingSource: "EXCEPTIONNEL" });
    expect((await getAgenda(addDays(monday, 14))).events.find(event => event.recurrenceId === first.recurrenceId)).toMatchObject({ priceOverride: null, expectedPrice: "20.000" });
    const restored = await updateAgendaSession(second.id, input(f, { type: "FIXE", date: secondDate, priceOverride: null }), actor);
    expect(restored).toMatchObject({ priceOverride: null, expectedPrice: "20.000", pricingSource: "HABITUEL" });
    expect(await database.teachingSession.count({ where: { recurrenceId: first.recurrenceId, occurrenceWeek: new Date(secondDate) } })).toBe(1);
    expect((await database.professorRateAgreement.findUniqueOrThrow({ where: { id: f.agreement!.id } })).pricePerSession.toFixed(3)).toBe("20.000");
  });

  it("applique le tarif effectif à la date réelle et conserve le prix des séances terminées", async () => {
    const f = await fixture();
    const first = await completed(f);
    const effectiveDate = addDays(monday, 7);
    await createRateAgreement(f.teacher.id, { pricePerSession: "25.000", startDate: effectiveDate, endDate: null, closePrevious: true, notes: null }, actor);
    const short = await completed(f, { date: addDays(monday, 1), endTime: "09:00" });
    const later = await completed(f, { date: effectiveDate, endTime: "09:30" });
    expect(first.rateSnapshot).toBe("20.000");
    expect(short.rateSnapshot).toBe("20.000");
    expect(later.rateSnapshot).toBe("25.000");
    expect((await database.teachingSession.findUniqueOrThrow({ where: { id: first.sessionId! } })).rateSnapshot?.toFixed(3)).toBe("20.000");
    expect((await finance(f)).charges.map(charge => charge.amount)).toEqual(["20.000", "20.000", "25.000"]);
  });

  it("crée, modifie et retire le tarif exceptionnel d’une séance provisoire", async () => {
    const f = await fixture();
    const session = await createAgendaSession(input(f, { priceOverride: "30.125" }), actor);
    expect(session).toMatchObject({ expectedPrice: "30.125", priceOverride: "30.125" });
    const changed = await updateAgendaSession(session.id, input(f, { priceOverride: "35.250" }), actor);
    expect(changed.expectedPrice).toBe("35.250");
    const restored = await updateAgendaSession(session.id, input(f, { priceOverride: null }), actor);
    expect(restored).toMatchObject({ expectedPrice: "20.000", priceOverride: null });
    const final = await changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true, priceOverride: "17.125" }, actor);
    expect(final).toMatchObject({ rateSnapshot: "17.125", chargeAmount: "17.125", pricingSource: "EXCEPTIONNEL" });
    expect((await finance(f)).charges[0]).toMatchObject({ amount: "17.125", pricingSource: "EXCEPTIONNEL" });
  });

  it("exige une décision lors d’un changement de professeur avec un tarif exceptionnel", async () => {
    const f = await fixture();
    const other = await fixture("25.000");
    const session = await createAgendaSession(input(f, { priceOverride: "30.000" }), actor);
    await expect(updateAgendaSession(session.id, input(f, { teacherId: other.teacher.id, priceOverride: "30.000" }), actor)).rejects.toMatchObject({ status: 409 });
    const kept = await updateAgendaSession(session.id, input(f, { teacherId: other.teacher.id, priceOverride: "30.000", overrideDecision: "KEEP" }), actor);
    expect(kept).toMatchObject({ defaultRate: "25.000", priceOverride: "30.000", expectedPrice: "30.000" });
    const restored = await updateAgendaSession(session.id, input(f, { priceOverride: "30.000", overrideDecision: "RESTORE" }), actor);
    expect(restored).toMatchObject({ defaultRate: "20.000", priceOverride: null, expectedPrice: "20.000" });
  });

  it("autorise une séance exceptionnellement tarifée sans convention et refuse une fin sans prix", async () => {
    const f = await fixture(null);
    const session = await createAgendaSession(input(f), actor);
    await expect(changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await database.sessionCharge.count({ where: { teacherId: f.teacher.id } })).toBe(0);
    const done = await changeAgendaStatus(session.id, { status: "TERMINEE", confirm: true, priceOverride: "12.345" }, actor);
    expect(done.rateSnapshot).toBe("12.345");
    expect((await finance(f)).summary.totalDue).toBe("12.345");
  });

  it("ne crée aucune charge pour les séances prévues, en cours, absentes ou annulées", async () => {
    const f = await fixture();
    for (const [offset, status] of ["PLANIFIEE", "EN_COURS", "ABSENT", "ANNULEE"].entries()) {
      const session = await createAgendaSession(input(f, { date: addDays(monday, offset) }), actor);
      if (status !== "PLANIFIEE") await changeAgendaStatus(session.id, { status, confirm: true }, actor);
    }
    expect(await database.sessionCharge.count({ where: { teacherId: f.teacher.id } })).toBe(0);
    expect((await finance(f)).summary).toMatchObject({ totalDue: "0.000", unpaidSessions: 0, paidSessions: 0 });
  });
});

describe("Encaissements et affectation automatique FIFO", () => {
  it("règle une séance en deux paiements, en conservant les dates et le détail", async () => {
    const f = await fixture();
    await completed(f);
    const first = await pay(f, "15.000", { paymentDate: addDays(today, -1), notes: "Premier versement" });
    expect((await finance(f)).charges[0]).toMatchObject({ amount: "20.000", paid: "15.000", remaining: "5.000", status: "PARTIELLE" });
    await pay(f, "5.000");
    const state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "20.000", totalReceived: "20.000", remaining: "0.000", paidSessions: 1 });
    expect(state.charges[0]).toMatchObject({ paid: "20.000", remaining: "0.000", status: "PAYEE" });
    expect(state.charges[0].allocations.filter(allocation => allocation.valid)).toHaveLength(2);
    expect(state.payments.find(payment => payment.id === first.id)).toMatchObject({ notes: "Premier versement", paymentDate: addDays(today, -1) });
    expect(await database.professorPayment.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ method: "ESPECES", reference: null, notes: "Premier versement" });
    expect(state.payments.every(payment => payment.recordedBy !== null)).toBe(true);
  });

  it("règle vingt séances à 20 DT, corrige 210 en 200 DT, puis termine par 30 et 160 DT", async () => {
    const f = await fixture();
    for (let index = 0; index < 20; index++) await completed(f, { date: addDays(monday, index) });
    const preview = await previewPayment(paymentInput(f, "210.000"));
    expect(preview.after).toMatchObject({ totalDue: "400.000", totalReceived: "210.000", paidSessions: 10, partiallyPaidSessions: 1, unpaidSessions: 9, remaining: "190.000" });
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
    let receipt = await recordPayment({ ...paymentInput(f, "210.000"), previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    let state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "210.000", paidSessions: 10, partiallyPaidSessions: 1, unpaidSessions: 9, remaining: "190.000" });
    expect(state.charges[10]).toMatchObject({ paid: "10.000", remaining: "10.000", status: "PARTIELLE" });
    const correction = { amount: "200.000", paymentDate: today, notes: null, reason: "Montant reçu corrigé de 210 à 200 DT" };
    const correctionPreview = await previewPaymentCorrection(receipt.id, { ...correction, kind: "PAYMENT" });
    receipt = await correctPayment(receipt.id, { ...correction, previewToken: correctionPreview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "200.000", paidSessions: 10, partiallyPaidSessions: 0, unpaidSessions: 10, remaining: "200.000" });
    expect(state.charges.slice(10).every(charge => charge.paid === "0.000" && charge.status === "NON_PAYEE")).toBe(true);
    // Restore the original acceptance scenario using an audited replacement,
    // rather than creating another set of twenty completed sessions.
    const restoration = { ...correction, amount: "210.000", reason: "Montant rétabli à 210 DT après vérification" };
    const restorationPreview = await previewPaymentCorrection(receipt.id, { ...restoration, kind: "PAYMENT" });
    await correctPayment(receipt.id, { ...restoration, previewToken: restorationPreview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    await pay(f, "30.000");
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "240.000", paidSessions: 12, partiallyPaidSessions: 0, unpaidSessions: 8, remaining: "160.000" });
    await pay(f, "160.000");
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "400.000", paidSessions: 20, remaining: "0.000" });
    expect(state.payments.filter(payment => payment.valid)).toHaveLength(3);
    expect(state.payments.filter(payment => !payment.valid)).toHaveLength(2);
    expect(state.charges.every(charge => charge.status === "PAYEE")).toBe(true);
  }, 60000);

  it("emploie les prix réels 20/15/30/20/25 et laisse les nouvelles charges impayées", async () => {
    const f = await fixture();
    for (const [offset, amount] of ["20.000", "15.000", "30.000", "20.000", "25.000"].entries()) {
      await completed(f, { date: addDays(monday, offset), priceOverride: amount === "20.000" ? null : amount });
    }
    await pay(f, "50.000");
    let state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "110.000", totalReceived: "50.000", remaining: "60.000", paidSessions: 2, partiallyPaidSessions: 1, unpaidSessions: 2 });
    expect(state.sessionsToSettle).toBe(3);
    expect(state.charges.map(charge => charge.paid)).toEqual(["20.000", "15.000", "15.000", "0.000", "0.000"]);
    await pay(f, "60.000");
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "110.000", paidSessions: 5, remaining: "0.000" });
    await expect(pay(f, "40.000")).rejects.toMatchObject({ status: 409, message: "Ce professeur n'a aucun montant à régler." });
    await completed(f, { date: addDays(monday, 5), priceOverride: "30.000" });
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "110.000", remaining: "30.000", paidSessions: 5, unpaidSessions: 1 });
    await completed(f, { date: addDays(monday, 6) });
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "110.000", totalDue: "160.000", remaining: "50.000", paidSessions: 5, unpaidSessions: 2 });
    expect(state.charges.slice(5).map(charge => ({ paid: charge.paid, status: charge.status }))).toEqual([{ paid: "0.000", status: "NON_PAYEE" }, { paid: "0.000", status: "NON_PAYEE" }]);
    expect(state.payments).toHaveLength(2);
  }, 60000);

  it("priorise la date de séance, même lorsque les séances ont été terminées dans l’ordre inverse", async () => {
    const f = await fixture();
    await completed(f, { date: addDays(monday, 1) });
    await completed(f);
    await pay(f, "25.000");
    const state = await finance(f);
    expect(state.charges.map(charge => charge.paid)).toEqual(["20.000", "5.000"]);
    await pay(f, "5.000");
    expect((await finance(f)).charges.map(charge => charge.paid)).toEqual(["20.000", "10.000"]);
  });

  it("accepte les paiements des professeurs inactifs et calcule exactement les millimes", async () => {
    const f = await fixture("0.300");
    await completed(f);
    await database.teacher.update({ where: { id: f.teacher.id }, data: { active: false } });
    await pay(f, "0.100");
    await pay(f, "0.200");
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "0.300", remaining: "0.000", paidSessions: 1 });
  });

  it("considère une charge nulle comme réglée sans paiement", async () => {
    const f = await fixture();
    await completed(f, { priceOverride: "0.000" });
    const state = await finance(f);
    expect(state.charges[0]).toMatchObject({ amount: "0.000", paid: "0.000", remaining: "0.000", status: "PAYEE" });
    expect(state.summary.paidSessions).toBe(1);
    expect(state.payments).toHaveLength(0);
  });

  it("refuse un paiement sans séance terminée et ne réaffecte rien lors d’une finalisation", async () => {
    const f = await fixture();
    await expect(previewPayment(paymentInput(f, "40.000"))).rejects.toMatchObject({ status: 409, message: "Ce professeur n'a aucun montant à régler." });
    await expect(recordPayment({ ...paymentInput(f, "40.000"), previewToken: "0".repeat(64), idempotencyKey: randomUUID(), confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await finance(f)).summary).toMatchObject({ totalDue: "0.000", totalReceived: "0.000", remaining: "0.000" });
    await completed(f, { priceOverride: "30.000" });
    const state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "30.000", totalReceived: "0.000", remaining: "30.000", unpaidSessions: 1 });
    expect(state.payments).toHaveLength(0);
    expect(await database.paymentAllocation.count({ where: { charge: { teacherId: f.teacher.id } } })).toBe(0);
  });

  it("filtre les encaissements par date de paiement et les charges par date de fin effective", async () => {
    const f = await fixture();
    await completed(f);
    await completed(f, { date: addDays(monday, 1) });
    await pay(f, "5.000", { paymentDate: addDays(today, -1) });
    await pay(f, "15.000");
    expect(await getFinancialPeriod({ from: today, to: today, teacherId: f.teacher.id })).toMatchObject({
      from: today, to: today, cashReceived: "15.000", chargesCompleted: "40.000", currentRemaining: "20.000",
    });
    expect(await getFinancialPeriod({ from: addDays(today, -1), to: addDays(today, -1), teacherId: f.teacher.id })).toMatchObject({
      cashReceived: "5.000", chargesCompleted: "0.000", currentRemaining: "20.000",
    });
  });

  it("préserve séparément les soldes des professeurs dans la vue globale", async () => {
    const debtor = await fixture();
    const settled = await fixture();
    const before = await getPaymentsOverview();
    await completed(debtor);
    await completed(settled);
    await pay(settled, "20.000");
    const after = await getPaymentsOverview();
    expect(after.professors.find(professor => professor.id === debtor.teacher.id)?.finance).toMatchObject({ remaining: "20.000", totalReceived: "0.000" });
    expect(after.professors.find(professor => professor.id === settled.teacher.id)?.finance).toMatchObject({ remaining: "0.000", totalReceived: "20.000" });
    expect(after.totals.remaining).toBe(money(before.totals.remaining).plus("20.000").toFixed(3));
    expect(after.totals.totalReceived).toBe(money(before.totals.totalReceived).plus("20.000").toFixed(3));
    expectCurrentContract(after);
    expect(after.totals.professorsWithDebt).toBe(before.totals.professorsWithDebt + 1);
    expect(after.integrityIssues).toEqual([]);
  });
});

describe("Corrections financières auditables", () => {
  it("autorise une hausse historique mais refuse une baisse créant un trop-perçu", async () => {
    const f = await fixture();
    const session = await completed(f);
    await pay(f, "20.000");
    const reason = "Correction du tarif de la séance déjà réglée";
    const preview = await previewSessionPrice(session.id, { amount: "30.000", reason });
    await correctSessionPrice(session.id, { amount: "30.000", reason, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    let state = await finance(f);
    expect(state.charges).toHaveLength(1);
    expect(state.charges[0]).toMatchObject({ amount: "30.000", paid: "20.000", remaining: "10.000", status: "PARTIELLE" });
    expect(state.summary).toMatchObject({ totalReceived: "20.000", remaining: "10.000" });
    await pay(f, "10.000");
    expect((await finance(f)).charges[0]).toMatchObject({ paid: "30.000", remaining: "0.000", status: "PAYEE" });
    await expect(previewSessionPrice(session.id, { amount: "20.000", reason })).rejects.toMatchObject({ status: 409 });
    await expect(correctSessionPrice(session.id, { amount: "20.000", reason, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    state = await finance(f);
    expect(state.charges).toHaveLength(1);
    expect(state.charges[0]).toMatchObject({ amount: "30.000", paid: "30.000", remaining: "0.000", status: "PAYEE" });
    expect(state.summary).toMatchObject({ totalDue: "30.000", totalReceived: "30.000", remaining: "0.000" });
    expect(state.payments.filter(payment => payment.valid)).toHaveLength(2);
  });

  it("refuse les aperçus de correction périmés après un autre encaissement sans modifier l’historique", async () => {
    const f = await fixture();
    const session = await completed(f);
    const receipt = await pay(f, "10.000");
    const fields = { amount: "5.000", paymentDate: today, notes: null, reason: "Montant reçu corrigé après vérification" };
    const stalePayment = await previewPaymentCorrection(receipt.id, { ...fields, kind: "PAYMENT" });
    const reason = "Tarif corrigé après vérification";
    const stalePrice = await previewSessionPrice(session.id, { amount: "30.000", reason });
    await pay(f, "10.000");
    const paymentCommand = { ...fields, previewToken: stalePayment.token, idempotencyKey: randomUUID(), confirm: true };
    const priceCommand = { amount: "30.000", reason, previewToken: stalePrice.token, idempotencyKey: randomUUID(), confirm: true };
    await expect(correctPayment(receipt.id, paymentCommand, actor)).rejects.toMatchObject({ status: 409 });
    await expect(correctSessionPrice(session.id, priceCommand, actor)).rejects.toMatchObject({ status: 409 });
    let state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "20.000", totalReceived: "20.000", remaining: "0.000", paidSessions: 1 });
    expect(state.payments).toHaveLength(2);
    expect(state.payments.every(payment => payment.valid && payment.amount === "10.000")).toBe(true);
    expect(await database.auditLog.count({ where: { id: { in: [paymentCommand.idempotencyKey, priceCommand.idempotencyKey] } } })).toBe(0);
    const freshPayment = await previewPaymentCorrection(receipt.id, { ...fields, kind: "PAYMENT" });
    await correctPayment(receipt.id, { ...paymentCommand, previewToken: freshPayment.token }, actor);
    const freshPrice = await previewSessionPrice(session.id, { amount: "30.000", reason });
    await correctSessionPrice(session.id, { ...priceCommand, previewToken: freshPrice.token }, actor);
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "30.000", totalReceived: "15.000", remaining: "15.000", partiallyPaidSessions: 1 });
  });

  it("corrige puis annule un paiement tout en conservant les anciennes écritures", async () => {
    const f = await fixture();
    await completed(f);
    await completed(f, { date: addDays(monday, 1) });
    const receipt = await pay(f, "30.000");
    const correction = { amount: "10.000", paymentDate: today, notes: null, reason: "Montant reçu corrigé" };
    const preview = await previewPaymentCorrection(receipt.id, { ...correction, kind: "PAYMENT" });
    await correctPayment(receipt.id, { ...correction, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    let state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "10.000", remaining: "30.000", partiallyPaidSessions: 1, unpaidSessions: 1 });
    expect(state.charges.map(charge => charge.paid)).toEqual(["10.000", "0.000"]);
    expect(state.payments.find(payment => payment.id === receipt.id)).toMatchObject({ valid: false, voidReason: correction.reason });
    const replacement = state.payments.find(payment => payment.valid)!;
    expect(replacement).toMatchObject({ replacesId: receipt.id, amount: "10.000" });
    expect(state.payments.find(payment => payment.id === receipt.id)?.replacementId).toBe(replacement.id);
    expect(await database.paymentAllocation.count({ where: { paymentId: receipt.id, voidedAt: { not: null } } })).toBeGreaterThan(0);
    const reason = "Paiement annulé à la demande";
    const cancellation = await previewPaymentCorrection(replacement.id, { kind: "CANCELLATION", reason });
    const cancellationCommand = { reason, previewToken: cancellation.token, idempotencyKey: randomUUID(), confirm: true };
    await cancelPayment(replacement.id, cancellationCommand, actor);
    await cancelPayment(replacement.id, cancellationCommand, actor);
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalReceived: "0.000", remaining: "40.000", unpaidSessions: 2 });
    expect(state.payments).toHaveLength(2);
    expect(state.payments.every(payment => !payment.valid)).toBe(true);
    expect(await database.auditLog.count({ where: { entityType: "ProfessorPayment", entityId: { in: [receipt.id, replacement.id] } } })).toBeGreaterThanOrEqual(3);
  });

  it("réaffecte les paiements après diminution et augmentation d’un prix historique", async () => {
    const f = await fixture();
    const first = await completed(f);
    await completed(f, { date: addDays(monday, 1) });
    await pay(f, "30.000");
    const reason = "Tarif exceptionnel confirmé après règlement";
    let preview = await previewSessionPrice(first.id, { amount: "10.000", reason });
    await correctSessionPrice(first.id, { amount: "10.000", reason, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    let state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "30.000", totalReceived: "30.000", remaining: "0.000", paidSessions: 2 });
    expect(state.charges.map(charge => charge.paid)).toEqual(["10.000", "20.000"]);
    preview = await previewSessionPrice(first.id, { amount: "25.000", reason });
    await correctSessionPrice(first.id, { amount: "25.000", reason, previewToken: preview.token, idempotencyKey: randomUUID(), confirm: true }, actor);
    state = await finance(f);
    expect(state.summary).toMatchObject({ totalDue: "45.000", totalReceived: "30.000", remaining: "15.000", paidSessions: 1, partiallyPaidSessions: 1 });
    expect(state.charges.map(charge => charge.paid)).toEqual(["25.000", "5.000"]);
    expect((await database.teachingSession.findUniqueOrThrow({ where: { id: first.sessionId! } })).rateSnapshot?.toFixed(3)).toBe("25.000");
    expect((await database.professorRateAgreement.findUniqueOrThrow({ where: { id: f.agreement!.id } })).pricePerSession.toFixed(3)).toBe("20.000");
    expect(state.payments.filter(payment => payment.valid)).toHaveLength(1);
    await expect(previewSessionPrice(first.id, { amount: "0.000", reason })).rejects.toMatchObject({ status: 409 });
    expect((await finance(f)).summary).toMatchObject({ totalDue: "45.000", totalReceived: "30.000", remaining: "15.000", paidSessions: 1 });
    await expect(database.teachingSession.update({ where: { id: first.sessionId! }, data: { rateSnapshot: "99.000" } })).rejects.toThrow();
  });
});

describe("Intégrité et concurrence des encaissements", () => {
  it("impose aussi en base une affectation complète et la limite des charges existantes", async () => {
    const f = await fixture();
    await completed(f);
    await expect(database.professorPayment.create({ data: { teacherId: f.teacher.id, amount: "1.000", paymentDate: new Date(`${today}T00:00:00Z`), idempotencyKey: randomUUID() } })).rejects.toThrow();
    await expect(database.professorPayment.create({ data: { teacherId: f.teacher.id, amount: "20.001", paymentDate: new Date(`${today}T00:00:00Z`), idempotencyKey: randomUUID() } })).rejects.toThrow();
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "0.000", remaining: "20.000" });
  });

  it("plafonne tout paiement au solde réel et accepte exactement le reste", async () => {
    const f = await fixture();
    await completed(f);
    await expect(previewPayment(paymentInput(f, "20.001"))).rejects.toMatchObject({ status: 409, message: "Le montant du paiement ne peut pas dépasser le reste à encaisser de 20.000 DT." });
    await expect(recordPayment({ ...paymentInput(f, "25.000"), previewToken: "0".repeat(64), idempotencyKey: randomUUID(), confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
    const receipt = await pay(f, "20.000");
    expect((await finance(f)).summary).toMatchObject({ remaining: "0.000", paidSessions: 1 });
    await expect(previewPayment(paymentInput(f, "0.001"))).rejects.toMatchObject({ message: "Ce professeur n'a aucun montant à régler." });
    expectCurrentContract(await getPayment(receipt.id));
  });

  it("n’accepte ni choix de mode ni référence facultative dans les entrées de paiement", async () => {
    const f = await fixture();
    await completed(f);
    for (const extra of [{ method: "VIREMENT" }, { method: "ESPECES" }, { reference: "REF-INTERDITE" }]) {
      await expect(previewPayment({ ...paymentInput(f, "5.000"), ...extra })).rejects.toThrow();
    }
    const receipt = await pay(f, "5.000");
    const fields = { amount: "6.000", paymentDate: today, notes: null, reason: "Vérification de saisie" };
    await expect(previewPaymentCorrection(receipt.id, { ...fields, kind: "PAYMENT", method: "AUTRE" })).rejects.toThrow();
    await expect(previewPaymentCorrection(receipt.id, { ...fields, kind: "PAYMENT", reference: "REF-INTERDITE" })).rejects.toThrow();
    const stored = await database.professorPayment.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(stored.method).toBe("ESPECES");
    expect(stored.reference).toBeNull();
  });

  it("sérialise les paiements concurrents pour ne jamais dépasser le reste dû", async () => {
    const f = await fixture();
    await completed(f);
    const first = await command(f, "15.000");
    const second = await command(f, "15.000");
    const results = await Promise.allSettled([recordPayment(first, actor), recordPayment(second, actor)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "15.000", remaining: "5.000" });
    await pay(f, "5.000");
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "20.000", remaining: "0.000" });
  });

  it("refuse une correction de paiement qui produirait des fonds non affectables", async () => {
    const f = await fixture();
    await completed(f);
    const receipt = await pay(f, "10.000");
    const data = { amount: "20.001", paymentDate: today, notes: null, reason: "Montant corrigé trop élevé" };
    await expect(previewPaymentCorrection(receipt.id, { ...data, kind: "PAYMENT" })).rejects.toMatchObject({ status: 409 });
    await expect(correctPayment(receipt.id, { ...data, previewToken: "0".repeat(64), idempotencyKey: randomUUID(), confirm: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "10.000", remaining: "10.000" });
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(1);
  });

  it("refuse les paiements nuls, négatifs, trop précis et datés dans le futur", async () => {
    const f = await fixture();
    for (const amount of ["0.000", "-1.000", "0.0001"]) await expect(previewPayment(paymentInput(f, amount))).rejects.toThrow();
    await expect(previewPayment(paymentInput(f, "10.000", { paymentDate: addDays(today, 1) }))).rejects.toThrow();
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
  });

  it("une double fin de séance concurrente crée une seule charge", async () => {
    const f = await fixture();
    const session = await createAgendaSession(input(f), actor);
    const data = { status: "TERMINEE" as const, confirm: true, idempotencyKey: randomUUID() };
    await Promise.all([changeAgendaStatus(session.id, data, actor), changeAgendaStatus(session.id, data, actor)]);
    expect(await database.sessionCharge.count({ where: { sessionId: session.sessionId! } })).toBe(1);
    expect((await finance(f)).summary.totalDue).toBe("20.000");
  });

  it("rend une double soumission concurrente idempotente", async () => {
    const f = await fixture();
    await completed(f);
    const data = await command(f, "15.000");
    const [first, second] = await Promise.all([recordPayment(data, actor), recordPayment(data, actor)]);
    expect(first.id).toBe(second.id);
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "15.000", remaining: "5.000" });
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(1);
    await expect(database.professorPayment.update({ where: { id: first.id }, data: { amount: "16.000" } })).rejects.toThrow();
    await expect(recordPayment({ ...data, amount: "16.000" }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("refuse un aperçu périmé et réessaie proprement deux encaissements concurrents", async () => {
    const f = await fixture();
    for (let index = 0; index < 3; index++) await completed(f, { date: addDays(monday, index) });
    const first = await command(f, "20.000");
    const second = await command(f, "20.000");
    const outcomes = await Promise.allSettled([recordPayment(first, actor), recordPayment(second, actor)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const failed = outcomes.find(outcome => outcome.status === "rejected");
    expect(failed).toMatchObject({ reason: { status: 409 } });
    await pay(f, "20.000");
    expect((await finance(f)).summary).toMatchObject({ totalReceived: "40.000", totalDue: "60.000", remaining: "20.000", paidSessions: 2 });
  });

  it("invalide l’aperçu quand une nouvelle charge apparaît sans enregistrer le paiement", async () => {
    const f = await fixture();
    await completed(f);
    const data = await command(f, "20.000");
    await completed(f, { date: addDays(monday, 1) });
    await expect(recordPayment(data, actor)).rejects.toMatchObject({ status: 409 });
    expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
  });

  it("empêche les affectations supplémentaires et les affectations entre professeurs en base", async () => {
    const f = await fixture();
    const other = await fixture();
    await completed(f);
    await completed(other);
    const receipt = await pay(f, "5.000");
    const firstCharge = (await finance(f)).charges[0];
    const otherCharge = (await finance(other)).charges[0];
    await expect(database.paymentAllocation.create({ data: { paymentId: receipt.id, chargeId: firstCharge.id, amount: "20.000", idempotencyKey: randomUUID() } })).rejects.toThrow();
    await expect(database.paymentAllocation.create({ data: { paymentId: receipt.id, chargeId: otherCharge.id, amount: "1.000", idempotencyKey: randomUUID() } })).rejects.toThrow();
    expect((await finance(f)).summary.totalReceived).toBe("5.000");
    expect((await finance(other)).summary.totalReceived).toBe("0.000");
  });

  it("annule le paiement entier si l’insertion de son affectation échoue", async () => {
    assertTestDatabase();
    const f = await fixture();
    await completed(f);
    const marker = `rollback-${randomUUID()}`;
    const data = await command(f, "10.000", { notes: marker });
    const identifier = `phase4_failure_${randomUUID().replaceAll("-", "")}`;
    // Scoped failure injection exists only in the explicitly guarded disposable
    // test database, and is always removed even when the assertion fails.
    await database.$executeRawUnsafe(`CREATE FUNCTION "${identifier}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "ProfessorPayment" WHERE id=NEW."paymentId" AND notes='${marker}') THEN RAISE EXCEPTION 'Allocation volontairement refusée pour le test'; END IF; RETURN NEW; END; $$`);
    try {
      await database.$executeRawUnsafe(`CREATE TRIGGER "${identifier}" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION "${identifier}"()`);
      try {
        await expect(recordPayment(data, actor)).rejects.toThrow();
        expect(await database.professorPayment.count({ where: { teacherId: f.teacher.id } })).toBe(0);
        expect((await finance(f)).summary).toMatchObject({ totalReceived: "0.000", remaining: "20.000" });
      } finally { await database.$executeRawUnsafe(`DROP TRIGGER "${identifier}" ON "PaymentAllocation"`); }
    } finally { await database.$executeRawUnsafe(`DROP FUNCTION "${identifier}"()`); }
  });
});
