import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../helpers/test-database";

const db = testDatabase();
let teacherId: string, roomId: string;

beforeAll(async () => {
  const teacher = await db.teacher.create({ data: { firstName: "Ahmed", lastName: "Test", phone: "20000000" } });
  teacherId = teacher.id;
  const room = await db.classroom.findUniqueOrThrow({ where: { name: "Salle 1" } });
  roomId = room.id;
});
afterAll(async () => { await db.$disconnect(); });

function session(startAt: string, endAt: string) {
  return { teacherId, classroomId: roomId, startAt: new Date(startAt), endAt: new Date(endAt) };
}

describe("Fondation PostgreSQL", () => {
  it("initialise les six salles de départ", async () => {
    expect(await db.classroom.count({ where: { name: { in: Array.from({ length: 6 }, (_, index) => `Salle ${index + 1}`) } } })).toBe(6);
  });
  it("préserve le compte et les salles quand l’initialisation est répétée", async () => {
    const before = await db.adminUser.findUniqueOrThrow({ where: { identifier: "administrateur" } });
    const roomCountBefore = await db.classroom.count();
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], {
      stdio: "inherit", env: { ...process.env, SEED_ADMIN_PASSWORD: "Different-test-password-2026!" },
    });
    const after = await db.adminUser.findUniqueOrThrow({ where: { identifier: "administrateur" } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await db.adminUser.count()).toBe(1);
    expect(await db.classroom.count()).toBe(roomCountBefore);
  });
  it("ne conserve aucune table ou liaison des modules supprimés", async () => {
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('Student', 'StudentGroup', 'Group', 'Subject', 'TeacherSubject', 'EducationLevel', 'Attendance')`;
    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('ProfessorRateAgreement', 'TeachingSession') AND column_name IN ('subjectId', 'groupId')`;
    expect(tables).toEqual([]);
    expect(columns).toEqual([]);
  });
  it("refuse deux conventions actives qui se chevauchent pour un professeur", async () => {
    await db.professorRateAgreement.create({ data: { teacherId, pricePerSession: "50.000", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    await expect(db.professorRateAgreement.create({ data: { teacherId, pricePerSession: "60.000", startDate: new Date("2026-06-01") } })).rejects.toThrow();
    await expect(db.professorRateAgreement.create({ data: { teacherId, pricePerSession: "60.000", startDate: new Date("2027-01-01") } })).resolves.toBeDefined();
  });
  it("autorise un seul des deux horaires concurrents", async () => {
    const data = session("2026-11-23T13:00Z", "2026-11-23T15:00Z");
    const results = await Promise.allSettled([db.teachingSession.create({ data }), db.teachingSession.create({ data })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
  it("autorise les horaires adjacents et ignore les séances annulées", async () => {
    const adjacent = await db.teachingSession.create({ data: session("2026-11-23T15:00Z", "2026-11-23T16:00Z") });
    expect(adjacent.status).toBe("PLANIFIEE");
    const cancelled = await db.teachingSession.create({ data: { ...session("2026-11-23T13:00Z", "2026-11-23T15:00Z"), status: "ANNULEE" } });
    expect(cancelled.status).toBe("ANNULEE");
  });
  it("refuse la finalisation sans tarif figé", async () => {
    await expect(db.teachingSession.create({ data: { ...session("2026-11-24T13:00Z", "2026-11-24T15:00Z"), status: "TERMINEE" } })).rejects.toThrow();
  });
  it("ne finalise pas automatiquement les séances passées", async () => {
    const past = await db.teachingSession.create({ data: session("2020-01-01T13:00Z", "2020-01-01T15:00Z") });
    expect(past.status).toBe("PLANIFIEE");
    expect(await db.sessionCharge.count({ where: { sessionId: past.id } })).toBe(0);
  });
  it("refuse les paiements négatifs et préserve l’historique", async () => {
    await expect(db.professorPayment.create({ data: { teacherId, amount: "-0.001", paymentDate: new Date(), method: "ESPECES", idempotencyKey: randomUUID() } })).rejects.toThrow();
    const payment = await db.$transaction(async tx => {
      const completed = await tx.teachingSession.create({ data: { ...session("2026-11-26T13:00Z", "2026-11-26T15:00Z"), status: "TERMINEE", completedAt: new Date(), rateSnapshot: "12.345", priceOverride: "12.345", rateOverrideReason: "Tarif exceptionnel de vérification" } });
      const charge = await tx.sessionCharge.create({ data: { teacherId, sessionId: completed.id, amount: "12.345", pricingSource: "EXCEPTIONNEL", chargedAt: new Date(), idempotencyKey: randomUUID() } });
      const receipt = await tx.professorPayment.create({ data: { teacherId, amount: "12.345", paymentDate: new Date(), idempotencyKey: randomUUID() } });
      await tx.paymentAllocation.create({ data: { paymentId: receipt.id, chargeId: charge.id, amount: "12.345", idempotencyKey: randomUUID() } });
      return receipt;
    });
    expect(payment.amount.toFixed(3)).toBe("12.345");
    await expect(db.professorPayment.delete({ where: { id: payment.id } })).rejects.toThrow();
  });
});
