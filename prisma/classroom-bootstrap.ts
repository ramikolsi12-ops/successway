import type { Prisma } from "../src/generated/prisma/client";

export async function initializeClassrooms(tx: Pick<Prisma.TransactionClient, "classroom" | "appSetting">) {
  const key = "initialClassroomsSeeded";
  if (await tx.appSetting.findUnique({ where: { key } })) return;
  // An existing installation may have renamed or added rooms. Never recreate
  // the original names on top of the administrator's current configuration.
  if (await tx.classroom.count() === 0) {
    for (let number = 1; number <= 6; number++) {
      const name = `Salle ${number}`;
      await tx.classroom.upsert({ where: { name }, update: {}, create: { name } });
    }
  }
  await tx.appSetting.upsert({ where: { key }, update: {}, create: { key, value: true } });
}
