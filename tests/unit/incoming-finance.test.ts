import { describe, expect, it } from "vitest";
import { summarizeCentre, summarizeFinance } from "@/lib/finance";

const charges = [{ id: "s1", amount: "50.000" }, { id: "s2", amount: "50.000" }, { id: "s3", amount: "50.000" }];
describe("Sommes dues au centre et paiements reçus", () => {
  it("résume les paiements intégralement affectés aux séances existantes", () => {
    const summary = summarizeFinance(charges, [{ id: "p1", amount: "70.000", paymentDate: "2026-11-22" }], [
      { chargeId: "s1", paymentId: "p1", amount: "50.000" }, { chargeId: "s2", paymentId: "p1", amount: "20.000" },
    ]);
    expect(summary).toEqual({ hasEntries: true, totalDue: "150.000", totalReceived: "70.000", remaining: "80.000", paidSessions: 1, partiallyPaidSessions: 1, unpaidSessions: 1, lastPaymentDate: "2026-11-22" });
  });
  it("refuse les encaissements sans charge ou supérieurs aux charges", () => {
    expect(() => summarizeFinance([], [{ id: "p", amount: "100.125", paymentDate: "2026-11-22" }], [])).toThrow("Les paiements reçus dépassent les charges existantes");
    expect(() => summarizeFinance(charges, [{ id: "p", amount: "150.001", paymentDate: "2026-11-22" }], [])).toThrow("Les paiements reçus dépassent les charges existantes");
  });
  it("calcule les millimes et les paiements multiples exactement", () => {
    const result = summarizeFinance([{ id: "s", amount: "0.300" }], [{ id: "p1", amount: "0.100", paymentDate: "2026-11-01" }, { id: "p2", amount: "0.200", paymentDate: "2026-11-22" }], [{ chargeId: "s", paymentId: "p1", amount: "0.100" }, { chargeId: "s", paymentId: "p2", amount: "0.200" }]);
    expect(result.totalReceived).toBe("0.300"); expect(result.remaining).toBe("0.000"); expect(result.paidSessions).toBe(1); expect(result.lastPaymentDate).toBe("2026-11-22");
  });
  it("additionne les soldes impayés de chaque professeur", () => {
    const a = summarizeFinance([{ id: "s", amount: "100.000" }], [], []);
    const b = summarizeFinance([{ id: "s", amount: "60.000" }], [{ id: "p", amount: "40.000", paymentDate: "2026-11-22" }], [{ chargeId: "s", paymentId: "p", amount: "40.000" }]);
    expect(summarizeCentre([a, b])).toEqual({ hasEntries: true, totalDue: "160.000", totalReceived: "40.000", remaining: "120.000", unpaidSessions: 1, partiallyPaidSessions: 1 });
  });
  it("refuse une suraffectation à une séance ou à un paiement", () => {
    expect(() => summarizeFinance([{ id: "s", amount: "10.000" }], [{ id: "p", amount: "20.000", paymentDate: "2026-11-22" }], [{ chargeId: "s", paymentId: "p", amount: "11.000" }])).toThrow();
    expect(() => summarizeFinance([{ id: "s", amount: "20.000" }], [{ id: "p", amount: "10.000", paymentDate: "2026-11-22" }], [{ chargeId: "s", paymentId: "p", amount: "11.000" }])).toThrow();
  });
  it("ne prétend pas disposer de données quand le registre est vide", () => { expect(summarizeFinance([], [], []).hasEntries).toBe(false); });
});
