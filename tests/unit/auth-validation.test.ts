import { describe, expect, it } from "vitest";
import { identifierSchema, loginSchema } from "@/validations/auth";

describe("Validation de connexion", () => {
  it("normalise l'identifiant", () => { expect(identifierSchema.parse("  ADMIN  ")).toBe("admin"); });
  it("rejette les champs vides et les entrées excessives", () => {
    expect(loginSchema.safeParse({ identifier: "admin", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "admin", password: "x".repeat(257) }).success).toBe(false);
    expect(identifierSchema.safeParse("<script>").success).toBe(false);
  });
});
