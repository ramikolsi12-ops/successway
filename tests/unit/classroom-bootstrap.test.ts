import { describe, expect, it, vi } from "vitest";
import { initializeClassrooms } from "../../prisma/classroom-bootstrap";

function fixture(count: number, initialized = false) {
  return { classroom: { count: vi.fn(async () => count), upsert: vi.fn(async () => ({})) },
    appSetting: { findUnique: vi.fn(async () => initialized ? { value: true } : null), upsert: vi.fn(async () => ({})) } };
}
type BootstrapTransaction = Parameters<typeof initializeClassrooms>[0];

describe("Initialisation des salles", () => {
  it("crée les six salles uniquement pour une installation vide", async () => {
    const tx = fixture(0);
    await initializeClassrooms(tx as unknown as BootstrapTransaction);
    expect(tx.classroom.upsert).toHaveBeenCalledTimes(6);
    expect(tx.classroom.upsert).toHaveBeenCalledWith({ where: { name: "Salle 6" }, update: {}, create: { name: "Salle 6" } });
  });
  it("ne duplique pas les salles existantes même si leurs noms ont changé", async () => {
    const tx = fixture(6);
    await initializeClassrooms(tx as unknown as BootstrapTransaction);
    expect(tx.classroom.upsert).not.toHaveBeenCalled();
    expect(tx.appSetting.upsert).toHaveBeenCalled();
  });
  it("ne recrée pas de salles lors d’une nouvelle initialisation", async () => {
    const tx = fixture(7, true);
    await initializeClassrooms(tx as unknown as BootstrapTransaction);
    expect(tx.classroom.count).not.toHaveBeenCalled();
    expect(tx.classroom.upsert).not.toHaveBeenCalled();
  });
});
