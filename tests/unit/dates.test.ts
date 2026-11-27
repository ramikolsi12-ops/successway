import { describe, expect, it } from "vitest";
import { periodBounds, tunisDate } from "@/lib/dates";

describe("Calendrier tunisien", () => {
  it("respecte le changement de jour en Tunisie", () => {
    const date = new Date("2026-11-21T23:30:00Z");
    expect(tunisDate(date).format("DD/MM/YYYY HH:mm")).toBe("22/11/2026 00:30");
    const bounds = periodBounds(date);
    expect(bounds.dayStart.toISOString()).toBe("2026-11-21T23:00:00.000Z");
    expect(bounds.dayEnd.toISOString()).toBe("2026-11-22T23:00:00.000Z");
  });
  it("sépare les bornes des timestamps et des paiements au format date", () => {
    const bounds = periodBounds(new Date("2026-12-31T23:30:00Z"));
    expect(bounds.monthStart.toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(bounds.monthDateStart.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(bounds.monthDateEnd.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });
});
