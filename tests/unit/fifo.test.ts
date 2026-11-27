import { describe, expect, it } from "vitest";
import { allocateFifo, type FifoCharge, type FifoPayment } from "@/lib/fifo";
import { summarizeFinance } from "@/lib/finance";

const payment = (id: string, amount: string, paymentDate = "2026-11-24", createdAt = "2026-11-24T09:00:00.000Z"): FifoPayment => ({ id, amount, paymentDate, createdAt });
const sessions = (amounts: string[]): FifoCharge[] => amounts.map((amount, index) => ({
  id: `session-${String(index + 1).padStart(2, "0")}`, amount,
  startAt: new Date(Date.UTC(2026, 10, 1 + index, 7)).toISOString(),
}));
const twentySessions = () => sessions(Array.from({ length: 20 }, () => "20.000"));

describe("Répartition automatique FIFO des paiements reçus", () => {
  it("répartit un paiement de 200 DT sur exactement les dix premières séances à 20 DT", () => {
    const charges = twentySessions();
    const receipts = [payment("recu-200", "200.000")];
    const plan = allocateFifo(charges, receipts);
    expect(plan).toHaveLength(10);
    expect(plan.map(row => row.chargeId)).toEqual(charges.slice(0, 10).map(charge => charge.id));
    expect(plan.every(row => row.paymentId === "recu-200" && row.amount === "20.000")).toBe(true);
    expect(summarizeFinance(charges, receipts, plan)).toMatchObject({
      totalDue: "400.000", totalReceived: "200.000", remaining: "200.000",
      paidSessions: 10, partiallyPaidSessions: 0, unpaidSessions: 10,
    });
  });

  it("répartit 210 DT en dix séances payées, une partielle et neuf non payées", () => {
    const charges = twentySessions();
    const receipts = [payment("recu-210", "210.000")];
    const plan = allocateFifo(charges, receipts);
    expect(plan).toHaveLength(11);
    expect(plan.at(-1)).toEqual({ paymentId: "recu-210", chargeId: "session-11", amount: "10.000" });
    expect(summarizeFinance(charges, receipts, plan)).toMatchObject({
      totalDue: "400.000", totalReceived: "210.000", remaining: "190.000",
      paidSessions: 10, partiallyPaidSessions: 1, unpaidSessions: 9,
    });
  });

  it("affecte les 30 DT suivants au reste de la séance 11 puis à la séance 12", () => {
    const charges = twentySessions();
    const receipts = [payment("recu-initial", "210.000", "2026-11-23"), payment("second-recu", "30.000")];
    const plan = allocateFifo(charges, receipts);
    expect(plan.filter(row => row.paymentId === "second-recu")).toEqual([
      { paymentId: "second-recu", chargeId: "session-11", amount: "10.000" },
      { paymentId: "second-recu", chargeId: "session-12", amount: "20.000" },
    ]);
    expect(summarizeFinance(charges, receipts, plan)).toMatchObject({
      totalReceived: "240.000", remaining: "160.000", paidSessions: 12, partiallyPaidSessions: 0, unpaidSessions: 8,
    });
    receipts.push(payment("dernier-recu", "160.000", "2026-11-25"));
    expect(summarizeFinance(charges, receipts, allocateFifo(charges, receipts))).toMatchObject({
      totalReceived: "400.000", remaining: "0.000", paidSessions: 20, partiallyPaidSessions: 0, unpaidSessions: 0,
    });
  });

  it("utilise les tarifs historiques différents et termine une séance partielle avant les suivantes", () => {
    const charges = sessions(["20.000", "15.000", "30.000", "20.000", "25.000"]);
    const first = payment("premier-recu", "50.000", "2026-11-23");
    const firstPlan = allocateFifo(charges, [first]);
    expect(firstPlan).toEqual([
      { paymentId: first.id, chargeId: "session-01", amount: "20.000" },
      { paymentId: first.id, chargeId: "session-02", amount: "15.000" },
      { paymentId: first.id, chargeId: "session-03", amount: "15.000" },
    ]);
    expect(summarizeFinance(charges, [first], firstPlan)).toMatchObject({
      totalDue: "110.000", remaining: "60.000", paidSessions: 2, partiallyPaidSessions: 1, unpaidSessions: 2,
    });
    const receipts = [first, payment("second-recu", "60.000")];
    const finalPlan = allocateFifo(charges, receipts);
    expect(finalPlan.filter(row => row.paymentId === "second-recu")).toEqual([
      { paymentId: "second-recu", chargeId: "session-03", amount: "15.000" },
      { paymentId: "second-recu", chargeId: "session-04", amount: "20.000" },
      { paymentId: "second-recu", chargeId: "session-05", amount: "25.000" },
    ]);
    expect(summarizeFinance(charges, receipts, finalPlan)).toMatchObject({ remaining: "0.000", paidSessions: 5 });
  });

  it("refuse tout paiement sans charge existante ou supérieur au reste à régler", () => {
    expect(() => allocateFifo([], [payment("sans-charge", "40.000")])).toThrow("entièrement affecté");
    expect(() => allocateFifo(sessions(["30.000"]), [payment("trop-eleve", "30.001")])).toThrow("entièrement affecté");
    expect(() => allocateFifo(sessions(["30.000"]), [payment("premier", "20.000"), payment("second", "10.001")])).toThrow("entièrement affecté");
  });

  it("termine une séance à 20 DT avec deux paiements de 15 puis 5 DT", () => {
    const charges = sessions(["20.000"]);
    const receipts = [payment("premier", "15.000", "2026-11-23")];
    expect(summarizeFinance(charges, receipts, allocateFifo(charges, receipts))).toMatchObject({ remaining: "5.000", partiallyPaidSessions: 1, paidSessions: 0 });
    receipts.push(payment("second", "5.000"));
    expect(allocateFifo(charges, receipts)).toEqual([
      { paymentId: "premier", chargeId: "session-01", amount: "15.000" },
      { paymentId: "second", chargeId: "session-01", amount: "5.000" },
    ]);
    expect(summarizeFinance(charges, receipts, allocateFifo(charges, receipts))).toMatchObject({ totalReceived: "20.000", remaining: "0.000", paidSessions: 1, partiallyPaidSessions: 0 });
  });

  it("saute les séances gratuites sans créer d’affectation nulle", () => {
    const charges = sessions(["0.000", "20.000", "0.000"]);
    const receipts = [payment("recu", "20.000")];
    const plan = allocateFifo(charges, receipts);
    expect(plan).toEqual([{ paymentId: "recu", chargeId: "session-02", amount: "20.000" }]);
    expect(summarizeFinance(charges, receipts, plan)).toMatchObject({ paidSessions: 3, unpaidSessions: 0, remaining: "0.000" });
  });

  it("répartit les millimes exactement, y compris une limite traversant deux paiements", () => {
    const charges = sessions(["0.100", "0.200", "0.003"]);
    const receipts = [payment("recu-1", "0.101", "2026-11-23"), payment("recu-2", "0.201")];
    const plan = allocateFifo(charges, receipts);
    expect(plan).toEqual([
      { paymentId: "recu-1", chargeId: "session-01", amount: "0.100" },
      { paymentId: "recu-1", chargeId: "session-02", amount: "0.001" },
      { paymentId: "recu-2", chargeId: "session-02", amount: "0.199" },
      { paymentId: "recu-2", chargeId: "session-03", amount: "0.002" },
    ]);
    expect(summarizeFinance(charges, receipts, plan)).toMatchObject({
      totalDue: "0.303", totalReceived: "0.302", remaining: "0.001", paidSessions: 2, partiallyPaidSessions: 1,
    });
  });

  it("préserve les millimes aux limites des grands montants stockables", () => {
    const charges = sessions(["99999999999.999"]);
    const receipts = [payment("grand-recu", "99999999999.998", "2026-11-23"), payment("millime", "0.001")];
    expect(summarizeFinance(charges, receipts, allocateFifo(charges, receipts))).toMatchObject({
      totalDue: "99999999999.999", totalReceived: "99999999999.999", remaining: "0.000", paidSessions: 1,
    });
  });

  it("départage les mêmes horaires et dates par un ordre stable sans modifier les entrées", () => {
    const charges: FifoCharge[] = [
      { id: "b", amount: "10.000", startAt: "2026-11-20T08:00:00.000Z" },
      { id: "a", amount: "10.000", startAt: "2026-11-20T08:00:00.000Z" },
    ];
    const receipts = [payment("b", "10.000"), payment("a", "10.000")];
    const original = structuredClone({ charges, receipts });
    const expected = [{ chargeId: "a", paymentId: "a", amount: "10.000" }, { chargeId: "b", paymentId: "b", amount: "10.000" }];
    expect(allocateFifo(charges, receipts)).toEqual(expected);
    expect(allocateFifo([...charges].reverse(), [...receipts].reverse())).toEqual(expected);
    expect({ charges, receipts }).toEqual(original);
  });

  it("ordonne les paiements par date puis heure d’enregistrement avant l’identifiant", () => {
    const charges = sessions(["10.000", "10.000", "10.000"]);
    const receipts = [
      payment("a", "10.000", "2026-11-24", "2026-11-24T10:00:00.000Z"),
      payment("z", "10.000", "2026-11-23", "2026-11-24T12:00:00.000Z"),
      payment("m", "10.000", "2026-11-24", "2026-11-24T09:00:00.000Z"),
    ];
    expect(allocateFifo(charges, receipts).map(row => row.paymentId)).toEqual(["z", "m", "a"]);
  });

  it("gère un registre vide et des charges sans encaissement", () => {
    expect(allocateFifo([], [])).toEqual([]);
    expect(allocateFifo(sessions(["20.000"]), [])).toEqual([]);
  });

  it("refuse les montants négatifs, les paiements nuls et la précision excessive", () => {
    expect(() => allocateFifo(sessions(["-0.001"]), [])).toThrow();
    expect(() => allocateFifo([], [payment("negatif", "-0.001")])).toThrow();
    expect(() => allocateFifo([], [payment("nul", "0.000")])).toThrow();
    expect(() => allocateFifo(sessions(["20.0001"]), [])).toThrow();
    expect(() => allocateFifo([], [payment("imprecis", "20.0001")])).toThrow();
  });

  it("refuse les identifiants dupliqués pour empêcher les doubles affectations", () => {
    const charge = sessions(["20.000"])[0];
    const receipt = payment("recu", "20.000");
    expect(() => allocateFifo([charge, { ...charge }], [receipt])).toThrow();
    expect(() => allocateFifo([charge], [receipt, { ...receipt }])).toThrow();
  });
});
