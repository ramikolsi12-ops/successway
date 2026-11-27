import { describe, expect, it, vi } from "vitest";
import { agendaMinuteRange, centreIntervalSlots, defaultOpeningHours, firstUnstoredOccurrence, openingSlotError, type OpeningHours } from "@/lib/opening-hours";
import { addDays, atTunis, type WeeklySchedule } from "@/lib/scheduling";
import type { Transaction } from "@/services/management-shared";

vi.mock("server-only", () => ({}));
import { assertCentreWeeklySchedule, assertOpeningHoursCompatible } from "@/services/opening-hours";

const monday = "2026-11-30";
const hours: OpeningHours = { openingMinute: 510, closingMinute: 1200, openingDays: [1, 2, 3, 4, 5] };
const schedule: WeeklySchedule = { weekday: 1, startMinute: 480, endMinute: 600, startDate: monday, endDate: null };

describe("Horaires et axe horizontal du centre", () => {
  it("accepte les limites exactes et les demi-heures, refuse les jours fermés et dépassements", () => {
    expect(openingSlotError(hours, { date: monday, startMinute: 510, endMinute: 600 })).toBeNull();
    expect(openingSlotError(hours, { date: monday, startMinute: 1140, endMinute: 1200 })).toBeNull();
    expect(openingSlotError(hours, { date: monday, startMinute: 480, endMinute: 600 })).toMatch(/08:30.*20:00/);
    expect(openingSlotError(hours, { date: monday, startMinute: 1140, endMinute: 1230 })).toMatch(/horaires/);
    expect(openingSlotError(hours, { date: addDays(monday, 6), startMinute: 510, endMinute: 600 })).toMatch(/fermé/);
    expect(openingSlotError(defaultOpeningHours, { date: addDays(monday, 6), startMinute: 1410, endMinute: 1440 })).toBeNull();
  });

  it("affiche les horaires configurés et étend la plage pour les séances historiques", () => {
    expect(agendaMinuteRange(hours, monday, [])).toEqual({ startMinute: 510, endMinute: 1200 });
    const historical = [
      { startAt: atTunis(monday, "06:30").toISOString(), endAt: atTunis(monday, "07:30").toISOString() },
      { startAt: atTunis(monday, "23:00").toISOString(), endAt: atTunis(monday, "24:00").toISOString() },
    ];
    expect(agendaMinuteRange(hours, monday, historical)).toEqual({ startMinute: 390, endMinute: 1440 });
    expect(agendaMinuteRange(hours, monday, [], true)).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it("trouve une occurrence distante sans horizon et respecte toutes les exceptions finies", () => {
    const stored = new Set(Array.from({ length: 800 }, (_, index) => addDays(monday, index * 7)));
    expect(firstUnstoredOccurrence(schedule, stored)).toBe(addDays(monday, 800 * 7));
    expect(firstUnstoredOccurrence({ ...schedule, endDate: addDays(monday, 799 * 7) }, stored)).toBeNull();
    expect(firstUnstoredOccurrence({ ...schedule, endDate: monday }, new Set(), addDays(monday, 1))).toBeNull();
  });

  it("découpe les anciens créneaux sur chaque journée réellement occupée", () => {
    expect(centreIntervalSlots(atTunis(monday, "23:00"), atTunis(addDays(monday, 1), "02:00"))).toEqual([
      { date: monday, startMinute: 1380, endMinute: 1440 }, { date: addDays(monday, 1), startMinute: 0, endMinute: 120 },
    ]);
    expect(centreIntervalSlots(atTunis(monday, "23:00"), atTunis(monday, "24:00"))).toEqual([{ date: monday, startMinute: 1380, endMinute: 1440 }]);
  });
});

type Stored = { recurrenceId: string; occurrenceWeek: Date };
type Template = WeeklySchedule & { recurrenceId: string };
function reader({ templates = [], stored = [], concrete = [] }: { templates?: Template[]; stored?: Stored[]; concrete?: { startAt: Date; endAt: Date }[] } = {}) {
  const teachingSession = { findMany: vi.fn().mockImplementation(async (input: { where: { status?: unknown; recurrenceId?: unknown } }) => input.where.status ? concrete : stored) };
  const recurrenceSchedule = { findMany: vi.fn().mockResolvedValue(templates.map(value => ({ ...value, startDate: new Date(value.startDate), endDate: value.endDate ? new Date(value.endDate) : null }))) };
  return { teachingSession, recurrenceSchedule } as unknown as Pick<Transaction, "teachingSession" | "recurrenceSchedule">;
}
const now = atTunis(monday, "07:00");

describe("Prévalidation des changements d’horaires sous verrou", () => {
  it("bloque une série infinie même si ses 800 premières semaines sont annulées", async () => {
    const tx = reader({ templates: [{ ...schedule, recurrenceId: "series" }], stored: Array.from({ length: 800 }, (_, index) => ({ recurrenceId: "series", occurrenceWeek: new Date(addDays(monday, index * 7)) })) });
    await expect(assertOpeningHoursCompatible(tx, hours, now)).rejects.toThrow(/réservation à venir/);
    await expect(assertCentreWeeklySchedule(tx, hours, { ...schedule, recurrenceId: "series" })).rejects.toThrow(/horaires/);
  });

  it("autorise une série finie dont toutes les occurrences sont annulées ou déplacées vers un jour ouvert", async () => {
    const tx = reader({ templates: [{ ...schedule, recurrenceId: "series", endDate: addDays(monday, 7) }],
      stored: [monday, addDays(monday, 7)].map(date => ({ recurrenceId: "series", occurrenceWeek: new Date(date) })),
      concrete: [{ startAt: atTunis(addDays(monday, 8), "09:00"), endAt: atTunis(addDays(monday, 8), "10:00") }] });
    await expect(assertOpeningHoursCompatible(tx, { ...hours, openingDays: [2] }, now)).resolves.toBeUndefined();
  });

  it("contrôle le vrai créneau déplacé même si le modèle hebdomadaire respecte les horaires", async () => {
    const tx = reader({ templates: [{ ...schedule, startMinute: 540, recurrenceId: "series" }],
      stored: [{ recurrenceId: "series", occurrenceWeek: new Date(monday) }],
      concrete: [{ startAt: atTunis(addDays(monday, 6), "09:00"), endAt: atTunis(addDays(monday, 6), "10:00") }] });
    await expect(assertOpeningHoursCompatible(tx, hours, now)).rejects.toThrow(/06\/12\/2026/);
  });

  it("ne bloque pas une dernière occurrence virtuelle déjà écoulée aujourd’hui", async () => {
    const tx = reader({ templates: [{ ...schedule, recurrenceId: "series", endDate: monday }] });
    await expect(assertOpeningHoursCompatible(tx, hours, atTunis(monday, "12:00"))).resolves.toBeUndefined();
  });

  it("n’exclut ni une séance en cours ni une séance future terminée de la vérification", async () => {
    const tx = reader({ concrete: [{ startAt: atTunis(monday, "08:00"), endAt: atTunis(monday, "09:00") }] });
    await expect(assertOpeningHoursCompatible(tx, hours, now)).rejects.toThrow(/réservation à venir/);
    expect(tx.teachingSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["PLANIFIEE", "EN_COURS", "TERMINEE"] }, endAt: { gt: now } } }));
  });

  it("refuse un ancien créneau traversant minuit vers un jour fermé, autorise la fin exacte à minuit", async () => {
    const overnight = reader({ concrete: [{ startAt: atTunis(monday, "23:00"), endAt: atTunis(addDays(monday, 1), "02:00") }] });
    await expect(assertOpeningHoursCompatible(overnight, { ...defaultOpeningHours, openingDays: [1] }, now)).rejects.toThrow(/01\/12\/2026/);
    const midnightEnd = reader({ concrete: [{ startAt: atTunis(monday, "23:00"), endAt: atTunis(monday, "24:00") }] });
    await expect(assertOpeningHoursCompatible(midnightEnd, { ...defaultOpeningHours, openingDays: [1] }, now)).resolves.toBeUndefined();
  });
});
