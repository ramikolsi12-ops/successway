import { describe, expect, it } from "vitest";
import { activationSchema, createClassroomSchema, createProfessorSchema, dateOnlySchema, intervalSchema, rateAgreementSchema } from "@/validations/management";

describe("Validation de gestion", () => {
  const professor = { firstName: " Ahmed ", lastName: "Ben Ali", phone: "+216 20 123 456", email: "ahmed@example.tn", address: "", notes: "" };
  it("normalise les coordonnées et ne crée aucune identité de connexion", () => {
    const result = createProfessorSchema.parse({ ...professor, password: "ignored", role: "ADMIN" });
    expect(result.firstName).toBe("Ahmed"); expect(result.address).toBeNull(); expect(result.active).toBe(true);
    expect(result).not.toHaveProperty("password"); expect(result).not.toHaveProperty("role");
  });
  it.each([{ ...professor, firstName: " " }, { ...professor, phone: "123" }, { ...professor, phone: "bonjour" }, { ...professor, email: "invalide" }])("refuse les coordonnées invalides", input => { expect(createProfessorSchema.safeParse(input).success).toBe(false); });
  it("autorise un e-mail facultatif", () => { expect(createProfessorSchema.parse({ ...professor, email: "" }).email).toBeNull(); });
  it("localise aussi les erreurs de champs manquants en français", () => {
    const result = createProfessorSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("Entrée invalide");
  });
  it("refuse une salle sans nom", () => { expect(createClassroomSchema.safeParse({ name: "  " }).success).toBe(false); });
  it("exige la confirmation d’une désactivation", () => {
    expect(activationSchema.safeParse({ active: false }).success).toBe(false);
    expect(activationSchema.parse({ active: false, confirmed: true }).active).toBe(false);
    expect(activationSchema.parse({ active: true }).active).toBe(true);
  });
  it.each(["2026-02-30", "22/11/2026", "2026-13-01"])("refuse la date %s", value => { expect(dateOnlySchema.safeParse(value).success).toBe(false); });
  it("accepte une année bissextile", () => { expect(dateOnlySchema.parse("2028-02-29")).toBe("2028-02-29"); });
  it("valide un prix en millimes sans conversion flottante", () => {
    expect(rateAgreementSchema.parse({ pricePerSession: "20,125", startDate: "2026-11-22", endDate: "" }).pricePerSession).toBe("20.125");
  });
  it.each(["-1", "20.0001", "1e3", "Infinity", "999999999999.000"])("refuse un prix invalide : %s", value => {
    expect(rateAgreementSchema.safeParse({ pricePerSession: value, startDate: "2026-11-22" }).success).toBe(false);
  });
  it("accepte zéro et une fin inclusive, mais pas une fin antérieure", () => {
    expect(rateAgreementSchema.safeParse({ pricePerSession: "0", startDate: "2026-11-22", endDate: "2026-11-22" }).success).toBe(true);
    expect(rateAgreementSchema.safeParse({ pricePerSession: "20", startDate: "2026-11-22", endDate: "2026-11-21" }).success).toBe(false);
  });
  it("refuse les intervalles vides ou inversés", () => {
    expect(intervalSchema.safeParse({ startAt: "2026-11-22T10:00:00Z", endAt: "2026-11-22T10:00:00Z" }).success).toBe(false);
  });
});
