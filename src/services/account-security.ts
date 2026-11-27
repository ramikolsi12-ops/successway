import "server-only";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/business-error";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordChangeSchema } from "@/validations/auth";
import { reserveAuthenticationAttempt } from "@/services/login-protection";
import type { Actor } from "@/services/management-shared";

export async function changeAdministratorPassword(input: unknown, actor: Actor) {
  const values = passwordChangeSchema.parse(input);
  const attemptKey = `password:${actor.id}`;
  if (!await reserveAuthenticationAttempt(attemptKey)) throw new BusinessError("Trop de tentatives. Réessayez dans 15 minutes.", 429);
  const admin = await db.adminUser.findUnique({ where: { id: actor.id } });
  const valid = await verifyPassword(values.currentPassword, admin?.passwordHash ?? null);
  if (!admin?.active) throw new BusinessError("Votre session a expiré. Reconnectez-vous.", 401);
  if (!valid) throw new BusinessError("Le mot de passe actuel est incorrect.");
  const passwordHash = await hashPassword(values.newPassword);
  await db.$transaction(async tx => {
    // Compare the verified snapshot atomically: two changes cannot reuse it.
    const updated = await tx.adminUser.updateMany({ where: {
      id: admin.id, active: true, passwordHash: admin.passwordHash, sessionVersion: admin.sessionVersion,
    }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new BusinessError("La sécurité du compte a changé. Reconnectez-vous avant de réessayer.", 409);
    await tx.loginAttempt.deleteMany({ where: { identifier: attemptKey } });
    await tx.auditLog.create({ data: {
      adminId: admin.id, action: "MODIFICATION_MOT_DE_PASSE", entityType: "AdminUser", entityId: admin.id,
      after: { sessionsInvalidated: true },
    } });
  });
  return { message: "Votre mot de passe a été modifié. Reconnectez-vous.", reauthenticate: true };
}

/** Sign-out invalidates a copied token too. An old token cannot revoke a later login. */
export async function invalidateAdministratorSession(id: string, sessionVersion: number) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1) return;
  await db.$transaction(async tx => {
    const updated = await tx.adminUser.updateMany({ where: { id, sessionVersion }, data: { sessionVersion: { increment: 1 } } });
    if (!updated.count) return;
    await tx.auditLog.create({ data: { adminId: id, action: "DECONNEXION", entityType: "AdminUser", entityId: id } });
  });
}
