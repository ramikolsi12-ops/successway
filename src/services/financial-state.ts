import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { summarizeFinance } from "@/lib/finance";
import { money } from "@/lib/money";
import { tunisDate } from "@/lib/dates";
import { BusinessError } from "@/lib/business-error";
import type { Transaction } from "@/services/management-shared";
import type { AllocationDetail, FinancialAudit, FinancialCharge, FinancialPayment } from "@/types/payments";

const chargeRelations = { session: { include: { classroom: true } }, allocations: { include: { payment: true } } } satisfies Prisma.SessionChargeInclude;
const paymentRelations = { teacher: true, recordedBy: { select: { displayName: true } }, replacement: { select: { id: true } },
  allocations: { include: { charge: { include: { session: { include: { classroom: true } } } } } } } satisfies Prisma.ProfessorPaymentInclude;
type Charge = Prisma.SessionChargeGetPayload<{ include: typeof chargeRelations }>;
type Receipt = Prisma.ProfessorPaymentGetPayload<{ include: typeof paymentRelations }>;
type Reader = Pick<Transaction, "sessionCharge" | "professorPayment" | "teachingSession" | "auditLog">;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

function allocationRow(allocation: { id: string; paymentId: string; chargeId: string; amount: Prisma.Decimal; voidedAt: Date | null; voidReason: string | null; createdAt: Date }, payment: Pick<Receipt, "paymentDate" | "amount" | "voidedAt" | "teacherId">, charge: Pick<Charge, "amount" | "session" | "voidedAt" | "teacherId">): AllocationDetail {
  return { id: allocation.id, paymentId: allocation.paymentId, chargeId: allocation.chargeId, amount: allocation.amount.toFixed(3),
    paymentDate: dateOnly(payment.paymentDate), paymentAmount: payment.amount.toFixed(3),
    sessionDate: tunisDate(charge.session.startAt).format("YYYY-MM-DD"), sessionStartAt: charge.session.startAt.toISOString(), sessionEndAt: charge.session.endAt.toISOString(),
    sessionPrice: charge.amount.toFixed(3), classroomName: charge.session.classroom.name,
    valid: !allocation.voidedAt && !payment.voidedAt && !charge.voidedAt && charge.session.status === "TERMINEE" && payment.teacherId === charge.teacherId,
    voidReason: allocation.voidReason, createdAt: allocation.createdAt.toISOString() };
}

type AuditRecord = { id: string; action: string; reason: string | null; before: unknown; after: unknown; createdAt: Date };
const auditRow = (log: AuditRecord): FinancialAudit => ({ id: log.id, action: log.action, reason: log.reason, before: publicAudit(log.before), after: publicAudit(log.after), createdAt: log.createdAt.toISOString() });

function chargeRow(charge: Charge, history: FinancialAudit[]): FinancialCharge {
  const allocations = charge.allocations.map(item => allocationRow(item, item.payment, charge));
  const valid = allocations.filter(item => item.valid);
  const paid = valid.reduce((total, item) => total.plus(item.amount), money("0"));
  const remaining = charge.amount.minus(paid);
  const status = remaining.isZero() ? "PAYEE" : paid.isZero() ? "NON_PAYEE" : "PARTIELLE";
  const completedDate = tunisDate(charge.session.completedAt ?? charge.chargedAt).format("YYYY-MM-DD");
  return { id: charge.id, sessionId: charge.sessionId, agendaId: charge.session.recurrenceId && charge.session.occurrenceWeek
    ? `${charge.session.recurrenceId}@${dateOnly(charge.session.occurrenceWeek)}` : charge.sessionId,
    teacherId: charge.teacherId, sessionDate: tunisDate(charge.session.startAt).format("YYYY-MM-DD"), startAt: charge.session.startAt.toISOString(), endAt: charge.session.endAt.toISOString(),
    classroomName: charge.session.classroom.name, type: charge.session.recurrenceId ? "FIXE" : "PROVISOIRE", amount: charge.amount.toFixed(3), pricingSource: charge.pricingSource,
    paid: paid.toFixed(3), remaining: remaining.toFixed(3), status, allocations, history,
    settledDate: status === "PAYEE" ? [completedDate, ...valid.map(item => item.paymentDate)].sort().at(-1)! : null };
}

/** Details for visible completed sessions; does not read unrelated receipts or history. */
export async function readSessionFinancialDetails(reader: Pick<Reader, "sessionCharge" | "auditLog">, sessionIds: string[]): Promise<FinancialCharge[]> {
  if (!sessionIds.length) return [];
  const charges = await reader.sessionCharge.findMany({ where: { sessionId: { in: [...new Set(sessionIds)] }, voidedAt: null, session: { status: "TERMINEE" } },
    include: chargeRelations, orderBy: [{ session: { startAt: "asc" } }, { id: "asc" }] });
  if (!charges.length) return [];
  const logs = await reader.auditLog.findMany({ where: { entityType: "SessionCharge", entityId: { in: charges.map(charge => charge.id) } }, orderBy: { createdAt: "asc" } });
  const histories = new Map<string, FinancialAudit[]>();
  for (const log of logs) {
    if (!histories.has(log.entityId)) histories.set(log.entityId, []);
    histories.get(log.entityId)!.push(auditRow(log));
  }
  return charges.map(charge => chargeRow(charge, histories.get(charge.id) ?? []));
}

export async function readFinancialState(reader: Reader, teacherId?: string, options: { reallocating?: boolean } = {}) {
  const allCharges = await reader.sessionCharge.findMany({ where: { teacherId }, include: chargeRelations, orderBy: [{ session: { startAt: "asc" } }, { id: "asc" }] });
  const allPayments = await reader.professorPayment.findMany({ where: { teacherId }, include: paymentRelations, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const completed = await reader.teachingSession.findMany({ where: { teacherId, status: "TERMINEE" }, select: { id: true, teacherId: true, rateSnapshot: true } });
  const charges = allCharges.filter(charge => !charge.voidedAt && charge.session.status === "TERMINEE");
  const receipts = allPayments.filter(payment => !payment.voidedAt);
  const validPayments = new Set(receipts.map(payment => payment.id));
  const issues: string[] = [];
  for (const charge of allCharges) if (!charge.voidedAt && charge.session.status !== "TERMINEE") issues.push("Une charge historique est liée à une séance non terminée.");
  const chargedSessions = new Set(charges.map(charge => charge.sessionId));
  for (const session of completed) if (!chargedSessions.has(session.id)) issues.push(`La séance terminée ${session.id} ne possède pas de charge valide. Un rapprochement historique est nécessaire.`);
  for (const charge of charges) if (charge.teacherId !== charge.session.teacherId || !charge.session.rateSnapshot?.eq(charge.amount)) issues.push(`La charge ${charge.id} ne correspond pas au tarif historique de la séance.`);
  for (const charge of charges) for (const allocation of charge.allocations) {
    if (!allocation.voidedAt && !allocation.payment.voidedAt && allocation.payment.teacherId !== charge.teacherId) issues.push("Une affectation relie deux professeurs différents.");
  }
  for (const payment of receipts) for (const allocation of payment.allocations) {
    if (!allocation.voidedAt && !allocation.charge.voidedAt && allocation.charge.teacherId !== payment.teacherId) issues.push("Un paiement est affecté à la séance d’un autre professeur.");
  }
  if (!options.reallocating) for (const payment of receipts) {
    const assigned = payment.allocations.filter(item => !item.voidedAt && !item.charge.voidedAt && item.charge.session.status === "TERMINEE" && item.charge.teacherId === payment.teacherId)
      .reduce((total, item) => total.plus(item.amount), money("0"));
    if (!assigned.eq(payment.amount)) issues.push(`Le paiement ${payment.id} n’est pas entièrement affecté à des séances terminées. Un rapprochement historique est nécessaire.`);
  }
  const allocationInputs = charges.flatMap(charge => charge.allocations.filter(item => !item.voidedAt && validPayments.has(item.paymentId)).map(item => ({ chargeId: charge.id, paymentId: item.paymentId, amount: item.amount.toFixed(3) })));
  const summary = (id?: string) => {
    const selectedCharges = charges.filter(value => !id || value.teacherId === id);
    const selectedPayments = receipts.filter(value => !id || value.teacherId === id);
    try {
      return summarizeFinance(selectedCharges.map(value => ({ id: value.id, amount: value.amount.toFixed(3) })),
        selectedPayments.map(value => ({ id: value.id, amount: value.amount.toFixed(3), paymentDate: dateOnly(value.paymentDate) })), allocationInputs);
    } catch {
      throw new BusinessError("Les écritures historiques présentent une affectation incohérente. Un rapprochement financier est nécessaire avant toute opération.", 409);
    }
  };
  const ids = [...allPayments.map(payment => payment.id), ...allCharges.map(charge => charge.id)];
  const logs = ids.length ? await reader.auditLog.findMany({ where: { entityType: { in: ["ProfessorPayment", "SessionCharge"] }, entityId: { in: ids } }, orderBy: { createdAt: "asc" } }) : [];
  const chargeRows: FinancialCharge[] = charges.map(charge => chargeRow(charge, logs.filter(log => log.entityType === "SessionCharge" && log.entityId === charge.id).map(auditRow)));
  const paymentRows: FinancialPayment[] = allPayments.map(payment => {
    const allocations = payment.allocations.map(item => allocationRow(item, payment, item.charge));
    const allocated = allocations.filter(item => item.valid).reduce((total, item) => total.plus(item.amount), money("0"));
    return { id: payment.id, teacherId: payment.teacherId, teacherName: `${payment.teacher.firstName} ${payment.teacher.lastName}`,
      amount: payment.amount.toFixed(3), paymentDate: dateOnly(payment.paymentDate), notes: payment.notes,
      createdAt: payment.createdAt.toISOString(), recordedBy: payment.recordedBy?.displayName ?? null, valid: !payment.voidedAt,
      voidedAt: payment.voidedAt?.toISOString() ?? null, voidReason: payment.voidReason, replacesId: payment.replacesId,
      replacementId: payment.replacement?.id ?? null, allocated: allocated.toFixed(3),
      allocations, history: logs.filter(log => log.entityId === payment.id || log.entityId === payment.replacesId || log.entityId === payment.replacement?.id).map(auditRow) };
  });
  return { allCharges, allPayments, charges, receipts, completed, issues, allocationInputs, chargeRows, paymentRows, summary };
}

/** Keep the immutable database audit while exposing only current public fields. */
function publicAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicAudit);
  if (value === null || typeof value !== "object") return value;
  const publicKeys = new Set(["amount", "paymentDate", "notes", "replacementId", "sessionId", "pricingSource", "priceOverride", "status", "timestamp", "teacherId",
    "totalDue", "totalReceived", "remaining", "paidSessions", "partiallyPaidSessions", "unpaidSessions", "lastPaymentDate", "cancelled", "financialSummary", "hasEntries", "result", "id"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => publicKeys.has(key))
    .map(([key, child]) => [key, publicAudit(child)]));
}
export type FinancialState = Awaited<ReturnType<typeof readFinancialState>>;
export function assertFinancialIntegrity(state: FinancialState) {
  if (state.issues.length) throw new BusinessError("Un rapprochement financier est nécessaire avant cette opération. Aucune écriture historique n’a été modifiée.", 409, { integrityIssues: state.issues });
  state.summary();
}
