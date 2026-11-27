import { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/money";

export interface FifoCharge { id: string; amount: string; startAt: string }
export interface FifoPayment { id: string; amount: string; paymentDate: string; createdAt: string }
export interface FifoAllocation { chargeId: string; paymentId: string; amount: string }

/** Deterministic allocation of actual funds to actual historical session charges. */
export function allocateFifo(charges: FifoCharge[], payments: FifoPayment[]): FifoAllocation[] {
  if (new Set(charges.map(item => item.id)).size !== charges.length || new Set(payments.map(item => item.id)).size !== payments.length) throw new Error("Des identifiants financiers sont dupliqués.");
  const orderedCharges = [...charges].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const orderedPayments = [...payments].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const balances = orderedCharges.map(charge => {
    const amount = money(charge.amount);
    if (amount.isNegative()) throw new Error("Le tarif d’une séance ne peut pas être négatif.");
    return amount;
  });
  const allocations: FifoAllocation[] = [];
  let index = 0;
  for (const payment of orderedPayments) {
    let available = money(payment.amount);
    if (!available.gt(0)) throw new Error("Le paiement doit être supérieur à zéro.");
    while (available.gt(0) && index < orderedCharges.length) {
      if (balances[index].isZero()) { index++; continue; }
      const amount = Prisma.Decimal.min(available, balances[index]);
      allocations.push({ paymentId: payment.id, chargeId: orderedCharges[index].id, amount: amount.toFixed(3) });
      available = available.minus(amount);
      balances[index] = balances[index].minus(amount);
      if (balances[index].isZero()) index++;
    }
    if (available.gt(0)) throw new Error("Un paiement doit être entièrement affecté à des séances terminées existantes.");
  }
  return allocations;
}
