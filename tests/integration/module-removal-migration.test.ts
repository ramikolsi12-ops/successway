import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg, { type Client } from "pg";
import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "../helpers/test-database";

const migration = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
const removalSql = migration("20261122000300_remove_student_group_subject_modules");
const removedTables = ["Student", "StudentGroup", "Group", "Subject", "TeacherSubject", "EducationLevel", "Attendance"];

async function withLegacySchema(run: (client: Client, schema: string) => Promise<void>) {
  const client = new pg.Client({ connectionString: assertTestDatabase() });
  const schema = `module_removal_test_${randomUUID().replaceAll("-", "")}`;
  if (!/^module_removal_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Schéma de test invalide.");
  const identifier = pg.escapeIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${identifier}`);
    await client.query(`SET search_path TO ${identifier}, public`);
    await client.query(migration("20261122000100_initial"));
    await client.query(migration("20261122000200_invariants"));
    await run(client, schema);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA ${identifier} CASCADE`);
    await client.end();
  }
}

describe("Migration de simplification", () => {
  it("retire les inscriptions en préservant les séances, tarifs, comptes et paiements existants", async () => {
    await withLegacySchema(async (client, schema) => {
      const ids = Object.fromEntries(["teacher", "subject", "level", "group", "student", "room", "contract", "session", "earning", "payment", "allocation", "admin", "audit"].map(key => [key, randomUUID()]));
      await client.query('INSERT INTO "AdminUser" (id,identifier,"passwordHash","updatedAt") VALUES ($1,\'migration-admin\',\'fixture-hash-preserved\',now())', [ids.admin]);
      await client.query('INSERT INTO "Teacher" (id,"firstName","lastName",phone,"updatedAt") VALUES ($1,\'Ahmed\',\'Test\',\'20000000\',now())', [ids.teacher]);
      await client.query('INSERT INTO "Subject" (id,name,"updatedAt") VALUES ($1,\'Matière historique\',now())', [ids.subject]);
      await client.query('INSERT INTO "EducationLevel" (id,name,"updatedAt") VALUES ($1,\'Niveau historique\',now())', [ids.level]);
      await client.query('INSERT INTO "Group" (id,name,"educationLevelId","subjectId","updatedAt") VALUES ($1,\'Groupe historique\',$2,$3,now())', [ids.group, ids.level, ids.subject]);
      await client.query('INSERT INTO "Student" (id,"firstName","lastName","educationLevelId","updatedAt") VALUES ($1,\'Amal\',\'Test\',$2,now())', [ids.student, ids.level]);
      await client.query('INSERT INTO "TeacherSubject" ("teacherId","subjectId") VALUES ($1,$2)', [ids.teacher, ids.subject]);
      await client.query('INSERT INTO "StudentGroup" (id,"studentId","groupId","updatedAt") VALUES ($1,$2,$3,now())', [randomUUID(), ids.student, ids.group]);
      await client.query('INSERT INTO "Classroom" (id,name,"updatedAt") VALUES ($1,\'Salle historique\',now())', [ids.room]);
      await client.query(`INSERT INTO "TeacherContract" (id,"teacherId","subjectId","groupId","amountPerSession","startDate","updatedAt")
        VALUES ($1,$2,$3,$4,50.000,'2026-01-01',now())`, [ids.contract, ids.teacher, ids.subject, ids.group]);
      await client.query(`INSERT INTO "TeachingSession" (id,"teacherId","groupId","subjectId","classroomId","startAt","endAt",status,"contractId","rateSnapshot","completedAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,'2026-11-22 10:00Z','2026-11-22 12:00Z','TERMINEE',$6,50.000,now(),now())`, [ids.session, ids.teacher, ids.group, ids.subject, ids.room, ids.contract]);
      await client.query('INSERT INTO "Attendance" (id,"sessionId","studentId",status,"updatedAt") VALUES ($1,$2,$3,\'PRESENT\',now())', [randomUUID(), ids.session, ids.student]);
      await client.query(`INSERT INTO "TeacherEarning" (id,"teacherId","sessionId","contractId",amount,"earnedAt","idempotencyKey","updatedAt")
        VALUES ($1,$2,$3,$4,50.000,now(),$5,now())`, [ids.earning, ids.teacher, ids.session, ids.contract, randomUUID()]);
      await client.query(`INSERT INTO "TeacherPayment" (id,"teacherId","paymentDate",amount,method,"idempotencyKey","updatedAt")
        VALUES ($1,$2,CURRENT_DATE,20.000,'ESPECES',$3,now())`, [ids.payment, ids.teacher, randomUUID()]);
      await client.query(`INSERT INTO "PaymentAllocation" (id,"paymentId","earningId",amount,"idempotencyKey","updatedAt")
        VALUES ($1,$2,$3,20.000,$4,now())`, [ids.allocation, ids.payment, ids.earning, randomUUID()]);
      await client.query('INSERT INTO "AuditLog" (id,"adminId",action,"entityType","entityId") VALUES ($1,$2,\'TEST_PAIEMENT\',\'TeacherPayment\',$3)', [ids.audit, ids.admin, ids.payment]);

      await client.query(removalSql);

      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])", [schema, removedTables]);
      expect(tables.rows).toEqual([]);
      const account = await client.query('SELECT "passwordHash" FROM "AdminUser" WHERE id=$1', [ids.admin]);
      expect(account.rows).toEqual([{ passwordHash: "fixture-hash-preserved" }]);
      const amounts = await client.query(`SELECT s."rateSnapshot"::text AS rate, e.amount::text AS earned, p.amount::text AS paid, a.amount::text AS allocated
        FROM "TeachingSession" s JOIN "TeacherContract" c ON c.id=s."contractId"
        JOIN "Teacher" t ON t.id=s."teacherId" JOIN "Classroom" r ON r.id=s."classroomId"
        JOIN "TeacherEarning" e ON e."sessionId"=s.id
        JOIN "PaymentAllocation" a ON a."earningId"=e.id
        JOIN "TeacherPayment" p ON p.id=a."paymentId" WHERE s.id=$1`, [ids.session]);
      expect(amounts.rows).toEqual([{ rate: "50.000", earned: "50.000", paid: "20.000", allocated: "20.000" }]);
      expect((await client.query('SELECT id FROM "AuditLog" WHERE id=$1', [ids.audit])).rowCount).toBe(1);
    });
  });

  it("annule toute la migration si des anciens tarifs deviennent ambigus", async () => {
    await withLegacySchema(async client => {
      const teacher = randomUUID();
      await client.query('INSERT INTO "Teacher" (id,"firstName","lastName",phone,"updatedAt") VALUES ($1,\'Ahmed\',\'Test\',\'20000000\',now())', [teacher]);
      for (const name of ["Première matière", "Seconde matière"]) {
        const subject = randomUUID();
        await client.query('INSERT INTO "Subject" (id,name,"updatedAt") VALUES ($1,$2,now())', [subject, name]);
        await client.query(`INSERT INTO "TeacherContract" (id,"teacherId","subjectId","amountPerSession","startDate","updatedAt")
          VALUES ($1,$2,$3,50.000,'2026-01-01',now())`, [randomUUID(), teacher, subject]);
      }
      await expect(client.query(removalSql)).rejects.toMatchObject({ code: "23P01" });
      await client.query("ROLLBACK");
      expect((await client.query('SELECT "subjectId" FROM "TeacherContract"')).rows).toHaveLength(2);
      expect((await client.query('SELECT id FROM "Subject"')).rows).toHaveLength(2);
    });
  });
});
