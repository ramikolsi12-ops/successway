import "server-only";
import { db } from "@/server/db";
import { agreementToClose, previousDate } from "@/lib/management-rules";
import { BusinessError } from "@/lib/business-error";
import { money } from "@/lib/money";
import { tunisDate } from "@/lib/dates";
import { rateAgreementSchema, uuidSchema } from "@/validations/management";
import { audit, missingRecord, type Actor } from "@/services/management-shared";
import type { RateAgreementRow } from "@/types/management";
import type { ProfessorRateAgreement } from "@/generated/prisma/client";

export function agreementRow(value: ProfessorRateAgreement): RateAgreementRow {
  return { id: value.id, pricePerSession: value.pricePerSession.toFixed(3), startDate: value.startDate.toISOString().slice(0, 10),
    endDate: value.endDate?.toISOString().slice(0, 10) ?? null, active: value.active, notes: value.notes, createdAt: value.createdAt.toISOString() };
}

export async function createRateAgreement(teacherId: string, input: unknown, actor: Actor) {
  uuidSchema.parse(teacherId);
  const data = rateAgreementSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${teacherId}::uuid FOR UPDATE`;
    if (!await tx.teacher.findUnique({ where: { id: teacherId }, select: { id: true } })) missingRecord("Professeur");
    const history = await tx.professorRateAgreement.findMany({ where: { teacherId }, orderBy: { startDate: "desc" } });
    const previous = agreementToClose(history.map(agreementRow), data.startDate, data.endDate, data.closePrevious);
    if (previous) {
      const lastUsed = await tx.teachingSession.findFirst({
        where: { status: "TERMINEE", OR: [{ rateAgreementId: previous.id }, { charge: { rateAgreementId: previous.id } }] },
        orderBy: { startAt: "desc" }, select: { startAt: true },
      });
      if (lastUsed && tunisDate(lastUsed.startAt).format("YYYY-MM-DD") >= data.startDate) {
        throw new BusinessError("Le tarif précédent a déjà été appliqué à des séances sur cette période. Choisissez une date plus récente.", 409);
      }
      const endDate = previousDate(data.startDate);
      await tx.professorRateAgreement.update({ where: { id: previous.id }, data: { endDate: new Date(`${endDate}T00:00:00Z`) } });
      await audit(tx, actor, "CLOTURE_TARIF", "ProfessorRateAgreement", previous.id, { endDate: previous.endDate }, { endDate });
    }
    const agreement = await tx.professorRateAgreement.create({ data: {
      teacherId, pricePerSession: money(data.pricePerSession), startDate: new Date(`${data.startDate}T00:00:00Z`),
      endDate: data.endDate ? new Date(`${data.endDate}T00:00:00Z`) : null, notes: data.notes,
    } });
    await audit(tx, actor, "CREATION_TARIF", "ProfessorRateAgreement", agreement.id, undefined,
      { teacherId, pricePerSession: agreement.pricePerSession.toFixed(3), startDate: data.startDate, endDate: data.endDate });
    return agreementRow(agreement);
  });
}
