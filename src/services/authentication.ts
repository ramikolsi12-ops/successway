import { db } from "@/server/db";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/validations/auth";
import { reserveAuthenticationAttempt } from "@/services/login-protection";

export async function authenticateAdministrator(credentials: unknown) {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const { identifier, password } = parsed.data;
  const allowed = await reserveAuthenticationAttempt(identifier);
  if (!allowed) return null;

  const admin = await db.adminUser.findUnique({ where: { identifier } });
  const validPassword = await verifyPassword(password, admin?.passwordHash ?? null);
  if (!admin?.active || !validPassword) return null;

  await db.$transaction(async (tx) => {
    await tx.loginAttempt.deleteMany({ where: { identifier } });
    await tx.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await tx.auditLog.create({ data: {
      adminId: admin.id, action: "CONNEXION", entityType: "AdminUser", entityId: admin.id,
    } });
  });
  return { id: admin.id, name: admin.displayName, sessionVersion: admin.sessionVersion };
}
