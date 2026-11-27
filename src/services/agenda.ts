import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/business-error";
import { tunisDate } from "@/lib/dates";
import { addDays, atTunis, canTransition, generateWeekly, intervalsOverlap, minutesOf, occurrenceDate, weekMonday } from "@/lib/scheduling";
import { cancellationSchema, dateSchema, endRecurrenceSchema, recurrenceUpdateSchema, sessionEditSchema, sessionInputSchema, statusChangeSchema } from "@/validations/agenda";
import { uuidSchema } from "@/validations/management";
import { audit, missingRecord, type Actor, type Transaction } from "@/services/management-shared";
import { agendaScheduleRelations, agendaSessionRelations, blocksTime, concreteEvent, dateString, dateValue, readAgendaEvents, type ConcreteSession } from "@/services/agenda-read";
import type { AgendaData, AgendaEvent } from "@/types/agenda";
import { money } from "@/lib/money";
import { agreementRow } from "@/services/pricing";
import { readFinancialState, readSessionFinancialDetails } from "@/services/financial-state";
import { commandAudit, recordedCommand, financialTransaction, financeArrays, previewFinancialChange, assertPreview, auditContext, reverseAllocations, allocatePaymentsToCharges } from "@/services/payments";
import { assertFinancialIntegrity } from "@/services/financial-state";
import { priceCorrectionPreviewSchema, priceCorrectionSchema } from "@/validations/payments";
import type { CorrectionPreview } from "@/types/payments";
import { getCentreSettings } from "@/services/settings";
import { assertCentreSlot, assertCentreWeeklySchedule } from "@/services/opening-hours";

/** Shared with database guards, availability and administrative status changes. */
export async function lockAgenda(tx: Transaction) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
}

async function agendaWrite<T>(operation: (tx: Transaction) => Promise<T>) {
  try {
    return await db.$transaction(async tx => { await lockAgenda(tx); return operation(tx); }, { timeout: 20000, maxWait: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (["P2002", "P2034"].includes(error.code)
      || (error.code === "P2010" && ["23P01", "40001", "40P01"].includes(String(error.meta?.code))))) {
      throw new BusinessError("Une réservation concurrente empêche cette opération. Actualisez l’agenda et vérifiez la salle et le professeur.", 409);
    }
    throw error;
  }
}

export async function getAgenda(input?: string): Promise<AgendaData> {
  const date = dateSchema.parse(input ?? tunisDate().format("YYYY-MM-DD"));
  return db.$transaction(async tx => {
    const { openingMinute, closingMinute, openingDays } = await getCentreSettings(tx);
    const events = await readAgendaEvents(tx, date, date);
    const classrooms = await tx.classroom.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
    const professors = await tx.teacher.findMany({ include: { agreements: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
    const visibleCharges = await readSessionFinancialDetails(tx, events.flatMap(event => event.status === "TERMINEE" && event.sessionId ? [event.sessionId] : []));
    const financialBySession = new Map(visibleCharges.map(charge => [charge.sessionId, charge]));
    for (const event of events) if (event.status === "TERMINEE" && event.sessionId) event.financial = financialBySession.get(event.sessionId) ?? null;
    return { date, openingHours: { openingMinute, closingMinute, openingDays }, events, classrooms, professors: professors.map(value => ({ id: value.id, name: `${value.firstName} ${value.lastName}`, active: value.active, agreements: value.agreements.map(agreementRow) })) };
  }, { isolationLevel: "RepeatableRead" });
}

async function assertActive(tx: Transaction, teacherId: string, classroomId: string) {
  const room = await tx.classroom.findUnique({ where: { id: classroomId } });
  if (!room) missingRecord("Salle");
  if (!room.active) throw new BusinessError("Impossible de réserver une salle inactive.", 409);
  const professor = await tx.teacher.findUnique({ where: { id: teacherId } });
  if (!professor) missingRecord("Professeur");
  if (!professor.active) throw new BusinessError("Impossible de réserver pour un professeur inactif.", 409);
}

function conflict(room: boolean): never {
  throw new BusinessError(room ? "Cette salle est déjà réservée sur ce créneau." : "Ce professeur possède déjà une séance à cet horaire.", 409);
}

async function assertSlot(tx: Transaction, proposal: { teacherId: string; classroomId: string; startAt: Date; endAt: Date }, exceptId?: string) {
  const date = tunisDate(proposal.startAt).format("YYYY-MM-DD");
  const events = await readAgendaEvents(tx, date, date);
  for (const event of events) {
    if (event.id === exceptId || !blocksTime(event.status)) continue;
    if (intervalsOverlap(proposal.startAt, proposal.endAt, new Date(event.startAt), new Date(event.endAt))) {
      if (event.classroomId === proposal.classroomId) conflict(true);
      if (event.teacherId === proposal.teacherId) conflict(false);
    }
  }
}

interface ProposedSchedule {
  recurrenceId: string;
  teacherId: string;
  classroomId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  startDate: string;
  endDate: string | null;
}

/** Exact weekly checks, including distant or unbounded recurrences. No fixed generation horizon. */
async function assertSchedule(tx: Transaction, proposed: ProposedSchedule) {
  await assertCentreWeeklySchedule(tx, await getCentreSettings(tx), proposed);
  const schedules = await tx.recurrenceSchedule.findMany({ where: { supersededAt: null, recurrence: { active: true }, recurrenceId: { not: proposed.recurrenceId },
    OR: [{ classroomId: proposed.classroomId }, { teacherId: proposed.teacherId }] } });
  const concrete = await tx.teachingSession.findMany({ where: { status: { in: ["PLANIFIEE", "EN_COURS", "TERMINEE"] }, endAt: { gt: atTunis(proposed.startDate, "00:00") },
    OR: [{ classroomId: proposed.classroomId }, { teacherId: proposed.teacherId }] } });
  const materialized = await tx.teachingSession.findMany({ where: { recurrenceId: { not: null } }, select: { recurrenceId: true, occurrenceWeek: true } });
  const keys = new Set(materialized.filter(item => item.occurrenceWeek).map(item => `${item.recurrenceId}@${dateString(item.occurrenceWeek!)}`));
  for (const session of concrete) {
    const from = [proposed.startDate, tunisDate(session.startAt).format("YYYY-MM-DD")].sort().at(-1)!;
    const until = [proposed.endDate, tunisDate(session.endAt).format("YYYY-MM-DD")].filter((value): value is string => value !== null).sort()[0];
    let date = occurrenceDate(weekMonday(from), proposed.weekday);
    if (date < from) date = addDays(date, 7);
    for (let n = 0; n <= materialized.length + 1 && date <= until; n++, date = addDays(date, 7)) {
      const occurrence = generateWeekly(proposed, date, date)[0];
      if (!occurrence || keys.has(`${proposed.recurrenceId}@${occurrence.week}`)) continue;
      if (intervalsOverlap(session.startAt, session.endAt, occurrence.startAt, occurrence.endAt)) conflict(session.classroomId === proposed.classroomId);
    }
  }
  for (const schedule of schedules) {
    if (schedule.weekday !== proposed.weekday || !intervalsOverlap(schedule.startMinute, schedule.endMinute, proposed.startMinute, proposed.endMinute)) continue;
    const lower = [proposed.startDate, dateString(schedule.startDate)].sort().at(-1)!;
    const upper = [proposed.endDate, schedule.endDate ? dateString(schedule.endDate) : null].filter((value): value is string => value !== null).sort()[0];
    let date = occurrenceDate(weekMonday(lower), proposed.weekday);
    if (date < lower) date = addDays(date, 7);
    const firstWeekAvailable = keys.has(`${schedule.recurrenceId}@${weekMonday(date)}`)
      && !concrete.some(session => session.recurrenceId === schedule.recurrenceId
        && session.occurrenceWeek && dateString(session.occurrenceWeek) === weekMonday(date)
        && intervalsOverlap(session.startAt, session.endAt, atTunis(date, "00:00").getTime() + proposed.startMinute * 60_000,
          atTunis(date, "00:00").getTime() + proposed.endMinute * 60_000));
    // Only finitely many persisted weeks can suppress an otherwise weekly conflict.
    for (let n = 0; n <= materialized.length + 1 && (!upper || date <= upper); n++, date = addDays(date, 7)) {
      const week = weekMonday(date);
      if (keys.has(`${proposed.recurrenceId}@${week}`) || keys.has(`${schedule.recurrenceId}@${week}`)) continue;
      if (firstWeekAvailable) throw new BusinessError("Ce créneau est disponible cette semaine uniquement. Une séance fixe existe encore pour les semaines suivantes.", 409);
      conflict(schedule.classroomId === proposed.classroomId);
    }
  }
}

async function resolveSession(tx: Transaction, id: string): Promise<ConcreteSession> {
  if (!id.includes("@")) {
    uuidSchema.parse(id);
    const session = await tx.teachingSession.findUnique({ where: { id }, include: agendaSessionRelations });
    if (!session) missingRecord("Séance");
    return session;
  }
  const [recurrenceId, week, extra] = id.split("@");
  uuidSchema.parse(recurrenceId); dateSchema.parse(week);
  if (extra || weekMonday(week) !== week) throw new BusinessError("L’occurrence sélectionnée est invalide.");
  const existing = await tx.teachingSession.findUnique({ where: { recurrenceId_occurrenceWeek: { recurrenceId, occurrenceWeek: dateValue(week) } }, include: agendaSessionRelations });
  if (existing) return existing;
  const schedules = await tx.recurrenceSchedule.findMany({ where: { supersededAt: null, recurrenceId, recurrence: { active: true } }, include: agendaScheduleRelations });
  for (const schedule of schedules) {
    const occurrence = generateWeekly({ ...schedule, startDate: dateString(schedule.startDate), endDate: schedule.endDate ? dateString(schedule.endDate) : null }, week, addDays(week, 6))[0];
    if (!occurrence) continue;
    // Stage as non-blocking, then the caller applies the final status in this same
    // transaction. This permits cancelling/closing history after deactivation;
    // ordinary booking edits and starts still require active resources.
    const created = await tx.teachingSession.create({ data: { teacherId: schedule.teacherId, classroomId: schedule.classroomId, recurrenceId,
      occurrenceWeek: dateValue(week), originalDate: dateValue(occurrence.date), startAt: occurrence.startAt, endAt: occurrence.endAt,
      status: "ANNULEE", notes: schedule.notes }, include: agendaSessionRelations });
    return { ...created, status: "PLANIFIEE" };
  }
  missingRecord("Occurrence fixe");
}

export async function createAgendaSession(input: unknown, actor: Actor): Promise<AgendaEvent> {
  const data = sessionInputSchema.parse(input);
  return agendaWrite(async tx => {
    await assertActive(tx, data.teacherId, data.classroomId);
    if (data.type === "PROVISOIRE") {
      assertCentreSlot(await getCentreSettings(tx), { date: data.date, startMinute: minutesOf(data.startTime), endMinute: minutesOf(data.endTime) });
      const times = { startAt: atTunis(data.date, data.startTime), endAt: atTunis(data.date, data.endTime) };
      await assertSlot(tx, { ...data, ...times });
      const session = await tx.teachingSession.create({ data: { teacherId: data.teacherId, classroomId: data.classroomId, ...times, notes: data.notes }, include: agendaSessionRelations });
      if (data.priceOverride !== undefined && data.priceOverride !== null) {
        await tx.teachingSession.update({ where: { id: session.id }, data: { priceOverride: money(data.priceOverride) } });
        session.priceOverride = money(data.priceOverride);
      }
      await audit(tx, actor, "CREATION_SEANCE_PROVISOIRE", "TeachingSession", session.id, undefined, { ...data });
      return concreteEvent(session);
    }
    const recurrenceId = randomUUID();
    const startDate = data.recurrenceStartDate ?? data.date;
    const weekday = data.weekday ?? (new Date(`${data.date}T12:00:00Z`).getUTCDay() || 7);
    const proposed: ProposedSchedule = { recurrenceId, teacherId: data.teacherId, classroomId: data.classroomId, weekday,
      startMinute: minutesOf(data.startTime), endMinute: minutesOf(data.endTime), startDate, endDate: data.recurrenceEndDate ?? null };
    await assertSchedule(tx, proposed);
    await tx.recurrenceSeries.create({ data: { id: recurrenceId, description: data.notes } });
    await tx.recurrenceSchedule.create({ data: { ...proposed, startDate: dateValue(startDate), endDate: proposed.endDate ? dateValue(proposed.endDate) : null, notes: data.notes } });
    await audit(tx, actor, "CREATION_PROGRAMMATION_FIXE", "RecurrenceSeries", recurrenceId, undefined, { ...data });
    const occurrenceDateValue = occurrenceDate(weekMonday(startDate), weekday);
    const first = occurrenceDateValue < startDate ? addDays(occurrenceDateValue, 7) : occurrenceDateValue;
    if (data.priceOverride !== undefined && data.priceOverride !== null) {
      const occurrence = await resolveSession(tx, `${recurrenceId}@${weekMonday(first)}`);
      await tx.teachingSession.update({ where: { id: occurrence.id }, data: { status: "PLANIFIEE", priceOverride: money(data.priceOverride), isException: true } });
    }
    const events = await readAgendaEvents(tx, first, first);
    const event = events.find(value => value.recurrenceId === recurrenceId);
    if (!event) throw new BusinessError("La période choisie ne contient aucune occurrence de ce jour.");
    return event;
  });
}

export async function updateAgendaSession(id: string, input: unknown, actor: Actor): Promise<AgendaEvent> {
  const data = sessionEditSchema.parse(input);
  return agendaWrite(async tx => {
    const previous = await resolveSession(tx, id);
    if (!["PLANIFIEE", "EN_COURS"].includes(previous.status)) throw new BusinessError("Cette séance est clôturée. Une correction historique doit être auditée séparément.", 409);
    if ((previous.recurrenceId ? "FIXE" : "PROVISOIRE") !== data.type) throw new BusinessError("Le type d’une séance existante ne peut pas être modifié.", 409);
    if (previous.occurrenceWeek && weekMonday(data.date) !== dateString(previous.occurrenceWeek)) throw new BusinessError("Déplacez cette occurrence uniquement dans sa semaine d’origine.");
    await assertActive(tx, data.teacherId, data.classroomId);
    let priceOverride = data.priceOverride === undefined ? previous.priceOverride?.toFixed(3) ?? null : data.priceOverride;
    if (previous.teacherId !== data.teacherId && previous.priceOverride !== null) {
      if (!data.overrideDecision) throw new BusinessError("Le professeur a changé. Choisissez de conserver le tarif exceptionnel ou de rétablir le tarif habituel du nouveau professeur.", 409);
      if (data.overrideDecision === "RESTORE") priceOverride = null;
    }
    const times = { startAt: atTunis(data.date, data.startTime), endAt: atTunis(data.date, data.endTime) };
    if (previous.teacherId !== data.teacherId || previous.classroomId !== data.classroomId || previous.startAt.getTime() !== times.startAt.getTime() || previous.endAt.getTime() !== times.endAt.getTime()) {
      assertCentreSlot(await getCentreSettings(tx), { date: data.date, startMinute: minutesOf(data.startTime), endMinute: minutesOf(data.endTime) });
    }
    await assertSlot(tx, { ...data, ...times }, concreteEvent(previous).id);
    const session = await tx.teachingSession.update({ where: { id: previous.id }, data: { teacherId: data.teacherId, classroomId: data.classroomId, ...times, notes: data.notes,
      status: previous.status, isException: !!previous.recurrenceId, priceOverride: priceOverride === null ? null : money(priceOverride) }, include: agendaSessionRelations });
    await audit(tx, actor, "MODIFICATION_OCCURRENCE", "TeachingSession", session.id,
      { teacherId: previous.teacherId, classroomId: previous.classroomId, startAt: previous.startAt.toISOString(), endAt: previous.endAt.toISOString(), notes: previous.notes, priceOverride: previous.priceOverride?.toFixed(3) ?? null }, { ...data, priceOverride });
    return concreteEvent(session);
  });
}

export async function changeAgendaStatus(id: string, input: unknown, actor: Actor): Promise<AgendaEvent> {
  const data = statusChangeSchema.parse(input);
  const { status } = data;
  return agendaWrite(async tx => {
    const previous = await resolveSession(tx, id);
    const completionRequest = { id, priceOverride: data.priceOverride ?? null, inheritExisting: data.priceOverride === undefined };
    if (status === "TERMINEE" && data.idempotencyKey && await recordedCommand(tx, data.idempotencyKey, "FINALISATION_SEANCE", completionRequest)) return concreteEvent(previous);
    if (previous.status === status) {
      if (status === "TERMINEE" && data.priceOverride !== undefined && !money(data.priceOverride ?? previous.rateSnapshot!.toFixed(3)).eq(previous.rateSnapshot!)) throw new BusinessError("Cette séance est déjà terminée avec un autre tarif. Utilisez la correction auditée.", 409);
      return concreteEvent(previous);
    }
    if (!canTransition(previous.status, status)) throw new BusinessError("Ce changement de statut est interdit. L’historique des séances clôturées doit être conservé.", 409);
    const now = new Date();
    const update: Prisma.TeachingSessionUpdateInput = { status, isException: !!previous.recurrenceId };
    if (status === "EN_COURS") { await assertActive(tx, previous.teacherId, previous.classroomId); update.startedAt = now; }
    if (status === "ABSENT") update.absentAt = now;
    if (status === "ANNULEE") update.cancelledAt = now;
    if (status === "TERMINEE") {
      await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${previous.teacherId}::uuid FOR UPDATE`;
      const date = dateValue(tunisDate(previous.startAt).format("YYYY-MM-DD"));
      const rate = await tx.professorRateAgreement.findFirst({ where: { teacherId: previous.teacherId, active: true, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] } });
      const priceOverride = data.priceOverride === undefined ? previous.priceOverride ?? null : data.priceOverride === null ? null : money(data.priceOverride);
      const finalPrice = priceOverride ?? rate?.pricePerSession;
      if (finalPrice === null || finalPrice === undefined) throw new BusinessError("Aucun tarif valide pour ce professeur à la date de la séance. Définissez sa tarification ou saisissez un tarif exceptionnel.", 409);
      if (data.expectedPrice !== undefined && !finalPrice.eq(money(data.expectedPrice))) throw new BusinessError("Le tarif applicable a changé depuis l’ouverture de la séance. Fermez cette fenêtre et actualisez l’agenda avant de confirmer le nouveau montant.", 409, { currentPrice: finalPrice.toFixed(3) });
      update.completedAt = now; update.rateSnapshot = finalPrice; update.priceOverride = priceOverride;
      update.rateOverrideReason = priceOverride !== null ? "Tarif exceptionnel confirmé pour cette séance uniquement." : null;
      if (rate) update.rateAgreement = { connect: { id: rate.id } };
      await tx.teachingSession.update({ where: { id: previous.id }, data: update });
      await tx.sessionCharge.create({ data: { teacherId: previous.teacherId, sessionId: previous.id, rateAgreementId: rate?.id,
        amount: finalPrice, pricingSource: priceOverride !== null ? "EXCEPTIONNEL" : "HABITUEL", chargedAt: now, idempotencyKey: `session-completion:${previous.id}` } });
      if (data.idempotencyKey) await commandAudit(tx, actor, { key: data.idempotencyKey, action: "FINALISATION_SEANCE", entityType: "TeachingSession", entityId: previous.id,
        request: completionRequest, before: { status: previous.status }, after: { amount: finalPrice.toFixed(3), pricingSource: priceOverride !== null ? "EXCEPTIONNEL" : "HABITUEL" }, result: { id: previous.id } });
    } else {
      await tx.teachingSession.update({ where: { id: previous.id }, data: update });
    }
    await audit(tx, actor, "CHANGEMENT_STATUT_SEANCE", "TeachingSession", previous.id, { status: previous.status }, { status, timestamp: now.toISOString() });
    return concreteEvent((await tx.teachingSession.findUnique({ where: { id: previous.id }, include: agendaSessionRelations }))!);
  });
}

const permanentTerminationAction = "FIN_PROGRAMMATION_PAR_ANNULATION";

async function assertRecurrenceNotTerminated(tx: Transaction, recurrenceId: string) {
  if (await tx.auditLog.findFirst({ where: { action: permanentTerminationAction, entityType: "RecurrenceSeries", entityId: recurrenceId }, select: { id: true } })) {
    throw new BusinessError("Cette programmation fixe a été arrêtée définitivement. Créez une nouvelle programmation pour réserver de nouvelles séances.", 409);
  }
}

async function terminateRecurrence(tx: Transaction, recurrenceId: string, effectiveDate: string, actor: Actor, reason: string | null, selectedSessionId?: string) {
  await assertRecurrenceNotTerminated(tx, recurrenceId);
  const cutoff = atTunis(effectiveDate, "00:00");
  if (await tx.teachingSession.findFirst({ where: { recurrenceId, status: "TERMINEE", startAt: { gte: cutoff } }, select: { id: true } })) {
    throw new BusinessError("Cette programmation contient une séance terminée à partir de la date choisie. L’annulation a été refusée afin de conserver son historique et ses montants.", 409);
  }
  const cutoffWeek = weekMonday(effectiveDate);
  const following = await tx.teachingSession.findMany({ where: { recurrenceId, status: { in: ["PLANIFIEE", "EN_COURS"] },
    OR: [{ occurrenceWeek: { gte: dateValue(cutoffWeek) } }, { startAt: { gte: cutoff } }] }, select: { id: true, status: true } });
  const versions = await closeFutureVersions(tx, recurrenceId, effectiveDate);
  if (following.length) await tx.teachingSession.updateMany({ where: { id: { in: following.map(session => session.id) } },
    data: { status: "ANNULEE", cancelledAt: new Date(), isException: true } });
  await tx.auditLog.create({ data: { adminId: actor.id, action: permanentTerminationAction, entityType: "RecurrenceSeries", entityId: recurrenceId,
    reason, before: { versions, occurrences: following }, after: { effectiveDate, occurrenceWeek: cutoffWeek, selectedSessionId: selectedSessionId ?? null,
      endDate: addDays(effectiveDate, -1), cancelledSessionIds: [...new Set([...(selectedSessionId ? [selectedSessionId] : []), ...following.map(session => session.id)])] } } });
  return { versions, following };
}

/** Cancels finite persisted occurrences and closes templates without deleting history. */
export async function cancelAgendaSession(id: string, input: unknown, actor: Actor): Promise<AgendaEvent> {
  const data = cancellationSchema.parse(input);
  const request = { id, scope: data.scope, reason: data.reason };
  return agendaWrite(async tx => {
    const replay = await recordedCommand(tx, data.idempotencyKey, "ANNULATION_SEANCE", request);
    if (replay) return concreteEvent(await tx.teachingSession.findUniqueOrThrow({ where: { id: replay.id }, include: agendaSessionRelations }));
    const previous = await resolveSession(tx, id);
    if (previous.status === "TERMINEE") throw new BusinessError("Une séance terminée ne peut pas être annulée. Son historique et ses montants doivent être conservés.", 409);
    if (previous.status === "ABSENT") throw new BusinessError("Une séance déjà marquée absente ne peut pas être annulée. Son historique doit être conservé.", 409);
    if (data.scope === "FOLLOWING" && !previous.recurrenceId) throw new BusinessError("Une séance provisoire peut uniquement être annulée individuellement.", 409);
    const effectiveDate = tunisDate(previous.startAt).format("YYYY-MM-DD");
    const now = new Date();
    const following = data.scope === "FOLLOWING"
      ? (await terminateRecurrence(tx, previous.recurrenceId!, effectiveDate, actor, data.reason, previous.id)).following : [];
    if (previous.status !== "ANNULEE") await tx.teachingSession.update({ where: { id: previous.id },
      data: { status: "ANNULEE", cancelledAt: now, isException: !!previous.recurrenceId } });
    await commandAudit(tx, actor, { key: data.idempotencyKey, action: "ANNULATION_SEANCE", entityType: "TeachingSession", entityId: previous.id,
      reason: data.reason, request, before: { status: previous.status }, after: { scope: data.scope, effectiveDate, status: "ANNULEE", recurrenceId: previous.recurrenceId,
        cancelledSessionIds: [...new Set([previous.id, ...following.map(session => session.id)])] }, result: { id: previous.id } });
    return concreteEvent(await tx.teachingSession.findUniqueOrThrow({ where: { id: previous.id }, include: agendaSessionRelations }));
  });
}

function assertEffectiveDate(effectiveDate: string) {
  if (effectiveDate < tunisDate().format("YYYY-MM-DD")) throw new BusinessError("Choisissez un lundi à venir ; les semaines déjà commencées sont conservées.");
}

async function closeFutureVersions(tx: Transaction, recurrenceId: string, effectiveDate: string) {
  const versions = await tx.recurrenceSchedule.findMany({ where: { recurrenceId, supersededAt: null }, orderBy: { startDate: "asc" } });
  if (!versions.length) missingRecord("Programmation fixe");
  for (const version of versions) {
    if (dateString(version.startDate) >= effectiveDate) {
      await tx.recurrenceSchedule.update({ where: { id: version.id }, data: { supersededAt: new Date() } });
    } else if (!version.endDate || dateString(version.endDate) >= effectiveDate) {
      await tx.recurrenceSchedule.update({ where: { id: version.id }, data: { endDate: dateValue(addDays(effectiveDate, -1)) } });
    }
  }
  return versions.map(version => ({ id: version.id, startDate: dateString(version.startDate), endDate: version.endDate ? dateString(version.endDate) : null }));
}

export async function updateRecurrence(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = recurrenceUpdateSchema.parse(input);
  assertEffectiveDate(data.effectiveDate);
  return agendaWrite(async tx => {
    await assertRecurrenceNotTerminated(tx, id);
    await assertActive(tx, data.teacherId, data.classroomId);
    const proposed: ProposedSchedule = { recurrenceId: id, teacherId: data.teacherId, classroomId: data.classroomId, weekday: data.weekday,
      startMinute: minutesOf(data.startTime), endMinute: minutesOf(data.endTime), startDate: data.effectiveDate, endDate: data.endDate };
    await assertSchedule(tx, proposed);
    const history = await closeFutureVersions(tx, id, data.effectiveDate);
    await tx.recurrenceSchedule.create({ data: { ...proposed, startDate: dateValue(data.effectiveDate), endDate: data.endDate ? dateValue(data.endDate) : null, notes: data.notes } });
    await audit(tx, actor, "MODIFICATION_PROGRAMMATION_FIXE", "RecurrenceSeries", id,
      { versions: history }, { ...data });
    return { id };
  });
}

export async function endRecurrence(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = endRecurrenceSchema.parse(input);
  assertEffectiveDate(data.effectiveDate);
  return agendaWrite(async tx => {
    const { versions } = await terminateRecurrence(tx, id, data.effectiveDate, actor, null);
    await audit(tx, actor, "FIN_PROGRAMMATION_FIXE", "RecurrenceSeries", id,
      { versions }, { endDate: addDays(data.effectiveDate, -1), historiqueConserve: true });
    return { id };
  });
}

async function completedPriceState(tx: Transaction, id: string, input: { amount: string; reason: string }) {
  let session;
  if (id.includes("@")) {
    const [recurrenceId, week, extra] = id.split("@");
    uuidSchema.parse(recurrenceId); dateSchema.parse(week);
    if (extra || weekMonday(week) !== week) throw new BusinessError("L’occurrence sélectionnée est invalide.");
    session = await tx.teachingSession.findUnique({ where: { recurrenceId_occurrenceWeek: { recurrenceId, occurrenceWeek: dateValue(week) } }, include: { charge: true } });
  } else {
    uuidSchema.parse(id);
    session = await tx.teachingSession.findUnique({ where: { id }, include: { charge: true } });
  }
  if (!session || session.status !== "TERMINEE" || !session.charge || session.charge.voidedAt) throw new BusinessError("Cette correction concerne uniquement une séance terminée avec une charge valide.", 409);
  const state = await readFinancialState(tx, session.teacherId);
  assertFinancialIntegrity(state);
  const arrays = financeArrays(state);
  const charges = arrays.charges.map(charge => charge.id === session.charge!.id ? { ...charge, amount: money(input.amount).toFixed(3) } : charge);
  const preview: CorrectionPreview = { ...previewFinancialChange(state, session.teacherId, "PRICE", { id, amount: input.amount, reason: input.reason }, charges, arrays.payments),
    targetId: id, kind: "PRICE" };
  return { session, charge: session.charge, state, preview };
}

export async function previewSessionPrice(id: string, input: unknown) {
  const data = priceCorrectionPreviewSchema.parse(input);
  return db.$transaction(async tx => (await completedPriceState(tx, id, data)).preview, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function correctSessionPrice(id: string, input: unknown, actor: Actor) {
  const data = priceCorrectionSchema.parse(input);
  const request = { id, amount: money(data.amount).toFixed(3), reason: data.reason };
  return financialTransaction(async tx => {
    const replay = await recordedCommand(tx, data.idempotencyKey, "CORRECTION_TARIF_SEANCE", request);
    if (replay) return replay;
    const { session, charge, state, preview } = await completedPriceState(tx, id, data);
    assertPreview(data.previewToken, preview);
    await commandAudit(tx, actor, { key: data.idempotencyKey, action: "CORRECTION_TARIF_SEANCE", entityType: "SessionCharge", entityId: charge.id, reason: data.reason,
      request, before: { amount: charge.amount.toFixed(3), pricingSource: charge.pricingSource, priceOverride: session.priceOverride?.toFixed(3) ?? null, sessionId: session.id, financialSummary: state.summary() },
      after: { amount: money(data.amount).toFixed(3), pricingSource: "EXCEPTIONNEL", sessionId: session.id }, result: { id: session.id } });
    const revision = await reverseAllocations(tx, session.teacherId, actor, `Correction du tarif de séance : ${data.reason}`);
    await auditContext(tx, data.idempotencyKey);
    await tx.teachingSession.update({ where: { id: session.id }, data: { rateSnapshot: money(data.amount), priceOverride: money(data.amount), rateOverrideReason: data.reason } });
    await tx.sessionCharge.update({ where: { id: charge.id }, data: { amount: money(data.amount), pricingSource: "EXCEPTIONNEL" } });
    await allocatePaymentsToCharges(tx, session.teacherId, revision);
    return { id: session.id };
  });
}
