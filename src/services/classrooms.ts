import "server-only";
import { db } from "@/server/db";
import { assertClassroomCanDeactivate } from "@/lib/management-rules";
import { activationSchema, classroomFields, createClassroomSchema, intervalSchema, uuidSchema } from "@/validations/management";
import { audit, missingRecord, uniqueClassroom, type Actor } from "@/services/management-shared";
import { sessionRelations, sessionRow } from "@/services/sessions";
import type { ClassroomData, ClassroomDetails } from "@/types/management";
import { blocksTime, readAgendaEvents, upcomingBookings } from "@/services/agenda-read";
import { tunisDate } from "@/lib/dates";
import { BusinessError } from "@/lib/business-error";
import { addDays } from "@/lib/scheduling";

export async function listClassrooms(input?: unknown): Promise<ClassroomData> {
  const now = new Date();
  const interval = intervalSchema.parse(input ?? { startAt: now.toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString() });
  if (new Date(interval.endAt).getTime() - new Date(interval.startAt).getTime() > 369 * 86400000) throw new BusinessError("Consultez un créneau de 369 jours maximum.");
  return db.$transaction(async tx => {
    const rooms = await tx.classroom.findMany({ orderBy: { name: "asc" } });
    const events = await readAgendaEvents(tx, tunisDate(interval.startAt).format("YYYY-MM-DD"), tunisDate(new Date(new Date(interval.endAt).getTime() - 1)).format("YYYY-MM-DD"));
    const blockers: Awaited<ReturnType<typeof upcomingBookings>>[] = [];
    for (const room of rooms) blockers.push(await upcomingBookings(tx, room.id, now));
    return { ...interval, rooms: rooms.map((room, index) => ({
      id: room.id, name: room.name, description: room.description, active: room.active,
      availability: !room.active ? "INACTIVE" : events.some(event => event.classroomId === room.id && blocksTime(event.status)
        && new Date(event.startAt) < new Date(interval.endAt) && new Date(event.endAt) > new Date(interval.startAt)) ? "OCCUPEE" : "DISPONIBLE",
      futurePlannedCount: blockers[index].length, createdAt: room.createdAt.toISOString(), updatedAt: room.updatedAt.toISOString(),
    })) };
  }, { isolationLevel: "RepeatableRead" });
}

export async function classroomDetails(id: string): Promise<ClassroomDetails> {
  uuidSchema.parse(id);
  const data = await listClassrooms();
  const room = data.rooms.find(item => item.id === id);
  if (!room) missingRecord("Salle");
  const sessions = await db.teachingSession.findMany({ where: { classroomId: id }, include: sessionRelations, orderBy: { startAt: "desc" }, take: 100 });
  const totalSessions = await db.teachingSession.count({ where: { classroomId: id } });
  const today = tunisDate().format("YYYY-MM-DD");
  const upcoming = (await readAgendaEvents(db, today, addDays(today, 90))).filter(event => event.classroomId === id && !event.persisted);
  return { ...room, sessions: [...sessions.map(sessionRow), ...upcoming].sort((a, b) => b.startAt.localeCompare(a.startAt)), totalSessions };
}

export async function upcomingClassroomSessions(id: string) {
  uuidSchema.parse(id);
  if (!await db.classroom.findUnique({ where: { id }, select: { id: true } })) missingRecord("Salle");
  return { sessions: await upcomingBookings(db, id) };
}

export async function createClassroom(input: unknown, actor: Actor) {
  const data = createClassroomSchema.parse(input);
  return uniqueClassroom(() => db.$transaction(async tx => {
    const room = await tx.classroom.create({ data });
    await audit(tx, actor, "CREATION_SALLE", "Classroom", room.id, undefined, data);
    return { id: room.id };
  }));
}

export async function updateClassroom(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = classroomFields.parse(input);
  return uniqueClassroom(() => db.$transaction(async tx => {
    const previous = await tx.classroom.findUnique({ where: { id } });
    if (!previous) missingRecord("Salle");
    await tx.classroom.update({ where: { id }, data });
    await audit(tx, actor, "MODIFICATION_SALLE", "Classroom", id,
      { name: previous.name, description: previous.description }, data);
    return { id };
  }));
}

export async function setClassroomActive(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const { active } = activationSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    await tx.$queryRaw`SELECT id FROM "Classroom" WHERE id=${id}::uuid FOR UPDATE`;
    const previous = await tx.classroom.findUnique({ where: { id } });
    if (!previous) missingRecord("Salle");
    if (!active) {
      const sessions = await upcomingBookings(tx, id);
      assertClassroomCanDeactivate(sessions, new Date());
    }
    if (previous.active !== active) {
      await tx.classroom.update({ where: { id }, data: { active } });
      await audit(tx, actor, active ? "ACTIVATION_SALLE" : "DESACTIVATION_SALLE", "Classroom", id, { active: previous.active }, { active });
    }
    return { id, active };
  });
}
