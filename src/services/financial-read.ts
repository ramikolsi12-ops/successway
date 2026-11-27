import "server-only";
import { db } from "@/server/db";
import { readFinancialState } from "@/services/financial-state";
import type { ChargeRow, FinanceSummary } from "@/types/management";
import { summarizeCentre } from "@/lib/finance";
import { money } from "@/lib/money";
import { BusinessError } from "@/lib/business-error";
import { addDays, atTunis } from "@/lib/scheduling";
import { dateOnlySchema } from "@/validations/management";
import type { Transaction } from "@/services/management-shared";

/** Compatibility projection shared by the existing professor/dashboard views. */
export async function financialLedger(teacherId?: string) {
  const state = await db.$transaction(tx => readFinancialState(tx, teacherId), { isolationLevel: "RepeatableRead", timeout: 20000 });
  const chargeRows: ChargeRow[] = state.chargeRows.map(charge => ({ id: charge.id, sessionId: charge.sessionId, sessionDate: charge.startAt,
    amount: charge.amount, paid: charge.paid, remaining: charge.remaining, status: charge.status as ChargeRow["status"] }));
  return { ...state, chargeRows, paymentRows: state.paymentRows.filter(payment => payment.valid) };
}

/** Dashboard projection: historical amounts and valid allocations, without detail or audit graphs. */
export async function readFinancialOverview(reader: Pick<Transaction, "$queryRaw">, cashFrom: string, cashTo: string) {
  type Aggregate = { teacherId: string; totalDue: string; totalReceived: string; paidSessions: number; partiallyPaidSessions: number; unpaidSessions: number; completedSessions: number; entries: number; lastPaymentDate: string | null };
  const rows = await reader.$queryRaw<Aggregate[]>`
    WITH paid AS (
      SELECT a."chargeId", SUM(a.amount) AS amount FROM "PaymentAllocation" a
      JOIN "ProfessorPayment" p ON p.id=a."paymentId" AND p."voidedAt" IS NULL
      JOIN "SessionCharge" c ON c.id=a."chargeId" AND c."teacherId"=p."teacherId"
      WHERE a."voidedAt" IS NULL GROUP BY a."chargeId"
    ), charges AS (
      SELECT c."teacherId", SUM(c.amount) AS due, COUNT(*)::int AS entries,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)=c.amount)::int AS settled,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)>0 AND paid.amount<c.amount)::int AS partial,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)=0 AND c.amount>0)::int AS unpaid
      FROM "SessionCharge" c JOIN "TeachingSession" s ON s.id=c."sessionId" AND s.status='TERMINEE'
      LEFT JOIN paid ON paid."chargeId"=c.id WHERE c."voidedAt" IS NULL GROUP BY c."teacherId"
    ), receipts AS (
      SELECT "teacherId", SUM(amount) AS received, MAX("paymentDate")::text AS latest, COUNT(*)::int AS entries
      FROM "ProfessorPayment" WHERE "voidedAt" IS NULL GROUP BY "teacherId"
    ), completed AS (
      SELECT "teacherId", COUNT(*)::int AS count FROM "TeachingSession" WHERE status='TERMINEE' GROUP BY "teacherId"
    ) SELECT t.id AS "teacherId", COALESCE(c.due,0)::text AS "totalDue", COALESCE(p.received,0)::text AS "totalReceived",
      COALESCE(c.settled,0) AS "paidSessions", COALESCE(c.partial,0) AS "partiallyPaidSessions", COALESCE(c.unpaid,0) AS "unpaidSessions",
      COALESCE(s.count,0) AS "completedSessions", COALESCE(c.entries,0)+COALESCE(p.entries,0) AS entries, p.latest AS "lastPaymentDate"
      FROM "Teacher" t LEFT JOIN charges c ON c."teacherId"=t.id LEFT JOIN receipts p ON p."teacherId"=t.id LEFT JOIN completed s ON s."teacherId"=t.id`;
  const integrity = await reader.$queryRaw<{ missing: number; mismatch: number; links: number; payments: number; excessive: number }[]>`
    WITH valid_allocations AS (
      SELECT a.*, c."teacherId" AS "chargeTeacher", p."teacherId" AS "paymentTeacher" FROM "PaymentAllocation" a
      JOIN "ProfessorPayment" p ON p.id=a."paymentId" AND p."voidedAt" IS NULL
      JOIN "SessionCharge" c ON c.id=a."chargeId" AND c."voidedAt" IS NULL
      JOIN "TeachingSession" s ON s.id=c."sessionId" AND s.status='TERMINEE' WHERE a."voidedAt" IS NULL
    ) SELECT
      (SELECT COUNT(*)::int FROM "TeachingSession" s LEFT JOIN "SessionCharge" c ON c."sessionId"=s.id AND c."voidedAt" IS NULL WHERE s.status='TERMINEE' AND c.id IS NULL) AS missing,
      (SELECT COUNT(*)::int FROM "SessionCharge" c JOIN "TeachingSession" s ON s.id=c."sessionId" WHERE c."voidedAt" IS NULL AND (s.status<>'TERMINEE' OR s."teacherId"<>c."teacherId" OR s."rateSnapshot" IS DISTINCT FROM c.amount)) AS mismatch,
      (SELECT COUNT(*)::int FROM valid_allocations WHERE "chargeTeacher"<>"paymentTeacher") AS links,
      (SELECT COUNT(*)::int FROM "ProfessorPayment" p LEFT JOIN (SELECT "paymentId", SUM(amount) amount FROM valid_allocations WHERE "chargeTeacher"="paymentTeacher" GROUP BY "paymentId") a ON a."paymentId"=p.id WHERE p."voidedAt" IS NULL AND COALESCE(a.amount,0)<>p.amount) AS payments,
      (SELECT COUNT(*)::int FROM "SessionCharge" c JOIN "TeachingSession" s ON s.id=c."sessionId" AND s.status='TERMINEE' LEFT JOIN (SELECT "chargeId", SUM(amount) amount FROM valid_allocations GROUP BY "chargeId") a ON a."chargeId"=c.id WHERE c."voidedAt" IS NULL AND (COALESCE(a.amount,0)>c.amount OR c.amount<0 OR COALESCE(a.amount,0)<0)) AS excessive`;
  if (integrity[0].excessive || rows.some(row => money(row.totalReceived).gt(money(row.totalDue)))) throw new BusinessError("Les écritures historiques présentent une affectation incohérente. Un rapprochement financier est nécessaire avant toute opération.", 409);
  const issues: string[] = [];
  if (integrity[0].missing) issues.push(`${integrity[0].missing} séance(s) terminée(s) sans charge valide. Un rapprochement historique est nécessaire.`);
  if (integrity[0].mismatch) issues.push(`${integrity[0].mismatch} charge(s) ne correspondent pas à leur séance terminée ou à son tarif historique.`);
  if (integrity[0].links) issues.push("Une affectation relie deux professeurs différents.");
  if (integrity[0].payments) issues.push(`${integrity[0].payments} paiement(s) ne sont pas entièrement affectés à des séances terminées.`);
  const summaries = new Map<string, FinanceSummary>(rows.map(row => [row.teacherId, {
    hasEntries: row.entries > 0, totalDue: money(row.totalDue).toFixed(3), totalReceived: money(row.totalReceived).toFixed(3),
    remaining: money(row.totalDue).minus(row.totalReceived).toFixed(3), paidSessions: row.paidSessions,
    partiallyPaidSessions: row.partiallyPaidSessions, unpaidSessions: row.unpaidSessions, lastPaymentDate: row.lastPaymentDate,
  }]));
  const completedCounts = new Map(rows.map(row => [row.teacherId, row.completedSessions]));
  const cash = await reader.$queryRaw<{ paymentDate: string; amount: string }[]>`
    SELECT "paymentDate"::text AS "paymentDate", SUM(amount)::text AS amount FROM "ProfessorPayment"
    WHERE "voidedAt" IS NULL AND method='ESPECES' AND "paymentDate">=${cashFrom}::date AND "paymentDate"<=${cashTo}::date
    GROUP BY "paymentDate" ORDER BY "paymentDate"`;
  const values = [...summaries.values()];
  const aggregate = summarizeCentre(values);
  return { summaries, completedCounts, issues,
    totals: { ...aggregate, paidSessions: values.reduce((sum, summary) => sum + summary.paidSessions, 0),
      sessionsToSettle: aggregate.unpaidSessions + aggregate.partiallyPaidSessions,
      professorsWithDebt: values.filter(summary => money(summary.remaining).gt(0)).length },
    receipts: cash.map(receipt => ({ ...receipt, amount: money(receipt.amount).toFixed(3) })),
  };
}

/**
 * Monthly debt follows session dates, while cash follows receipt dates.
 * Payments made outside the month still settle the selected month's charges.
 */
export async function readMonthlyFinancialOverview(reader: Pick<Transaction, "$queryRaw">, startDate: string, endDate: string) {
  dateOnlySchema.parse(startDate);
  dateOnlySchema.parse(endDate);
  if (endDate < startDate) throw new BusinessError("La fin de la période doit être postérieure ou égale au début.");
  // Bind Date values through the same driver codec as ORM session writes and
  // date filters. SQL-constructed instants can differ under a non-UTC session.
  const startAt = atTunis(startDate, "00:00");
  const endAt = atTunis(addDays(endDate, 1), "00:00");
  const global = await readFinancialOverview(reader, startDate, endDate);
  type MonthlyAggregate = { teacherId: string; totalDue: string; totalReceived: string; paidSessions: number;
    partiallyPaidSessions: number; unpaidSessions: number; entries: number; lastPaymentDate: string | null };
  const rows = await reader.$queryRaw<MonthlyAggregate[]>`
    WITH monthly_charges AS (
      SELECT c.id, c."teacherId", c.amount FROM "SessionCharge" c
      JOIN "TeachingSession" s ON s.id=c."sessionId" AND s.status='TERMINEE'
      WHERE c."voidedAt" IS NULL AND s."startAt">=${startAt}::timestamptz AND s."startAt"<${endAt}::timestamptz
    ), paid AS (
      SELECT a."chargeId", SUM(a.amount) AS amount FROM "PaymentAllocation" a
      JOIN monthly_charges c ON c.id=a."chargeId"
      JOIN "ProfessorPayment" p ON p.id=a."paymentId" AND p."voidedAt" IS NULL AND p."teacherId"=c."teacherId"
      WHERE a."voidedAt" IS NULL GROUP BY a."chargeId"
    ), charges AS (
      SELECT c."teacherId", SUM(c.amount) AS due, SUM(COALESCE(paid.amount,0)) AS received, COUNT(*)::int AS entries,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)=c.amount)::int AS settled,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)>0 AND paid.amount<c.amount)::int AS partial,
        COUNT(*) FILTER (WHERE COALESCE(paid.amount,0)=0 AND c.amount>0)::int AS unpaid
      FROM monthly_charges c LEFT JOIN paid ON paid."chargeId"=c.id GROUP BY c."teacherId"
    ), receipts AS (
      SELECT "teacherId", MAX("paymentDate")::text AS latest, COUNT(*)::int AS entries
      FROM "ProfessorPayment" WHERE "voidedAt" IS NULL AND "paymentDate">=${startDate}::date AND "paymentDate"<=${endDate}::date
      GROUP BY "teacherId"
    ) SELECT t.id AS "teacherId", COALESCE(c.due,0)::text AS "totalDue", COALESCE(c.received,0)::text AS "totalReceived",
      COALESCE(c.settled,0) AS "paidSessions", COALESCE(c.partial,0) AS "partiallyPaidSessions", COALESCE(c.unpaid,0) AS "unpaidSessions",
      COALESCE(c.entries,0)+COALESCE(p.entries,0) AS entries, p.latest AS "lastPaymentDate"
      FROM "Teacher" t LEFT JOIN charges c ON c."teacherId"=t.id LEFT JOIN receipts p ON p."teacherId"=t.id`;
  const summaries = new Map<string, FinanceSummary>(rows.map(row => [row.teacherId, {
    hasEntries: row.entries > 0, totalDue: money(row.totalDue).toFixed(3), totalReceived: money(row.totalReceived).toFixed(3),
    remaining: money(row.totalDue).minus(row.totalReceived).toFixed(3), paidSessions: row.paidSessions,
    partiallyPaidSessions: row.partiallyPaidSessions, unpaidSessions: row.unpaidSessions, lastPaymentDate: row.lastPaymentDate,
  }]));
  const values = [...summaries.values()];
  const aggregate = summarizeCentre(values);
  return { summaries, globalSummaries: global.summaries, completedCounts: global.completedCounts, issues: global.issues,
    cashReceived: global.receipts.reduce((sum, receipt) => sum.plus(receipt.amount), money("0")).toFixed(3),
    totals: { totalDue: aggregate.totalDue, totalReceived: aggregate.totalReceived, remaining: aggregate.remaining,
      paidSessions: values.reduce((sum, summary) => sum + summary.paidSessions, 0), partiallyPaidSessions: aggregate.partiallyPaidSessions,
      unpaidSessions: aggregate.unpaidSessions, sessionsToSettle: aggregate.unpaidSessions + aggregate.partiallyPaidSessions,
      professorsWithDebt: values.filter(summary => money(summary.remaining).gt(0)).length },
  };
}
