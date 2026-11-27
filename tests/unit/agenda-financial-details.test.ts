import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { atTunis } from "@/lib/scheduling";
import type { Transaction } from "@/services/management-shared";

vi.mock("server-only", () => ({}));
import { readSessionFinancialDetails } from "@/services/financial-state";

function fixture() {
  const payment = { teacherId: "teacher", amount: new Prisma.Decimal("200.000"), paymentDate: new Date("2026-12-01"), voidedAt: null };
  const allocation = { id: "allocation", paymentId: "receipt", chargeId: "charge", amount: new Prisma.Decimal("15.000"), voidedAt: null, voidReason: null, createdAt: new Date("2026-12-01"), payment };
  const charge = { id: "charge", teacherId: "teacher", sessionId: "session", amount: new Prisma.Decimal("20.125"), pricingSource: "EXCEPTIONNEL", chargedAt: atTunis("2026-11-30", "10:00"), voidedAt: null,
    session: { startAt: atTunis("2026-11-30", "08:30"), endAt: atTunis("2026-11-30", "10:00"), status: "TERMINEE", classroom: { name: "Salle 1" }, recurrenceId: "series", occurrenceWeek: new Date("2026-11-30"), completedAt: atTunis("2026-11-30", "10:00") },
    allocations: [allocation, { ...allocation, id: "reversed", amount: new Prisma.Decimal("5.125"), voidedAt: new Date("2026-12-02"), voidReason: "Correction" }] };
  const sessionCharge = { findMany: vi.fn().mockResolvedValue([charge]) };
  const auditLog = { findMany: vi.fn().mockResolvedValue([{ id: "audit", entityId: "charge", action: "CORRECTION_TARIF_SEANCE", reason: "Correction conservée", before: { amount: "25.000", reference: "ancienne référence" }, after: { amount: "20.125", pricingSource: "EXCEPTIONNEL" }, createdAt: new Date("2026-12-02") }]) };
  return { sessionCharge, auditLog };
}

describe("Détails financiers limités aux séances affichées dans l’agenda", () => {
  it("réutilise le prix historique et les affectations valides sans lire le solde global du professeur", async () => {
    const mock = fixture();
    const details = await readSessionFinancialDetails(mock as unknown as Pick<Transaction, "sessionCharge" | "auditLog">, ["session", "session"]);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ amount: "20.125", paid: "15.000", remaining: "5.125", status: "PARTIELLE", pricingSource: "EXCEPTIONNEL", agendaId: "series@2026-11-30", settledDate: null });
    expect(details[0].allocations.map(value => value.valid)).toEqual([true, false]);
    expect(details[0].allocations[0]).toMatchObject({ paymentDate: "2026-12-01", paymentAmount: "200.000" });
    expect(details[0].history[0]).toMatchObject({ reason: "Correction conservée", before: { amount: "25.000" }, after: { amount: "20.125" } });
    expect(details[0].history[0].before).not.toHaveProperty("reference");
    expect(mock.sessionCharge.findMany).toHaveBeenCalledOnce();
    expect(mock.sessionCharge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: { in: ["session"] }, voidedAt: null, session: { status: "TERMINEE" } } }));
    expect(mock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityType: "SessionCharge", entityId: { in: ["charge"] } } }));
  });

  it("ne fait aucune requête financière quand la journée ne contient aucune séance terminée", async () => {
    const mock = fixture();
    expect(await readSessionFinancialDetails(mock as unknown as Pick<Transaction, "sessionCharge" | "auditLog">, [])).toEqual([]);
    expect(mock.sessionCharge.findMany).not.toHaveBeenCalled();
    expect(mock.auditLog.findMany).not.toHaveBeenCalled();
  });
});
