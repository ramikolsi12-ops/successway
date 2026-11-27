import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { money } from "@/lib/money";

const mocks = vi.hoisted(() => ({ tx: {
  $queryRaw: vi.fn(),
  classroom: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  teacher: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  professorRateAgreement: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  teachingSession: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  recurrenceSchedule: { findMany: vi.fn() },
  sessionCharge: { update: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ db: { $transaction: async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx) } }));

import { setClassroomActive } from "@/services/classrooms";
import { createProfessor, setProfessorActive } from "@/services/professors";
import { createRateAgreement } from "@/services/pricing";

const id = "11111111-1111-4111-8111-111111111111";
const actor = { id: "22222222-2222-4222-8222-222222222222" };
const oldRate = {
  id: "33333333-3333-4333-8333-333333333333", teacherId: id, pricePerSession: money("20.000"),
  startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, active: true, notes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), expectedDurationMinutes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T09:00:00Z"));
  mocks.tx.$queryRaw.mockResolvedValue([{ id }]);
  mocks.tx.classroom.findUnique.mockResolvedValue({ id, active: true });
  mocks.tx.classroom.update.mockResolvedValue({ id, active: false });
  mocks.tx.teacher.findUnique.mockResolvedValue({ id, active: true });
  mocks.tx.teacher.create.mockResolvedValue({ id });
  mocks.tx.teacher.update.mockResolvedValue({ id, active: false });
  mocks.tx.teachingSession.findMany.mockResolvedValue([]);
  mocks.tx.recurrenceSchedule.findMany.mockResolvedValue([]);
  mocks.tx.teachingSession.findFirst.mockResolvedValue(null);
  mocks.tx.professorRateAgreement.findMany.mockResolvedValue([]);
  mocks.tx.professorRateAgreement.create.mockResolvedValue({ ...oldRate, id });
  mocks.tx.professorRateAgreement.update.mockResolvedValue(oldRate);
  mocks.tx.auditLog.create.mockResolvedValue({ id });
});
afterEach(() => vi.useRealTimers());

describe("Gestion transactionnelle des salles", () => {
  it("désactive et audite une salle libre après confirmation", async () => {
    expect(await setClassroomActive(id, { active: false, confirmed: true }, actor)).toEqual({ id, active: false });
    expect(mocks.tx.classroom.update).toHaveBeenCalledWith({ where: { id }, data: { active: false } });
    expect(mocks.tx.auditLog.create).toHaveBeenCalled();
  });
  it("refuse une désactivation avec réservation et renvoie les séances concernées", async () => {
    mocks.tx.teachingSession.findMany.mockResolvedValueOnce([{ id, teacherId: id, classroomId: id, recurrenceId: null, occurrenceWeek: null, originalDate: null, isException: false, startAt: new Date("2026-11-22T10:00:00Z"), endAt: new Date("2026-11-22T12:00:00Z"), status: "PLANIFIEE", notes: null, rateSnapshot: null, teacher: { firstName: "Ahmed", lastName: "Test", agreements: [] }, classroom: { name: "Salle 1" }, charge: null, recurrence: null }]);
    await expect(setClassroomActive(id, { active: false, confirmed: true }, actor)).rejects.toMatchObject({ status: 409, details: { sessions: expect.arrayContaining([expect.objectContaining({ teacherName: "Ahmed Test" })]) } });
    expect(mocks.tx.classroom.update).not.toHaveBeenCalled();
  });
  it("réactive une salle sans toucher aux séances historiques", async () => {
    mocks.tx.classroom.findUnique.mockResolvedValue({ id, active: false });
    await setClassroomActive(id, { active: true }, actor);
    expect(mocks.tx.classroom.update).toHaveBeenCalledWith({ where: { id }, data: { active: true } });
    expect(mocks.tx.teachingSession.updateMany).not.toHaveBeenCalled();
  });
});

describe("Gestion des professeurs", () => {
  it("crée un professeur et un audit, sans compte utilisateur", async () => {
    await createProfessor({ firstName: "Ahmed", lastName: "Ben Ali", phone: "20 123 456" }, actor);
    expect(mocks.tx.teacher.create).toHaveBeenCalledWith({ data: expect.objectContaining({ firstName: "Ahmed", active: true, email: null }) });
    expect(mocks.tx.auditLog.create).toHaveBeenCalled();
  });
  it("valide avant toute écriture", async () => {
    await expect(createProfessor({ firstName: "", lastName: "Test", phone: "1" }, actor)).rejects.toThrow();
    expect(mocks.tx.teacher.create).not.toHaveBeenCalled();
  });
  it("archive sans supprimer les séances ou les finances", async () => {
    await setProfessorActive(id, { active: false, confirmed: true }, actor);
    expect(mocks.tx.teacher.update).toHaveBeenCalledWith({ where: { id }, data: { active: false } });
    expect(mocks.tx.teachingSession.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.sessionCharge.updateMany).not.toHaveBeenCalled();
  });
});

describe("Historique des prix", () => {
  it("refuse un tarif qui chevauche un tarif existant", async () => {
    mocks.tx.professorRateAgreement.findMany.mockResolvedValue([oldRate]);
    await expect(createRateAgreement(id, { pricePerSession: "30.000", startDate: "2026-12-01" }, actor)).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.professorRateAgreement.create).not.toHaveBeenCalled();
  });
  it("clôture la période précédente sans modifier son prix ni les montants historiques", async () => {
    mocks.tx.professorRateAgreement.findMany.mockResolvedValue([oldRate]);
    mocks.tx.teachingSession.findFirst.mockResolvedValue({ startAt: new Date("2026-11-20T10:00:00Z") });
    await createRateAgreement(id, { pricePerSession: "30.125", startDate: "2026-12-01", closePrevious: true }, actor);
    expect(mocks.tx.professorRateAgreement.update).toHaveBeenCalledWith({ where: { id: oldRate.id }, data: { endDate: new Date("2026-11-30T00:00:00Z") } });
    expect(oldRate.pricePerSession.toFixed(3)).toBe("20.000");
    expect(mocks.tx.teachingSession.update).not.toHaveBeenCalled();
    expect(mocks.tx.sessionCharge.update).not.toHaveBeenCalled();
    expect(mocks.tx.professorRateAgreement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pricePerSession: money("30.125") }) });
  });
  it("interdit de raccourcir une période déjà utilisée par une séance terminée", async () => {
    mocks.tx.professorRateAgreement.findMany.mockResolvedValue([oldRate]);
    mocks.tx.teachingSession.findFirst.mockResolvedValue({ startAt: new Date("2026-12-10T10:00:00Z") });
    await expect(createRateAgreement(id, { pricePerSession: "30.000", startDate: "2026-12-01", closePrevious: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.professorRateAgreement.update).not.toHaveBeenCalled();
  });
});
