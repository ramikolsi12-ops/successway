import { z } from "@/validations/locale";
import { dateOnlySchema, priceSchema, uuidSchema } from "@/validations/management";
import { minutesOf } from "@/lib/scheduling";

export const dateSchema = dateOnlySchema;
const startTime = z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/, "Choisissez une heure de début par pas de 30 minutes.");
const endTime = z.string().regex(/^(?:(?:[01]\d|2[0-3]):(?:00|30)|24:00)$/, "Choisissez une heure de fin par pas de 30 minutes.");
const notes = z.string().trim().max(4000, "Limitez les notes à 4000 caractères.").nullish().transform(value => value || null);
const endDate = dateSchema.nullish().transform(value => value || null);
const weekday = z.number().int().min(1, "Choisissez un jour de la semaine.").max(7, "Choisissez un jour de la semaine.");
const confirmed = z.literal(true, { error: "Confirmez cette opération avant de continuer." });
const mondayDate = dateSchema.refine(value => new Date(`${value}T00:00:00Z`).getUTCDay() === 1, "Choisissez le lundi de la semaine d’effet.");

function validInterval(start: string, end: string) {
  try { return minutesOf(end) > minutesOf(start); } catch { return false; }
}

const sessionFields = z.object({
  teacherId: uuidSchema,
  classroomId: uuidSchema,
  date: dateSchema,
  startTime,
  endTime,
  type: z.enum(["FIXE", "PROVISOIRE"], { error: "Choisissez le type de séance." }),
  notes,
  recurrenceStartDate: dateSchema.optional(),
  recurrenceEndDate: endDate,
  weekday: weekday.optional(),
  priceOverride: priceSchema.nullable().optional(),
  overrideDecision: z.enum(["KEEP", "RESTORE"]).optional(),
});

// An occurrence may move within its week independently of its fixed template.
export const sessionEditSchema = sessionFields.refine(value => validInterval(value.startTime, value.endTime), {
  message: "La fin de la séance doit être postérieure au début.", path: ["endTime"],
});

export const sessionInputSchema = sessionFields.superRefine((value, ctx) => {
  if (!validInterval(value.startTime, value.endTime)) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "La fin de la séance doit être postérieure au début." });
  }
  if (value.type !== "FIXE") return;
  if (!value.weekday) ctx.addIssue({ code: "custom", path: ["weekday"], message: "Choisissez le jour de la programmation fixe." });
  else if (((new Date(`${value.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 !== value.weekday) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "La date de la séance doit correspondre au jour choisi." });
  }
  const start = value.recurrenceStartDate ?? value.date;
  if (value.recurrenceEndDate && value.recurrenceEndDate < start) {
    ctx.addIssue({ code: "custom", path: ["recurrenceEndDate"], message: "La fin de la programmation doit être postérieure ou égale au début." });
  }
  if (value.date < start || (value.recurrenceEndDate && value.date > value.recurrenceEndDate)) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "La séance doit être comprise dans les dates de la programmation fixe." });
  }
}).transform(value => ({ ...value, recurrenceStartDate: value.type === "FIXE" ? value.recurrenceStartDate ?? value.date : value.recurrenceStartDate }));

export const recurrenceUpdateSchema = z.object({
  teacherId: uuidSchema,
  classroomId: uuidSchema,
  weekday,
  startTime,
  endTime,
  effectiveDate: mondayDate,
  endDate,
  notes,
  confirm: confirmed,
}).superRefine((value, ctx) => {
  if (!validInterval(value.startTime, value.endTime)) ctx.addIssue({ code: "custom", path: ["endTime"], message: "La fin de la séance doit être postérieure au début." });
  if (value.endDate && value.endDate < value.effectiveDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fin de la programmation doit être postérieure ou égale à la date d’effet." });
});

export const endRecurrenceSchema = z.object({ effectiveDate: mondayDate, confirm: confirmed });
export const cancellationSchema = z.object({
  scope: z.enum(["OCCURRENCE", "FOLLOWING"], { error: "Choisissez la portée de l’annulation." }),
  reason: z.string().trim().max(4000, "Limitez le motif à 4000 caractères.").nullish().transform(value => value || null),
  confirm: confirmed,
  idempotencyKey: uuidSchema,
});

export const statusChangeSchema = z.object({
  status: z.enum(["EN_COURS", "TERMINEE", "ABSENT", "ANNULEE"], { error: "Le statut demandé est invalide." }),
  confirm: confirmed,
  priceOverride: priceSchema.nullable().optional(),
  idempotencyKey: uuidSchema.optional(),
  expectedPrice: priceSchema.optional(),
});
