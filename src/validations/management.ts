import { z } from "@/validations/locale";

export const uuidSchema = z.uuid("L’identifiant est invalide.");
const optionalText = (maximum: number) => z.string().trim().max(maximum, `Limitez ce texte à ${maximum} caractères.`)
  .nullish().transform(value => value || null);

export const classroomFields = z.object({
  name: z.string().trim().min(1, "Saisissez le nom de la salle.").max(100, "Le nom ne peut pas dépasser 100 caractères."),
  description: optionalText(2000),
});
export const createClassroomSchema = classroomFields.extend({ active: z.boolean().default(true) });

export const professorFields = z.object({
  firstName: z.string().trim().min(1, "Saisissez le prénom.").max(100, "Le prénom est trop long."),
  lastName: z.string().trim().min(1, "Saisissez le nom.").max(100, "Le nom est trop long."),
  phone: z.string().trim().min(1, "Saisissez le téléphone.").max(30, "Le téléphone est trop long.")
    .regex(/^\+?[\d\s().-]+$/, "Le numéro de téléphone est invalide.")
    .refine(value => { const count = value.replace(/\D/g, "").length; return count >= 8 && count <= 15; }, "Le téléphone doit contenir de 8 à 15 chiffres."),
  email: z.union([z.string().trim().email("L’adresse e-mail est invalide.").max(254, "L’adresse e-mail est trop longue."), z.literal(""), z.null()])
    .optional().transform(value => value?.toLowerCase() || null),
  address: optionalText(1000),
  notes: optionalText(4000),
});
export const createProfessorSchema = professorFields.extend({ active: z.boolean().default(true) });

export const activationSchema = z.object({
  active: z.boolean(),
  confirmed: z.boolean().default(false),
}).refine(value => value.active || value.confirmed, "Confirmez la désactivation avant de continuer.");

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La date doit être au format AAAA-MM-JJ.")
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La date est invalide.");

export const priceSchema = z.string().trim()
  .regex(/^\d{1,11}(?:[.,]\d{1,3})?$/, "Saisissez un prix positif ou nul, avec au maximum trois décimales.")
  .transform(value => value.replace(",", "."));

export const rateAgreementSchema = z.object({
  pricePerSession: priceSchema,
  startDate: dateOnlySchema,
  endDate: z.union([dateOnlySchema, z.literal(""), z.null()]).optional().transform(value => value || null),
  notes: optionalText(2000),
  closePrevious: z.boolean().default(false),
}).refine(value => !value.endDate || value.endDate >= value.startDate, {
  message: "La fin de validité doit être postérieure ou égale au début.", path: ["endDate"],
});

export const intervalSchema = z.object({
  startAt: z.iso.datetime({ offset: true, error: "Le début du créneau est invalide." }),
  endAt: z.iso.datetime({ offset: true, error: "La fin du créneau est invalide." }),
}).refine(value => new Date(value.endAt) > new Date(value.startAt), {
  message: "La fin du créneau doit être postérieure au début.", path: ["endAt"],
});

export const sessionFiltersSchema = intervalSchema.safeExtend({
  teacherId: uuidSchema.optional(),
  classroomId: uuidSchema.optional(),
  status: z.enum(["PLANIFIEE", "EN_COURS", "TERMINEE", "ABSENT", "ANNULEE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type ClassroomInput = z.infer<typeof classroomFields>;
export type ProfessorInput = z.infer<typeof professorFields>;
export type RateAgreementInput = z.infer<typeof rateAgreementSchema>;
