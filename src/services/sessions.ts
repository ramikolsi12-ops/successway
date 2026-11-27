import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { intervalSchema, sessionFiltersSchema } from "@/validations/management";
import type { SessionPage, SessionRow } from "@/types/management";
import { readAgendaEvents } from "@/services/agenda-read";
import { tunisDate } from "@/lib/dates";
import { BusinessError } from "@/lib/business-error";

export const sessionRelations = {
  teacher: { select: { firstName: true, lastName: true } },
  classroom: { select: { name: true } },
} satisfies Prisma.TeachingSessionInclude;

type SessionEntity = Prisma.TeachingSessionGetPayload<{ include: typeof sessionRelations }>;

export function sessionRow(session: SessionEntity): SessionRow {
  return {
    id: session.id, teacherId: session.teacherId, teacherName: `${session.teacher.firstName} ${session.teacher.lastName}`,
    classroomId: session.classroomId, classroomName: session.classroom.name,
    startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), status: session.status,
    notes: session.notes, rateSnapshot: session.rateSnapshot?.toFixed(3) ?? null,
  };
}

export async function getSessions(input: unknown): Promise<SessionPage> {
  const filters = sessionFiltersSchema.parse(input);
  intervalSchema.parse(filters);
  if (new Date(filters.endAt).getTime() - new Date(filters.startAt).getTime() > 369 * 86400000) throw new BusinessError("Consultez une période de 369 jours maximum.");
  const events = await db.$transaction(tx => readAgendaEvents(tx, tunisDate(filters.startAt).format("YYYY-MM-DD"), tunisDate(new Date(new Date(filters.endAt).getTime() - 1)).format("YYYY-MM-DD")), { isolationLevel: "RepeatableRead" });
  const matching = events.filter(event => new Date(event.startAt) < new Date(filters.endAt) && new Date(event.endAt) > new Date(filters.startAt)
    && (!filters.teacherId || event.teacherId === filters.teacherId) && (!filters.classroomId || event.classroomId === filters.classroomId)
    && (!filters.status || event.status === filters.status));
  return { sessions: matching.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize), total: matching.length, filters };
}

export async function getSessionChoices() {
  return {
    professors: await db.teacher.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    classrooms: await db.classroom.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  };
}
