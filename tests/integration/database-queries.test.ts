import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { assertTestDatabase } from "../helpers/test-database";
import { createDatabaseClient } from "@/server/db";

const database = createDatabaseClient(assertTestDatabase());
afterAll(async () => { await database.$disconnect(); });

describe("Adaptateur PostgreSQL : relations dans une transaction", () => {
  it("lit les relations parallèles sans utiliser la file de requêtes pg dépréciée", async () => {
    const teacher = await database.teacher.create({ data: { firstName: "Relations", lastName: randomUUID(), phone: "20000000" } });
    const warnings: Error[] = [];
    const observe = (warning: Error) => warnings.push(warning);
    process.on("warning", observe);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const relations = await database.$transaction(async tx => tx.teacher.findUniqueOrThrow({
          where: { id: teacher.id }, include: { agreements: true, sessions: true, charges: true, payments: true, schedules: true },
        }));
        expect(relations.id).toBe(teacher.id);
        expect(relations.agreements).toEqual([]);
        expect(relations.sessions).toEqual([]);
        if (attempt === 0) await database.$disconnect();
      }
      await setImmediate();
      expect(warnings.filter(warning => warning.message.includes("Calling client.query()"))).toEqual([]);
    } finally { process.removeListener("warning", observe); }
  });

  it("préserve le rollback après une erreur SQL et permet une nouvelle transaction", async () => {
    const id = randomUUID();
    await expect(database.$transaction(async tx => {
      await tx.teacher.create({ data: { id, firstName: "Rollback", lastName: randomUUID(), phone: "20000000" } });
      await tx.$queryRaw`SELECT 1 / 0`;
    })).rejects.toThrow();
    expect(await database.teacher.findUnique({ where: { id } })).toBeNull();
    const rows = await database.$transaction(async tx => tx.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`);
    expect(rows).toEqual([{ value: 1 }]);
  });
});
