import { describe, expect, it } from "vitest";
import { addDays, atTunis, canTransition, clickedMinute, generateWeekly, intervalsOverlap, minutesOf, occurrenceDate, timelineGeometry, timeOf, weekMonday, type WeeklySchedule } from "@/lib/scheduling";

const schedule: WeeklySchedule = { weekday: 1, startMinute: 480, endMinute: 600, startDate: "2026-11-23", endDate: null };

describe("Récurrences hebdomadaires en Tunisie", () => {
  it("associe les sept jours au lundi, y compris aux frontières d’année", () => {
    expect(weekMonday("2027-01-03")).toBe("2026-12-28");
    expect(weekMonday("2027-01-04")).toBe("2027-01-04");
    expect(occurrenceDate("2026-12-30", 7)).toBe("2027-01-03");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("répète les séances fixes sans matérialiser de lignes et sans limiter la durée à deux heures", () => {
    const results = generateWeekly({ ...schedule, startMinute: 510, endMinute: 600 }, "2026-11-23", "2026-12-14");
    expect(results.map(value => value.date)).toEqual(["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"]);
    expect(results[0].startAt.toISOString()).toBe("2026-11-23T07:30:00.000Z");
    expect(results[0].endAt.toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(results.every(value => value.endAt.getTime() - value.startAt.getTime() === 90 * 60_000)).toBe(true);
  });
  it("respecte des bornes inclusives même si le début de validité n’est pas un lundi", () => {
    const results = generateWeekly({ ...schedule, startDate: "2026-11-25", endDate: "2026-12-07" }, "2026-11-23", "2026-12-31");
    expect(results.map(value => value.date)).toEqual(["2026-11-30", "2026-12-07"]);
    expect(generateWeekly(schedule, "2026-11-01", "2026-11-22")).toEqual([]);
  });
  it("limite l’expansion au créneau demandé sans horizon futur infini", () => {
    expect(generateWeekly(schedule, "2027-01-01", "2027-01-07").map(value => value.date)).toEqual(["2027-01-04"]);
    expect(() => generateWeekly(schedule, "2026-01-01", "2027-02-01")).toThrow("370 jours maximum");
    expect(() => generateWeekly(schedule, "2026-11-24", "2026-11-23")).toThrow();
  });
  it("conserve une identité de semaine indépendante du déplacement de jour", () => {
    const monday = generateWeekly(schedule, "2026-11-23", "2026-11-29")[0];
    const wednesday = generateWeekly({ ...schedule, weekday: 3 }, "2026-11-23", "2026-11-29")[0];
    expect(monday.week).toBe(wednesday.week);
    expect(monday.date).not.toBe(wednesday.date);
  });
  it("interprète minuit et la fin 24:00 selon Africa/Tunis", () => {
    expect(atTunis("2026-11-23", "00:00").toISOString()).toBe("2026-11-22T23:00:00.000Z");
    expect(atTunis("2026-11-23", "24:00").toISOString()).toBe("2026-11-23T23:00:00.000Z");
    expect(generateWeekly({ ...schedule, startMinute: 1380, endMinute: 1440 }, "2026-11-23", "2026-11-23")[0].endAt)
      .toEqual(atTunis("2026-11-24", "00:00"));
  });
  it("rejette les dates impossibles, jours et intervalles invalides", () => {
    expect(() => weekMonday("2026-02-30")).toThrow("date est invalide");
    expect(() => occurrenceDate("2026-11-23", 0)).toThrow();
    expect(() => generateWeekly({ ...schedule, endMinute: 480 }, "2026-11-23", "2026-11-29")).toThrow();
  });
});

describe("Axe horaire précis", () => {
  it.each([
    ["08:00", "09:00", 0, 120],
    ["08:30", "10:00", 60, 180],
    ["08:30", "10:30", 60, 240],
    ["10:30", "12:00", 300, 180],
    ["14:00", "15:00", 720, 120],
  ])("place %s–%s sans arrondir aux heures pleines", (start, end, left, width) => {
    expect(timelineGeometry(atTunis("2026-11-23", start), atTunis("2026-11-23", end), "2026-11-23", 480, 120)).toEqual({ left, width });
  });
  it("utilise la même échelle lors d’un changement de taille", () => {
    expect(timelineGeometry(atTunis("2026-11-23", "08:30"), atTunis("2026-11-23", "10:00"), "2026-11-23", 480, 80))
      .toEqual({ left: 40, width: 120 });
    expect(clickedMinute(40, 80, 480)).toBe(510);
    expect(clickedMinute(59, 120, 480)).toBe(480);
    expect(clickedMinute(60, 120, 480)).toBe(510);
    expect(clickedMinute(239, 120, 480)).toBe(570);
  });
  it("borne les clics au dernier créneau valide et conserve les minutes exactes des données", () => {
    expect(clickedMinute(-10)).toBe(0);
    expect(clickedMinute(100000)).toBe(1410);
    expect(timelineGeometry(atTunis("2026-11-23", "08:15"), atTunis("2026-11-23", "08:45"), "2026-11-23", 480)).toEqual({ left: 30, width: 60 });
  });
  it("limite le rendu à la partie visible sans décaler les colonnes", () => {
    expect(timelineGeometry(atTunis("2026-11-23", "07:00"), atTunis("2026-11-23", "09:00"), "2026-11-23", 480)).toEqual({ left: 0, width: 120 });
    expect(timelineGeometry(atTunis("2026-11-22", "08:00"), atTunis("2026-11-22", "10:00"), "2026-11-23", 480)).toEqual({ left: 0, width: 0 });
  });
  it("convertit les minutes sans imposer une durée", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("24:00")).toBe(1440);
    expect(timeOf(630)).toBe("10:30");
    expect(timeOf(1440)).toBe("24:00");
    expect(() => minutesOf("24:30")).toThrow();
    expect(() => timeOf(1441)).toThrow();
  });
});

describe("Conflits et transitions explicites", () => {
  it("autorise des séances adjacentes et détecte chaque chevauchement", () => {
    expect(intervalsOverlap(480, 600, 600, 720)).toBe(false);
    expect(intervalsOverlap(480, 600, 570, 660)).toBe(true);
    expect(intervalsOverlap(480, 600, 510, 540)).toBe(true);
    expect(intervalsOverlap(480, 600, 420, 480)).toBe(false);
  });
  it("accepte aussi les timestamps exacts", () => {
    expect(intervalsOverlap(atTunis("2026-11-23", "08:30"), atTunis("2026-11-23", "10:30"), atTunis("2026-11-23", "10:00"), atTunis("2026-11-23", "11:00"))).toBe(true);
  });
  it("autorise les actions depuis une séance prévue ou en cours", () => {
    expect(canTransition("PLANIFIEE", "EN_COURS")).toBe(true);
    expect(canTransition("PLANIFIEE", "TERMINEE")).toBe(true);
    expect(canTransition("PLANIFIEE", "ABSENT")).toBe(true);
    expect(canTransition("EN_COURS", "ABSENT")).toBe(true);
    expect(canTransition("EN_COURS", "ANNULEE")).toBe(true);
    expect(canTransition("EN_COURS", "TERMINEE")).toBe(true);
  });
  it("ne modifie pas silencieusement les états terminaux et rend un renvoi identique idempotent", () => {
    expect(canTransition("TERMINEE", "ABSENT")).toBe(false);
    expect(canTransition("TERMINEE", "ANNULEE")).toBe(false);
    expect(canTransition("ABSENT", "EN_COURS")).toBe(false);
    expect(canTransition("ANNULEE", "PLANIFIEE")).toBe(false);
    expect(canTransition("EN_COURS", "PLANIFIEE")).toBe(false);
    expect(canTransition("TERMINEE", "TERMINEE")).toBe(true);
  });
});
