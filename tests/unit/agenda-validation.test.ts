import { describe, expect, it } from "vitest";
import { dateSchema, endRecurrenceSchema, recurrenceUpdateSchema, sessionEditSchema, sessionInputSchema, statusChangeSchema } from "@/validations/agenda";

const teacherId = "5db4482f-bcc5-43ba-bd3d-9d35ce3c0925";
const classroomId = "344a286a-6d3c-46e1-9c08-685fef2ecbab";
const session = { teacherId, classroomId, date: "2026-11-23", startTime: "08:30", endTime: "10:00", type: "PROVISOIRE", notes: null };
const recurring = { ...session, type: "FIXE", weekday: 1, recurrenceStartDate: "2026-11-23", recurrenceEndDate: null };
const update = { teacherId, classroomId, weekday: 3, startTime: "10:30", endTime: "12:00", effectiveDate: "2026-11-30", endDate: null, confirm: true, notes: null };

describe("Validation des séances de l’agenda", () => {
  it("accepte les durées variables et les demi-heures", () => {
    expect(sessionInputSchema.parse(session).endTime).toBe("10:00");
    expect(sessionInputSchema.parse({ ...session, endTime: "09:30" }).endTime).toBe("09:30");
    expect(sessionInputSchema.parse({ ...session, endTime: "10:30" }).endTime).toBe("10:30");
    expect(sessionInputSchema.parse({ ...session, startTime: "23:30", endTime: "24:00" }).endTime).toBe("24:00");
  });
  it("refuse les ressources manquantes et les faux identifiants", () => {
    expect(sessionInputSchema.safeParse({ ...session, teacherId: undefined }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...session, classroomId: "Salle 1" }).success).toBe(false);
  });
  it.each([
    { startTime: "10:00", endTime: "10:00" },
    { startTime: "10:00", endTime: "09:30" },
    { startTime: "08:15", endTime: "10:00" },
    { startTime: "24:00", endTime: "24:00" },
    { startTime: "08:00", endTime: "24:30" },
  ])("refuse les heures invalides $startTime–$endTime", times => {
    expect(sessionInputSchema.safeParse({ ...session, ...times }).success).toBe(false);
  });
  it("valide les dates calendaires et normalise les notes", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("23/11/2026").success).toBe(false);
    expect(sessionInputSchema.parse({ ...session, notes: "  salle calme  " }).notes).toBe("salle calme");
    expect(sessionInputSchema.parse({ ...session, notes: "  " }).notes).toBeNull();
  });
  it("accepte une programmation fixe cohérente et applique la date sélectionnée par défaut", () => {
    expect(sessionInputSchema.parse(recurring).weekday).toBe(1);
    expect(sessionInputSchema.parse({ ...recurring, recurrenceStartDate: undefined }).recurrenceStartDate).toBe("2026-11-23");
  });
  it("refuse un jour fixe absent ou incompatible avec la date", () => {
    expect(sessionInputSchema.safeParse({ ...recurring, weekday: undefined }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...recurring, weekday: 3 }).success).toBe(false);
  });
  it("préserve les bornes de la programmation sans accepter une séance en dehors", () => {
    expect(sessionInputSchema.safeParse({ ...recurring, recurrenceEndDate: "2026-11-22" }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...recurring, recurrenceStartDate: "2026-11-30" }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...recurring, recurrenceEndDate: "2026-11-23" }).success).toBe(true);
    expect(sessionInputSchema.safeParse({ ...recurring, date: "2026-11-30", recurrenceEndDate: "2026-11-23" }).success).toBe(false);
  });
  it("permet de déplacer une occurrence indépendamment du jour du modèle fixe", () => {
    expect(sessionEditSchema.safeParse({ ...recurring, date: "2026-11-25" }).success).toBe(true);
    expect(sessionInputSchema.safeParse({ ...recurring, date: "2026-11-25" }).success).toBe(false);
    expect(sessionEditSchema.safeParse({ ...recurring, endTime: "08:00" }).success).toBe(false);
  });
});

describe("Validation des modifications futures et statuts", () => {
  it("exige une confirmation et le lundi de la semaine d’effet", () => {
    expect(recurrenceUpdateSchema.safeParse(update).success).toBe(true);
    expect(recurrenceUpdateSchema.safeParse({ ...update, confirm: false }).success).toBe(false);
    expect(recurrenceUpdateSchema.safeParse({ ...update, effectiveDate: "2026-12-01" }).success).toBe(false);
  });
  it("refuse une fin antérieure à la date d’effet et une durée négative", () => {
    expect(recurrenceUpdateSchema.safeParse({ ...update, endDate: "2026-11-29" }).success).toBe(false);
    expect(recurrenceUpdateSchema.safeParse({ ...update, endTime: "10:00" }).success).toBe(false);
  });
  it("exige une confirmation pour terminer la programmation", () => {
    expect(endRecurrenceSchema.safeParse({ effectiveDate: "2026-11-30", confirm: true }).success).toBe(true);
    expect(endRecurrenceSchema.safeParse({ effectiveDate: "2026-11-30" }).success).toBe(false);
  });
  it("n’autorise que les statuts opérationnels explicitement confirmés", () => {
    for (const status of ["EN_COURS", "TERMINEE", "ABSENT", "ANNULEE"]) expect(statusChangeSchema.safeParse({ status, confirm: true }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ status: "TERMINEE", confirm: false }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "PLANIFIEE", confirm: true }).success).toBe(false);
  });
});
