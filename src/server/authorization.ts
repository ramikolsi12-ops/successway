import "server-only";
import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth-options";
import { db } from "@/server/db";

export const currentAdministrator = cache(async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const admin = await db.adminUser.findUnique({ where: { id: session.user.id }, select: {
    id: true, identifier: true, displayName: true, active: true, sessionVersion: true,
  } });
  if (!admin?.active || admin.sessionVersion !== session.user.sessionVersion) return null;
  return admin;
});

export async function requireAdministrator() {
  const admin = await currentAdministrator();
  if (!admin) redirect("/connexion");
  return admin;
}
