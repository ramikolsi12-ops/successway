import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { createDatabasePool } from "../../src/server/pg-pool";

export function assertTestDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5435" || url.pathname !== "/centre_formation_test") {
    throw new Error("Tests refusés : utilisez exclusivement centre_formation_test sur localhost:5435 avec .env.test.");
  }
  return url.toString();
}

export function testDatabase() {
  return new PrismaClient({ adapter: new PrismaPg(createDatabasePool(assertTestDatabase()), { disposeExternalPool: true }) });
}

export async function prepareTestDatabase() {
  assertTestDatabase();
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  const db = testDatabase();
  try {
    // Only the guarded, explicitly named disposable test database may be truncated.
    await db.$executeRawUnsafe('TRUNCATE TABLE "PaymentAllocation", "ProfessorPayment", "SessionCharge", "TeachingSession", "RecurrenceSchedule", "RecurrenceSeries", "ProfessorRateAgreement", "Teacher", "Classroom", "AuditLog", "LoginAttempt", "AdminUser", "AppSetting" CASCADE');
    const password = process.env.TEST_ADMIN_PASSWORD;
    if (!password || password.length < 12) throw new Error("TEST_ADMIN_PASSWORD est requis dans .env.test (minimum 12 caractères).");
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], {
      stdio: "inherit", env: { ...process.env, ADMIN_IDENTIFIER: "administrateur", SEED_ADMIN_PASSWORD: password },
    });
  } finally { await db.$disconnect(); }
}
