import { describe, expect, it } from "vitest";
import { authenticationEnvironment, databaseUrl } from "@/server/environment";
import { contentSecurityPolicy } from "@/server/security-policy";
import { passwordChangeSchema } from "@/validations/auth";

const environment = { NEXTAUTH_SECRET: "a".repeat(48), NEXTAUTH_URL: "http://localhost:3000", NODE_ENV: "production" };

describe("Configuration et sécurité de production", () => {
  it("préserve HTTP local et exige HTTPS pour une origine de production distante", () => {
    expect(authenticationEnvironment(environment).secureCookies).toBe(false);
    expect(authenticationEnvironment({ ...environment, NEXTAUTH_URL: "https://centre.example" }).secureCookies).toBe(true);
    expect(() => authenticationEnvironment({ ...environment, NEXTAUTH_URL: "http://centre.example" })).toThrow("HTTPS");
  });
  it("refuse les secrets absents ou d’exemple et les URL ambiguës sans exposer les valeurs", () => {
    for (const secret of [undefined, "court", "GENERATE_AT_LEAST_32_RANDOM_BYTES"]) expect(() => authenticationEnvironment({ ...environment, NEXTAUTH_SECRET: secret })).toThrow("NEXTAUTH_SECRET");
    for (const url of [undefined, "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/chemin", "https://example.com?token=secret"]) {
      expect(() => authenticationEnvironment({ ...environment, NEXTAUTH_URL: url })).toThrow("NEXTAUTH_URL");
    }
  });
  it("valide PostgreSQL sans recopier les identifiants dans les erreurs", () => {
    expect(databaseUrl("postgresql://centre:secret@localhost:5434/centre")).toContain("postgresql:");
    for (const value of [undefined, "https://user:secret@example.com", "postgresql://localhost"]) {
      expect(() => databaseUrl(value)).toThrow("DATABASE_URL");
      try { databaseUrl(value); } catch (error) { expect(String(error)).not.toContain("secret"); }
    }
  });
  it("réserve eval au développement et protège scripts, cadres et objets", () => {
    const production = contentSecurityPolicy("nonce-test", false);
    const scripts = production.split(";").find(value => value.trim().startsWith("script-src"));
    expect(scripts).toContain("'nonce-nonce-test'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("unsafe-inline");
    expect(scripts).not.toContain("unsafe-eval");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("different", true)).toContain("'unsafe-eval'");
  });
  it("autorise uniquement le WebSocket du serveur de développement sans élargir la production", () => {
    expect(contentSecurityPolicy("", true, "https://localhost:3443/connexion")).toContain("connect-src 'self' wss://localhost:3443");
    expect(contentSecurityPolicy("nonce-test", false, "https://centre.example")).toContain("connect-src 'self';");
    expect(contentSecurityPolicy("nonce-test", false, "https://centre.example")).not.toContain("wss:");
  });
});

describe("Validation du changement de mot de passe", () => {
  const valid = { currentPassword: "ancien-mot-de-passe", newPassword: "nouveau-mot-de-passe", confirmPassword: "nouveau-mot-de-passe" };
  it("exige au moins douze caractères et une confirmation identique", () => {
    expect(passwordChangeSchema.safeParse(valid).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ ...valid, newPassword: "court" }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ ...valid, confirmPassword: "différent" }).success).toBe(false);
  });
  it("refuse une réutilisation et les champs de compte inattendus", () => {
    expect(passwordChangeSchema.safeParse({ ...valid, currentPassword: valid.newPassword }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ ...valid, sessionVersion: 100 }).success).toBe(false);
  });
});
