import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { BusinessError } from "@/lib/business-error";

export type Actor = { id: string };
export type Transaction = Prisma.TransactionClient;
export type Database = PrismaClient;

export async function audit(tx: Transaction, actor: Actor, action: string, entityType: string, entityId: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { adminId: actor.id, action, entityType, entityId, before, after } });
}

export function missingRecord(name: string): never { throw new BusinessError(`${name} introuvable.`, 404); }

export async function uniqueClassroom<T>(operation: () => Promise<T>) {
  try { return await operation(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BusinessError("Une salle porte déjà ce nom.", 409);
    }
    throw error;
  }
}
