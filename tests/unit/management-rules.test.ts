import { describe, expect, it } from "vitest";
import { agreementToClose, assertClassroomCanDeactivate, blockingClassroomSessions, findApplicableAgreement, previousDate } from "@/lib/management-rules";
import type { RateAgreementRow, SessionRow } from "@/types/management";

const rate: RateAgreementRow = { id: "rate-1", pricePerSession: "20.000", startDate: "2026-01-01", endDate: "2026-06-30", active: true, notes: null, createdAt: "2026-01-01T00:00:00Z" };
const session: SessionRow = { id: "session-1", teacherId: "t", teacherName: "Ahmed", classroomId: "r", classroomName: "Salle 1", startAt: "2026-11-22T10:00:00Z", endAt: "2026-11-22T12:00:00Z", status: "PLANIFIEE", notes: null, rateSnapshot: null };

describe("Disponibilité administrative des salles", () => {
  it("bloque les séances futures et celles en cours", () => {
    expect(() => assertClassroomCanDeactivate([session], new Date("2026-11-22T09:00:00Z"))).toThrow("Annulez");
    expect(() => assertClassroomCanDeactivate([session], new Date("2026-11-22T11:00:00Z"))).toThrow();
  });
  it("ignore les séances annulées, terminées et passées", () => {
    expect(blockingClassroomSessions([{ ...session, status: "ANNULEE" }, { ...session, status: "TERMINEE" }], new Date("2026-11-22T09:00:00Z"))).toEqual([]);
    expect(() => assertClassroomCanDeactivate([session], new Date(session.endAt))).not.toThrow();
    expect(() => assertClassroomCanDeactivate([], new Date())).not.toThrow();
  });
});

describe("Tarification par professeur", () => {
  it("sélectionne le tarif aux deux dates inclusives", () => {
    expect(findApplicableAgreement([rate], "2026-01-01")?.id).toBe(rate.id);
    expect(findApplicableAgreement([rate], "2026-06-30")?.id).toBe(rate.id);
    expect(findApplicableAgreement([rate], "2026-07-01")).toBeNull();
  });
  it("ignore les tarifs archivés et refuse une ambiguïté", () => {
    expect(findApplicableAgreement([{ ...rate, active: false }], "2026-04-01")).toBeNull();
    expect(() => findApplicableAgreement([rate, { ...rate, id: "other" }], "2026-04-01")).toThrow();
  });
  it("autorise les périodes adjacentes sans chevauchement", () => { expect(agreementToClose([rate], "2026-07-01", null, false)).toBeNull(); });
  it("refuse le chevauchement sur une seule journée", () => { expect(() => agreementToClose([rate], "2026-06-30", null, false)).toThrow(); });
  it("clôture seulement un tarif antérieur avec confirmation explicite", () => {
    const open = { ...rate, endDate: null };
    expect(() => agreementToClose([open], "2026-07-01", null, false)).toThrow();
    expect(agreementToClose([open], "2026-07-01", null, true)?.id).toBe(rate.id);
    expect(() => agreementToClose([open], "2026-01-01", null, true)).toThrow();
  });
  it("calcule la veille aux changements de mois et d’année", () => {
    expect(previousDate("2027-01-01")).toBe("2026-12-31"); expect(previousDate("2028-03-01")).toBe("2028-02-29");
  });
});
