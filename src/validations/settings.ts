import { z } from "@/validations/locale";

const halfHour = (minimum: number, maximum: number) => z.number().int("Choisissez une heure valide.").min(minimum).max(maximum)
  .refine(value => value % 30 === 0, "Choisissez une heure par pas de 30 minutes.");

const openingFields = {
  openingMinute: halfHour(0, 1410),
  closingMinute: halfHour(30, 1440),
  openingDays: z.array(z.number().int().min(1).max(7)).min(1, "Choisissez au moins un jour d’ouverture.").max(7)
    .refine(value => new Set(value).size === value.length, "Les jours d’ouverture ne doivent pas être répétés.")
    .transform(value => [...value].sort((a, b) => a - b)),
};
const validClosing = (value: { openingMinute: number; closingMinute: number }) => value.closingMinute > value.openingMinute;
const closingMessage = { message: "L’heure de fermeture doit être postérieure à l’heure d’ouverture.", path: ["closingMinute"] };
export const openingHoursSchema = z.strictObject(openingFields).refine(validClosing, closingMessage);

export const centreSettingsSchema = z.strictObject({
  name: z.string().trim().min(1, "Saisissez le nom du centre.").max(150, "Limitez le nom à 150 caractères."),
  phone: z.string().trim().min(1, "Saisissez le téléphone du centre.").max(30, "Le téléphone est trop long.")
    .regex(/^\+?[\d\s().-]+$/, "Le numéro de téléphone est invalide.")
    .refine(value => { const count = value.replace(/\D/g, "").length; return count >= 8 && count <= 15; }, "Le téléphone doit contenir de 8 à 15 chiffres."),
  address: z.string().trim().min(1, "Saisissez l’adresse du centre.").max(1000, "Limitez l’adresse à 1000 caractères."),
  email: z.union([z.string().trim().email("L’adresse e-mail est invalide.").max(254), z.literal(""), z.null()])
    .transform(value => value?.toLowerCase() || null),
  ...openingFields,
}).refine(validClosing, closingMessage);
