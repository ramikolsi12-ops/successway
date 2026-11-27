import { afterAll, describe, expect, it } from "vitest";
import { authenticateAdministrator } from "@/services/authentication";
import { db } from "@/server/db";
import { assertTestDatabase } from "../helpers/test-database";
import { changeAdministratorPassword, invalidateAdministratorSession } from "@/services/account-security";
import { verifyPassword } from "@/lib/password";
import { reserveAuthenticationAttempt } from "@/services/login-protection";
import { randomUUID } from "node:crypto";

// account-security is server-only in the application; the suite executes in Node.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

assertTestDatabase();
afterAll(async () => { await db.$disconnect(); });

describe("Authentification persistante", () => {
  it("authentifie le seul administrateur et journalise sa connexion", async () => {
    const admin = await authenticateAdministrator({ identifier: "ADMINISTRATEUR", password: process.env.TEST_ADMIN_PASSWORD });
    expect(admin?.name).toBe("Administrateur");
    expect(await db.auditLog.count({ where: { action: "CONNEXION", adminId: admin?.id } })).toBeGreaterThan(0);
  });
  it("retourne la même réponse pour un compte inconnu et un mauvais mot de passe", async () => {
    expect(await authenticateAdministrator({ identifier: "inconnu", password: "mauvais" })).toBeNull();
    expect(await authenticateAdministrator({ identifier: "administrateur", password: "mauvais" })).toBeNull();
  });
  it("persiste le blocage après cinq essais échoués", async () => {
    for (let index = 0; index < 5; index++) expect(await authenticateAdministrator({ identifier: "compte-bloque", password: "mauvais" })).toBeNull();
    const attempt = await db.loginAttempt.findUniqueOrThrow({ where: { identifier: "compte-bloque" } });
    expect(attempt.failures).toBe(5);
    expect(attempt.blockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await authenticateAdministrator({ identifier: "compte-bloque", password: "mauvais" });
    expect((await db.loginAttempt.findUniqueOrThrow({ where: { identifier: "compte-bloque" } })).failures).toBe(5);
  });
  it("refuse un compte désactivé", async () => {
    await db.adminUser.update({ where: { identifier: "administrateur" }, data: { active: false } });
    try { expect(await authenticateAdministrator({ identifier: "administrateur", password: process.env.TEST_ADMIN_PASSWORD })).toBeNull(); }
    finally { await db.adminUser.update({ where: { identifier: "administrateur" }, data: { active: true } }); }
  });
  it("vérifie le mot de passe actuel, invalide les sessions et ne journalise aucun secret", async () => {
    const admin = await db.adminUser.findUniqueOrThrow({ where: { identifier: "administrateur" } });
    const next = "Nouveau-mot-de-passe-phase5";
    const input = { currentPassword: process.env.TEST_ADMIN_PASSWORD!, newPassword: next, confirmPassword: next };
    try {
      await expect(changeAdministratorPassword({ ...input, currentPassword: "incorrect" }, admin)).rejects.toMatchObject({ message: "Le mot de passe actuel est incorrect." });
      expect((await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(admin.passwordHash);
      await changeAdministratorPassword(input, admin);
      const updated = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
      expect(updated.sessionVersion).toBe(admin.sessionVersion + 1);
      expect(await verifyPassword(next, updated.passwordHash)).toBe(true);
      expect(await verifyPassword(input.currentPassword, updated.passwordHash)).toBe(false);
      expect(await authenticateAdministrator({ identifier: admin.identifier, password: next })).toMatchObject({ id: admin.id, sessionVersion: updated.sessionVersion });
      const audits = await db.auditLog.findMany({ where: { action: "MODIFICATION_MOT_DE_PASSE", entityId: admin.id } });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain(next);
      expect(JSON.stringify(audits)).not.toContain("scrypt$");
      // Reusing the older logout token cannot revoke the newly changed session.
      await invalidateAdministratorSession(admin.id, admin.sessionVersion);
      expect((await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).sessionVersion).toBe(updated.sessionVersion);
    } finally {
      // Restore only the isolated fixture password; versions remain monotonically increasing.
      await db.adminUser.update({ where: { id: admin.id }, data: { passwordHash: admin.passwordHash, sessionVersion: { increment: 1 } } });
      await db.loginAttempt.deleteMany({ where: { identifier: `password:${admin.id}` } });
    }
  });
  it("révoque une session à la déconnexion une seule fois", async () => {
    const admin = await db.adminUser.findUniqueOrThrow({ where: { identifier: "administrateur" } });
    await invalidateAdministratorSession(admin.id, admin.sessionVersion);
    await invalidateAdministratorSession(admin.id, admin.sessionVersion);
    expect((await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).sessionVersion).toBe(admin.sessionVersion + 1);
    expect(await db.auditLog.count({ where: { action: "DECONNEXION", entityId: admin.id } })).toBe(1);
  });
  it("borne les tentatives de vérification du mot de passe actuel", async () => {
    const admin = await db.adminUser.findUniqueOrThrow({ where: { identifier: "administrateur" } });
    const input = { currentPassword: "incorrect", newPassword: "Autre-mot-de-passe-phase5", confirmPassword: "Autre-mot-de-passe-phase5" };
    try {
      for (let index = 0; index < 5; index++) await expect(changeAdministratorPassword(input, admin)).rejects.toMatchObject({ status: 400 });
      await expect(changeAdministratorPassword(input, admin)).rejects.toMatchObject({ status: 429 });
      expect((await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(admin.passwordHash);
    } finally { await db.loginAttempt.deleteMany({ where: { identifier: `password:${admin.id}` } }); }
  });
  it("borne aussi les tentatives distribuées sur des identifiants inconnus", async () => {
    const prefix = `rotation-${randomUUID().slice(0, 8)}-`;
    await db.loginAttempt.deleteMany({ where: { identifier: ":global-auth" } });
    try {
      for (let index = 0; index < 30; index++) expect(await reserveAuthenticationAttempt(`${prefix}${index}`)).toBe(true);
      expect(await reserveAuthenticationAttempt(`${prefix}31`)).toBe(false);
      expect(await db.loginAttempt.count({ where: { identifier: { startsWith: prefix } } })).toBe(30);
    } finally { await db.loginAttempt.deleteMany({ where: { OR: [{ identifier: ":global-auth" }, { identifier: { startsWith: prefix } }] } }); }
  });
});
