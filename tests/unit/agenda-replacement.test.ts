import { describe, expect, it } from "vitest";
import { replacementDraft } from "@/features/agenda/replacement-draft";
import { atTunis } from "@/lib/scheduling";

describe("Création indépendante dans un créneau libéré", () => {
  it.each([
    ["08:30", "10:00", 510, 600],
    ["14:00", "16:30", 840, 990],
    ["23:30", "24:00", 1410, 1440],
  ])("conserve exactement le créneau %s–%s en heure de Tunis", (startTime, endTime, startMinute, endMinute) => {
    const original = {
      id: "old-occurrence", teacherId: "old-teacher", classroomId: "room-1",
      startAt: atTunis("2026-11-30", startTime).toISOString(),
      endAt: atTunis("2026-11-30", endTime).toISOString(),
      priceOverride: "87.500", rateSnapshot: "50.000", notes: "Ancienne séance",
    };
    expect(replacementDraft(original, "OCCURRENCE")).toEqual({
      date: "2026-11-30", classroomId: "room-1", startMinute, endMinute, type: "PROVISOIRE",
    });
  });

  it("suggère une nouvelle programmation fixe après un arrêt de série", () => {
    expect(replacementDraft({
      classroomId: "room-2", startAt: atTunis("2026-12-07", "08:00").toISOString(),
      endAt: atTunis("2026-12-07", "09:30").toISOString(),
    }, "FOLLOWING")).toEqual({
      date: "2026-12-07", classroomId: "room-2", startMinute: 480, endMinute: 570, type: "FIXE",
    });
  });
});
