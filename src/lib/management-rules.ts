import { BusinessError } from "@/lib/business-error";
import type { RateAgreementRow, SessionRow } from "@/types/management";

export function blockingClassroomSessions(sessions: SessionRow[], now: Date) {
  return sessions.filter(session => ["PLANIFIEE", "EN_COURS"].includes(session.status) && new Date(session.endAt) > now);
}

export function assertClassroomCanDeactivate(sessions: SessionRow[], now: Date) {
  const affected = blockingClassroomSessions(sessions, now);
  if (affected.length) throw new BusinessError(
    "Cette salle possède des séances planifiées à venir ou en cours. Annulez-les ou réaffectez-les avant de désactiver la salle.",
    409, { sessions: affected },
  );
}

export function findApplicableAgreement(agreements: RateAgreementRow[], date: string) {
  const matching = agreements.filter(agreement => agreement.active && agreement.startDate <= date && (!agreement.endDate || agreement.endDate >= date));
  if (matching.length > 1) throw new BusinessError("Plusieurs tarifs sont applicables à cette date.", 409);
  return matching[0] ?? null;
}

export function agreementToClose(agreements: RateAgreementRow[], startDate: string, endDate: string | null, closePrevious: boolean) {
  const overlapping = agreements.filter(agreement => agreement.active
    && (!endDate || agreement.startDate <= endDate) && (!agreement.endDate || agreement.endDate >= startDate));
  if (!overlapping.length) return null;
  if (!closePrevious || overlapping.length !== 1 || overlapping[0].startDate >= startDate) {
    throw new BusinessError("Ce tarif chevauche une tarification existante. Ajustez les dates ou clôturez le tarif précédent.", 409);
  }
  return overlapping[0];
}

export function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
