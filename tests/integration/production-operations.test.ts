import { Writable } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertTestDatabase, testDatabase } from "../helpers/test-database";

vi.mock("server-only", () => ({}));

import { db as serviceDatabase } from "@/server/db";
import { GET } from "@/app/api/health/route";
import { hasExistingAdministrator, initializeAdministrator } from "../../scripts/docker/init-admin.mjs";

const database = testDatabase();
afterAll(async () => { await database.$disconnect(); await serviceDatabase.$disconnect(); });

describe("Opérations de production sur base jetable", () => {
  it("vérifie la santé après migrations sans session administrateur", async () => {
    assertTestDatabase();
    const response = await GET();
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok" });
  });

  it("détecte un administrateur existant et conserve comptes, paramètres et toutes les écritures financières", async () => {
    const connection = assertTestDatabase();
    expect(await hasExistingAdministrator(connection)).toBe(true);
    const before = {
      administrators: await database.adminUser.findMany({ orderBy: { id: "asc" } }),
      classrooms: await database.classroom.findMany({ orderBy: { id: "asc" } }),
      settings: await database.appSetting.findMany({ orderBy: { key: "asc" } }),
      charges: await database.sessionCharge.findMany({ orderBy: { id: "asc" } }),
      payments: await database.professorPayment.findMany({ orderBy: { id: "asc" } }),
      allocations: await database.paymentAllocation.findMany({ orderBy: { id: "asc" } }),
      audits: await database.auditLog.count(),
    };
    const readPassword = vi.fn(), runSeed = vi.fn();
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    expect(await initializeAdministrator({ environment: { DATABASE_URL: connection }, readPassword, runSeed, output })).toEqual({ created: false });
    expect(readPassword).not.toHaveBeenCalled(); expect(runSeed).not.toHaveBeenCalled();
    expect(await database.adminUser.findMany({ orderBy: { id: "asc" } })).toEqual(before.administrators);
    expect(await database.classroom.findMany({ orderBy: { id: "asc" } })).toEqual(before.classrooms);
    expect(await database.appSetting.findMany({ orderBy: { key: "asc" } })).toEqual(before.settings);
    expect(await database.sessionCharge.findMany({ orderBy: { id: "asc" } })).toEqual(before.charges);
    expect(await database.professorPayment.findMany({ orderBy: { id: "asc" } })).toEqual(before.payments);
    expect(await database.paymentAllocation.findMany({ orderBy: { id: "asc" } })).toEqual(before.allocations);
    expect(await database.auditLog.count()).toBe(before.audits);
  });
});
