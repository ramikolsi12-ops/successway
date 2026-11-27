import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Teacher, type ProfessorRateAgreement } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { allocateFifo, type FifoCharge, type FifoPayment } from "@/lib/fifo";
import { money } from "@/lib/money";
import { summarizeCentre, summarizeFinance } from "@/lib/finance";
import { tunisDate } from "@/lib/dates";
import { BusinessError } from "@/lib/business-error";
import { paymentCancelSchema, paymentCommandSchema, paymentCorrectionPreviewSchema, paymentCorrectionSchema, paymentInputSchema } from "@/validations/payments";
import { dateOnlySchema, uuidSchema } from "@/validations/management";
import { z } from "@/validations/locale";
import { assertFinancialIntegrity, readFinancialState, type FinancialState } from "@/services/financial-state";
import { missingRecord, type Actor, type Transaction } from "@/services/management-shared";
import type { PaymentInput, PaymentPreview, CorrectionPreview, PaymentOverview, ProfessorFinance, AllocationPreviewRow } from "@/types/payments";
import type { ProfessorRow } from "@/types/management";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const day = (date: Date) => date.toISOString().slice(0, 10);
export const auditContext = async (tx: Transaction, id: string) => { await tx.$queryRaw`SELECT set_config('app.financial_audit',${id},true)`; };

export async function financialTransaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
        return operation(tx);
      }, { timeout: 30000, maxWait: 15000 });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || ["40001", "40P01"].includes(String(error.meta?.code)));
      if (retryable && attempt < 2) continue;
      throw error;
    }
  }
}

export async function recordedCommand(tx: Transaction, key: string, action: string, request: unknown) {
  const existing = await tx.auditLog.findUnique({ where: { id: key } });
  if (!existing) return null;
  const after = existing.after as { requestHash?: string; result?: { id: string } } | null;
  if (existing.action !== action || after?.requestHash !== hash(request) || !after?.result?.id) throw new BusinessError("Cet identifiant d’opération a déjà été utilisé pour une autre demande.", 409);
  return after.result;
}

export async function commandAudit(tx: Transaction, actor: Actor, data: {
  key: string; action: string; entityType: string; entityId: string; request: unknown;
  reason?: string | null; before?: unknown; after?: Record<string, unknown>; result: { id: string };
}) {
  await tx.auditLog.create({ data: { id: data.key, adminId: actor.id, action: data.action, entityType: data.entityType,
    entityId: data.entityId, reason: data.reason, before: data.before === undefined ? undefined : json(data.before),
    after: json({ ...data.after, requestHash: hash(data.request), result: data.result }) } });
}

function professorRow(teacher: Teacher & { agreements: ProfessorRateAgreement[] }, state: FinancialState): ProfessorRow {
  const today = tunisDate().format("YYYY-MM-DD");
  const current = teacher.agreements.find(rate => rate.active && day(rate.startDate) <= today && (!rate.endDate || day(rate.endDate) >= today));
  return { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName, fullName: `${teacher.firstName} ${teacher.lastName}`,
    phone: teacher.phone, email: teacher.email, address: teacher.address, notes: teacher.notes, active: teacher.active,
    createdAt: teacher.createdAt.toISOString(), currentPrice: current?.pricePerSession.toFixed(3) ?? null,
    completedSessions: state.completed.filter(session => session.teacherId === teacher.id).length, finance: state.summary(teacher.id) };
}

export async function getPaymentsOverview(): Promise<PaymentOverview> {
  return db.$transaction(async tx => {
    const state = await readFinancialState(tx);
    const teachers = await tx.teacher.findMany({ include: { agreements: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
    const professors = teachers.map(teacher => professorRow(teacher, state));
    const aggregate = summarizeCentre(professors.map(professor => professor.finance));
    return { professors, payments: state.paymentRows, integrityIssues: state.issues,
      totals: { ...aggregate, paidSessions: professors.reduce((n, value) => n + value.finance.paidSessions, 0),
        sessionsToSettle: aggregate.unpaidSessions + aggregate.partiallyPaidSessions,
        professorsWithDebt: professors.filter(value => money(value.finance.remaining).gt(0)).length } };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function getProfessorFinance(id: string): Promise<ProfessorFinance> {
  uuidSchema.parse(id);
  return db.$transaction(async tx => {
    const teacher = await tx.teacher.findUnique({ where: { id }, include: { agreements: true } });
    if (!teacher) missingRecord("Professeur");
    const state = await readFinancialState(tx, id);
    const professor = professorRow(teacher, state);
    return { professor, summary: professor.finance, charges: state.chargeRows, payments: state.paymentRows,
      completedSessions: state.completed.length, sessionsToSettle: professor.finance.unpaidSessions + professor.finance.partiallyPaidSessions, integrityIssues: state.issues };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function getPayment(id: string) {
  uuidSchema.parse(id);
  const payment = await db.professorPayment.findUnique({ where: { id }, select: { teacherId: true } });
  if (!payment) missingRecord("Paiement");
  return (await getProfessorFinance(payment.teacherId)).payments.find(value => value.id === id)!;
}

export function financeArrays(state: FinancialState) {
  return {
    charges: state.charges.map(value => ({ id: value.id, amount: value.amount.toFixed(3), startAt: value.session.startAt.toISOString() })),
    payments: state.receipts.map(value => ({ id: value.id, amount: value.amount.toFixed(3), paymentDate: day(value.paymentDate), createdAt: value.createdAt.toISOString() })),
  };
}

export function previewFinancialChange(state: FinancialState, teacherId: string, kind: string, request: unknown,
  charges: FifoCharge[], payments: FifoPayment[], newPaymentId?: string): PaymentPreview {
  const due = charges.reduce((total, charge) => total.plus(charge.amount), money("0"));
  const received = payments.reduce((total, payment) => total.plus(payment.amount), money("0"));
  if (received.gt(due)) throw new BusinessError("Cette correction créerait un montant reçu supérieur aux charges existantes. Elle est refusée pour conserver les encaissements ; vérifiez les écritures concernées.", 409);
  const plan = allocateFifo(charges, payments);
  const after = summarizeFinance(charges, payments, plan);
  const before = state.summary();
  const paidByCharge = new Map<string, Prisma.Decimal>();
  const newByCharge = new Map<string, Prisma.Decimal>();
  for (const item of plan) {
    paidByCharge.set(item.chargeId, (paidByCharge.get(item.chargeId) ?? money("0")).plus(item.amount));
    if (item.paymentId === newPaymentId) newByCharge.set(item.chargeId, money(item.amount));
  }
  const allocations: AllocationPreviewRow[] = [];
  for (const charge of charges) {
    const previous = state.chargeRows.find(value => value.id === charge.id);
    const paid = paidByCharge.get(charge.id) ?? money("0");
    const wasPaid = money(previous?.paid ?? "0");
    const newlyAllocated = newPaymentId ? newByCharge.get(charge.id) ?? money("0") : paid.minus(wasPaid);
    if (paid.eq(wasPaid) && newlyAllocated.isZero() && previous?.amount === charge.amount) continue;
    const remaining = money(charge.amount).minus(paid);
    allocations.push({ chargeId: charge.id, sessionDate: tunisDate(charge.startAt).format("YYYY-MM-DD"), startAt: charge.startAt,
      amount: charge.amount, previouslyPaid: wasPaid.toFixed(3), allocated: newlyAllocated.toFixed(3), remaining: remaining.toFixed(3),
      status: remaining.isZero() ? "PAYEE" : paid.isZero() ? "NON_PAYEE" : "PARTIELLE" });
  }
  const token = hash({ teacherId, kind, request, state: {
    charges: state.charges.map(value => [value.id, value.amount.toFixed(3), value.pricingSource, value.session.startAt.toISOString()]),
    payments: state.receipts.map(value => [value.id, value.amount.toFixed(3), day(value.paymentDate), value.createdAt.toISOString()]),
    allocations: [...state.allocationInputs].sort((a, b) => a.chargeId.localeCompare(b.chargeId) || a.paymentId.localeCompare(b.paymentId)),
  } });
  return { token, teacherId, before, after, allocations, additionalPaidSessions: Math.max(0, after.paidSessions - before.paidSessions),
    sessionsToSettle: after.unpaidSessions + after.partiallyPaidSessions };
}

function paymentPreview(state: FinancialState, data: PaymentInput, createdAt = new Date()) {
  const remaining = money(state.summary().remaining);
  if (remaining.isZero()) throw new BusinessError("Ce professeur n'a aucun montant à régler.", 409);
  if (money(data.amount).gt(remaining)) throw new BusinessError(`Le montant du paiement ne peut pas dépasser le reste à encaisser de ${remaining.toFixed(3)} DT.`, 409);
  const arrays = financeArrays(state);
  return previewFinancialChange(state, data.teacherId, "PAYMENT", data, arrays.charges,
    [...arrays.payments, { id: "new-payment", amount: money(data.amount).toFixed(3), paymentDate: data.paymentDate, createdAt: createdAt.toISOString() }], "new-payment");
}

export function assertPreview(token: string, preview: PaymentPreview) {
  if (token !== preview.token) throw new BusinessError("La situation financière a changé. Vérifiez le nouvel aperçu puis confirmez à nouveau.", 409, { preview });
}

async function professorState(tx: Transaction, teacherId: string) {
  if (!await tx.teacher.findUnique({ where: { id: teacherId }, select: { id: true } })) missingRecord("Professeur");
  const state = await readFinancialState(tx, teacherId);
  assertFinancialIntegrity(state);
  return state;
}

export async function previewPayment(input: unknown) {
  const data = paymentInputSchema.parse(input);
  return db.$transaction(async tx => paymentPreview(await professorState(tx, data.teacherId), data), { isolationLevel: "RepeatableRead", timeout: 20000 });
}

/** Reverse old links, never delete them; the original receipts remain unchanged. */
export async function reverseAllocations(tx: Transaction, teacherId: string, actor: Actor, reason: string) {
  const id = randomUUID();
  const count = await tx.paymentAllocation.count({ where: { voidedAt: null, payment: { teacherId } } });
  await tx.auditLog.create({ data: { id, adminId: actor.id, action: "REALLOCATION_FIFO", entityType: "Teacher", entityId: teacherId,
    reason, before: { affectationsValides: count }, after: { teacherId } } });
  await auditContext(tx, id);
  await tx.paymentAllocation.updateMany({ where: { voidedAt: null, payment: { teacherId } }, data: { voidedAt: new Date(), voidReason: reason } });
  return id;
}

export async function allocatePaymentsToCharges(tx: Transaction, teacherId: string, revisionId: string) {
  const state = await readFinancialState(tx, teacherId, { reallocating: true });
  assertFinancialIntegrity(state);
  const { charges, payments } = financeArrays(state);
  const plan = allocateFifo(charges, payments);
  for (const item of plan) await tx.paymentAllocation.create({ data: { ...item, amount: money(item.amount),
    idempotencyKey: `fifo:${revisionId}:${item.paymentId}:${item.chargeId}` } });
}

export async function rebalanceProfessor(tx: Transaction, teacherId: string, actor: Actor, reason: string) {
  const revision = await reverseAllocations(tx, teacherId, actor, reason);
  await allocatePaymentsToCharges(tx, teacherId, revision);
}

export async function recordPayment(input: unknown, actor: Actor) {
  const data = paymentCommandSchema.parse(input);
  const fields = paymentInputSchema.parse({ teacherId: data.teacherId, amount: data.amount, paymentDate: data.paymentDate, notes: data.notes });
  const request = { ...fields, amount: money(fields.amount).toFixed(3) };
  return financialTransaction(async tx => {
    const previous = await recordedCommand(tx, data.idempotencyKey, "ENREGISTREMENT_PAIEMENT", request);
    if (previous) return previous;
    const state = await professorState(tx, data.teacherId);
    const createdAt = new Date();
    assertPreview(data.previewToken, paymentPreview(state, fields, createdAt));
    const id = randomUUID();
    await commandAudit(tx, actor, { key: data.idempotencyKey, action: "ENREGISTREMENT_PAIEMENT", entityType: "ProfessorPayment", entityId: id,
      request, before: state.summary(), after: { ...request }, result: { id } });
    await tx.professorPayment.create({ data: { id, teacherId: data.teacherId, amount: money(data.amount), paymentDate: new Date(`${data.paymentDate}T00:00:00Z`),
      method: "ESPECES", reference: null, notes: data.notes, recordedById: actor.id, idempotencyKey: data.idempotencyKey, createdAt } });
    await rebalanceProfessor(tx, data.teacherId, actor, "Répartition automatique après enregistrement d’un paiement.");
    return { id };
  });
}

function correctionPreview(state: FinancialState, id: string, data: ReturnType<typeof paymentCorrectionPreviewSchema.parse>, createdAt = new Date()): CorrectionPreview {
  const target = state.receipts.find(value => value.id === id);
  if (!target) throw new BusinessError("Ce paiement est déjà annulé ou corrigé. Consultez son historique.", 409);
  const arrays = financeArrays(state);
  const payments = arrays.payments.filter(value => value.id !== id);
  if (data.kind === "PAYMENT") payments.push({ id: "replacement-payment", amount: money(data.amount).toFixed(3), paymentDate: data.paymentDate, createdAt: createdAt.toISOString() });
  return { ...previewFinancialChange(state, target.teacherId, data.kind, { id, ...data }, arrays.charges, payments), targetId: id, kind: data.kind };
}

export async function previewPaymentCorrection(id: string, input: unknown) {
  uuidSchema.parse(id);
  const data = paymentCorrectionPreviewSchema.parse(input);
  return db.$transaction(async tx => {
    const payment = await tx.professorPayment.findUnique({ where: { id }, select: { teacherId: true } });
    if (!payment) missingRecord("Paiement");
    return correctionPreview(await professorState(tx, payment.teacherId), id, data);
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function correctPayment(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = paymentCorrectionSchema.parse(input);
  const fields = paymentCorrectionPreviewSchema.parse({ amount: data.amount, paymentDate: data.paymentDate, notes: data.notes, reason: data.reason, kind: "PAYMENT" });
  const request = { id, ...fields, amount: money(data.amount).toFixed(3) };
  return financialTransaction(async tx => {
    const replay = await recordedCommand(tx, data.idempotencyKey, "CORRECTION_PAIEMENT", request);
    if (replay) return replay;
    const original = await tx.professorPayment.findUnique({ where: { id } });
    if (!original) missingRecord("Paiement");
    const state = await professorState(tx, original.teacherId);
    const createdAt = new Date();
    assertPreview(data.previewToken, correctionPreview(state, id, fields, createdAt));
    const replacementId = randomUUID();
    await commandAudit(tx, actor, { key: data.idempotencyKey, action: "CORRECTION_PAIEMENT", entityType: "ProfessorPayment", entityId: id, reason: data.reason,
      request, before: { amount: original.amount.toFixed(3), paymentDate: day(original.paymentDate), method: original.method, reference: original.reference, notes: original.notes },
      after: { amount: money(data.amount).toFixed(3), paymentDate: data.paymentDate, replacementId }, result: { id: replacementId } });
    const revision = await reverseAllocations(tx, original.teacherId, actor, `Correction du paiement : ${data.reason}`);
    await auditContext(tx, data.idempotencyKey);
    await tx.professorPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: data.reason } });
    await tx.professorPayment.create({ data: { id: replacementId, teacherId: original.teacherId, amount: money(data.amount), paymentDate: new Date(`${data.paymentDate}T00:00:00Z`),
      method: "ESPECES", reference: null, notes: data.notes, recordedById: actor.id, replacesId: id, idempotencyKey: data.idempotencyKey, createdAt } });
    await allocatePaymentsToCharges(tx, original.teacherId, revision);
    return { id: replacementId };
  });
}

export async function cancelPayment(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = paymentCancelSchema.parse(input);
  const request = { id, reason: data.reason };
  return financialTransaction(async tx => {
    const replay = await recordedCommand(tx, data.idempotencyKey, "ANNULATION_PAIEMENT", request);
    if (replay) return replay;
    const original = await tx.professorPayment.findUnique({ where: { id } });
    if (!original) missingRecord("Paiement");
    const state = await professorState(tx, original.teacherId);
    assertPreview(data.previewToken, correctionPreview(state, id, { kind: "CANCELLATION", reason: data.reason }));
    await commandAudit(tx, actor, { key: data.idempotencyKey, action: "ANNULATION_PAIEMENT", entityType: "ProfessorPayment", entityId: id, reason: data.reason,
      request, before: { amount: original.amount.toFixed(3), paymentDate: day(original.paymentDate) }, after: { cancelled: true }, result: { id } });
    const revision = await reverseAllocations(tx, original.teacherId, actor, `Annulation du paiement : ${data.reason}`);
    await auditContext(tx, data.idempotencyKey);
    await tx.professorPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: data.reason } });
    await allocatePaymentsToCharges(tx, original.teacherId, revision);
    return { id };
  });
}

export async function getFinancialPeriod(input: unknown) {
  const data = z.object({ from: dateOnlySchema, to: dateOnlySchema, teacherId: uuidSchema.optional() })
    .refine(value => value.to >= value.from, "La fin de période doit être postérieure au début.").parse(input);
  return db.$transaction(async tx => {
    const state = await readFinancialState(tx, data.teacherId);
    assertFinancialIntegrity(state);
    const summaries = new Map<string, ReturnType<typeof state.summary>>();
    for (const id of new Set([...state.charges.map(value => value.teacherId), ...state.receipts.map(value => value.teacherId)])) summaries.set(id, state.summary(id));
    const totals = summarizeCentre([...summaries.values()]);
    const cashReceived = state.receipts.filter(payment => day(payment.paymentDate) >= data.from && day(payment.paymentDate) <= data.to)
      .reduce((total, payment) => total.plus(payment.amount), money("0")).toFixed(3);
    const chargesCompleted = state.charges.filter(charge => {
      const date = tunisDate(charge.session.completedAt ?? charge.chargedAt).format("YYYY-MM-DD");
      return date >= data.from && date <= data.to;
    }).reduce((total, charge) => total.plus(charge.amount), money("0")).toFixed(3);
    return { from: data.from, to: data.to, cashReceived, chargesCompleted, currentRemaining: totals.remaining };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
