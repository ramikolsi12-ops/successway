import { z } from "@/validations/locale";

export const identifierSchema = z.string().trim().toLowerCase()
  .min(3, "Saisissez au moins 3 caractères.")
  .max(100, "L'identifiant est trop long.")
  .regex(/^[a-z0-9._@-]+$/, "Utilisez des lettres sans accents, chiffres, points ou tirets.");

export const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, "Saisissez votre mot de passe.").max(256, "Le mot de passe est trop long."),
});

export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().min(1, "Saisissez votre mot de passe actuel.").max(256, "Le mot de passe est trop long."),
  newPassword: z.string().min(12, "Le nouveau mot de passe doit contenir au moins 12 caractères.").max(256, "Le nouveau mot de passe est trop long."),
  confirmPassword: z.string().min(1, "Confirmez votre nouveau mot de passe.").max(256, "La confirmation est trop longue."),
}).superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Les deux nouveaux mots de passe ne correspondent pas." });
  if (value.currentPassword === value.newPassword) context.addIssue({ code: "custom", path: ["newPassword"], message: "Choisissez un mot de passe différent du mot de passe actuel." });
});
