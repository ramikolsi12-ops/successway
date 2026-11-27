import { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/money";
import type { FinanceSummary } from "@/types/management";

export interface ChargeInput { id: string; amount: string }
export interface ReceiptInput { id: string; amount: string; paymentDate: string }
export interface AllocationInput { chargeId: string; paymentId: string; amount: string }

export function summarizeFinance(charges: ChargeInput[], receipts: ReceiptInput[], allocations: AllocationInput[]): FinanceSummary {
  let due = money("0");
  let received = money("0");
  let unpaidSessions = 0, partiallyPaidSessions = 0, paidSessions = 0;
  const chargeTotals = new Map<string, Prisma.Decimal>();
  const receiptTotals = new Map<string, Prisma.Decimal>();
  const validCharges = new Set(charges.map(charge => charge.id));
  const validReceipts = new Set(receipts.map(receipt => receipt.id));
  for (const allocation of allocations) {
    if (!validCharges.has(allocation.chargeId) || !validReceipts.has(allocation.paymentId)) continue;
    const amount = money(allocation.amount);
    if (amount.isNegative()) throw new BusinessRuleError("Une affectation ne peut pas être négative.");
    chargeTotals.set(allocation.chargeId, (chargeTotals.get(allocation.chargeId) ?? money("0")).plus(amount));
    receiptTotals.set(allocation.paymentId, (receiptTotals.get(allocation.paymentId) ?? money("0")).plus(amount));
  }
  for (const charge of charges) {
    const amount = money(charge.amount);
    const paid = chargeTotals.get(charge.id) ?? money("0");
    if (amount.isNegative() || paid.gt(amount)) throw new BusinessRuleError("Le montant affecté dépasse le montant dû pour une séance.");
    due = due.plus(amount);
    if (paid.eq(amount)) paidSessions++;
    else if (paid.isZero()) unpaidSessions++;
    else partiallyPaidSessions++;
  }
  for (const receipt of receipts) {
    const amount = money(receipt.amount);
    if (amount.isNegative() || (receiptTotals.get(receipt.id) ?? money("0")).gt(amount)) throw new BusinessRuleError("Le montant affecté dépasse le paiement reçu.");
    received = received.plus(amount);
  }
  const net = due.minus(received);
  if (net.lt(0)) throw new BusinessRuleError("Les paiements reçus dépassent les charges existantes. Un rapprochement financier est nécessaire.");
  return {
    hasEntries: charges.length > 0 || receipts.length > 0,
    totalDue: due.toFixed(3), totalReceived: received.toFixed(3), remaining: net.toFixed(3),
    unpaidSessions, partiallyPaidSessions, paidSessions,
    lastPaymentDate: receipts.reduce<string | null>((latest, receipt) => !latest || receipt.paymentDate > latest ? receipt.paymentDate : latest, null),
  };
}

class BusinessRuleError extends Error {}

export function summarizeCentre(summaries: FinanceSummary[]) {
  const sum = (field: "totalDue" | "totalReceived" | "remaining") => summaries.reduce((total, value) => total.plus(value[field]), money("0")).toFixed(3);
  return {
    hasEntries: summaries.some(value => value.hasEntries), totalDue: sum("totalDue"), totalReceived: sum("totalReceived"),
    remaining: sum("remaining"),
    unpaidSessions: summaries.reduce((total, value) => total + value.unpaidSessions, 0),
    partiallyPaidSessions: summaries.reduce((total, value) => total + value.partiallyPaidSessions, 0),
  };
}
