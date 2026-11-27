import { describe, expect, it } from "vitest";
import { BusinessError } from "@/lib/business-error";
import { dashboardMonth, monthlyActivity } from "@/lib/dashboard";
import type { SessionStatus } from "@/types/management";

describe("Mois civil du tableau de bord", () => {
  const now = new Date("2026-11-25T10:00:00Z");

  it("sélectionne le mois courant à Tunis, même quand UTC est encore le mois précédent", () => {
    expect(dashboardMonth(undefined, new Date("2026-12-31T23:30:00Z"))).toEqual({
      month: "2027-01", currentMonth: "2027-01", monthLabel: "janvier 2027", startDate: "2027-01-01", endDate: "2027-01-31",
    });
    expect(dashboardMonth(undefined, new Date("2026-11-30T23:00:00Z")).month).toBe("2026-12");
  });

  it.each([
    ["2026-12", "décembre 2026", "2026-12-01", "2026-12-31"],
    ["2027-01", "janvier 2027", "2027-01-01", "2027-01-31"],
    ["2028-02", "février 2028", "2028-02-01", "2028-02-29"],
    ["2027-02", "février 2027", "2027-02-01", "2027-02-28"],
    ["1900-02", "février 1900", "1900-02-01", "1900-02-28"],
    ["2000-02", "février 2000", "2000-02-01", "2000-02-29"],
    ["9998-12", "décembre 9998", "9998-12-01", "9998-12-31"],
  ])("calcule exactement les bornes inclusives de %s", (month, monthLabel, startDate, endDate) => {
    expect(dashboardMonth(month, now)).toEqual({ month, currentMonth: "2026-11", monthLabel, startDate, endDate });
  });

  it.each(["", "2026-1", "2026-00", "2026-13", "2026-11-01", " 2026-11", "2026-11 ", "2026-11\n", "2026-11\r\n", "1899-12", "9999-01", "0200-01", "10000-01", "../2026-11"])(
    "refuse la requête de mois invalide %j avec un message français", month => {
      expect(() => dashboardMonth(month, now)).toThrow(BusinessError);
      expect(() => dashboardMonth(month, now)).toThrow("Choisissez un mois valide au format AAAA-MM, entre 1900 et 9998.");
      try { dashboardMonth(month, now); } catch (error) { expect((error as BusinessError).status).toBe(400); }
    },
  );
});

describe("Activité mensuelle selon les statuts enregistrés", () => {
  const event = (classroomId: string, teacherId: string, status: SessionStatus) => ({ classroomId, teacherId, status });

  it("retourne des indicateurs nuls sans séances", () => {
    expect(monthlyActivity([])).toEqual({ sessionsCount: 0, statuses: { planned: 0, running: 0, completed: 0, absent: 0, cancelled: 0 }, roomsUsed: 0, scheduledProfessors: 0 });
  });

  it("compte chaque statut et déduplique les salles et professeurs des seules séances actives", () => {
    const events = [
      event("room-1", "teacher-1", "PLANIFIEE"), event("room-1", "teacher-1", "EN_COURS"),
      event("room-2", "teacher-2", "TERMINEE"), event("room-2", "teacher-1", "TERMINEE"),
      event("absent-room", "absent-teacher", "ABSENT"), event("cancelled-room", "cancelled-teacher", "ANNULEE"),
    ];
    const before = structuredClone(events);
    expect(monthlyActivity(events)).toEqual({ sessionsCount: 6, statuses: { planned: 1, running: 1, completed: 2, absent: 1, cancelled: 1 }, roomsUsed: 2, scheduledProfessors: 2 });
    expect(events).toEqual(before);
  });

  it("conserve les absences et annulations dans le total sans les compter comme activité de salle ou professeur", () => {
    expect(monthlyActivity([event("room", "teacher", "ABSENT"), event("room", "teacher", "ANNULEE")])).toEqual({
      sessionsCount: 2, statuses: { planned: 0, running: 0, completed: 0, absent: 1, cancelled: 1 }, roomsUsed: 0, scheduledProfessors: 0,
    });
  });

  it("ne déduit aucun changement de statut depuis un horaire ou une date", () => {
    const events = [
      { ...event("room", "teacher", "PLANIFIEE"), startAt: "2000-01-01T08:00:00Z", endAt: "2000-01-01T10:00:00Z" },
      { ...event("room", "teacher", "EN_COURS"), startAt: "2099-01-01T08:00:00Z", endAt: "2099-01-01T10:00:00Z" },
    ];
    expect(monthlyActivity(events).statuses).toEqual({ planned: 1, running: 1, completed: 0, absent: 0, cancelled: 0 });
  });
});
