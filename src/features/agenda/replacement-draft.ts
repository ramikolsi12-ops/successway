import { tunisDate } from "@/lib/dates";
import type { AgendaEvent } from "@/types/agenda";
import type { SessionDraft } from "./session-form";

export type CancellationScope = "OCCURRENCE" | "FOLLOWING";

/** A replacement has its own professor, pricing and reservation identity. */
export function replacementDraft(event: Pick<AgendaEvent, "classroomId" | "startAt" | "endAt">, scope: CancellationScope): SessionDraft {
  const start = tunisDate(event.startAt);
  const end = tunisDate(event.endAt);
  return {
    date: start.format("YYYY-MM-DD"),
    classroomId: event.classroomId,
    startMinute: start.hour() * 60 + start.minute(),
    endMinute: end.format("YYYY-MM-DD") === start.format("YYYY-MM-DD") ? end.hour() * 60 + end.minute() : 1440,
    type: scope === "FOLLOWING" ? "FIXE" : "PROVISOIRE",
  };
}
