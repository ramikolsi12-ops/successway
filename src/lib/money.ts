import { Prisma } from "@/generated/prisma/client";

export function money(value: string): Prisma.Decimal {
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(value)) {
    throw new Error("Le montant doit avoir au maximum trois décimales.");
  }
  return new Prisma.Decimal(value);
}

