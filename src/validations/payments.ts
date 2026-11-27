import { z } from "@/validations/locale";
import { dateOnlySchema, priceSchema, uuidSchema } from "@/validations/management";
import { tunisDate } from "@/lib/dates";
import { money } from "@/lib/money";

const text = (max: number) => z.string().trim().max(max).nullish().transform(value => value || null);
export const reasonSchema = z.string().trim().min(3, "Saisissez le motif de la correction (au moins 3 caractères).").max(2000, "Le motif est trop long.");
export const paymentFieldsSchema = z.strictObject({
  amount: priceSchema.refine(value => money(value).gt(0), "Le montant du paiement doit être supérieur à zéro."),
  paymentDate: dateOnlySchema.refine(value => value <= tunisDate().format("YYYY-MM-DD"), "Un paiement reçu ne peut pas être daté dans le futur."),
  notes: text(4000),
});
export const paymentInputSchema = paymentFieldsSchema.extend({ teacherId: uuidSchema });
const command = { previewToken: z.string().regex(/^[a-f0-9]{64}$/, "Actualisez l’aperçu avant de confirmer."),
  idempotencyKey: uuidSchema, confirm: z.literal(true, { error: "Confirmez cette opération." }) };
export const paymentCommandSchema = paymentInputSchema.extend(command);
export const paymentCorrectionSchema = paymentFieldsSchema.extend({ ...command, reason: reasonSchema });
export const paymentCancelSchema = z.strictObject({ ...command, reason: reasonSchema });
export const paymentCorrectionPreviewSchema = z.discriminatedUnion("kind", [
  paymentFieldsSchema.extend({ kind: z.literal("PAYMENT"), reason: reasonSchema }),
  z.strictObject({ kind: z.literal("CANCELLATION"), reason: reasonSchema }),
]);
export const priceCorrectionPreviewSchema = z.object({ amount: priceSchema, reason: reasonSchema });
export const priceCorrectionSchema = priceCorrectionPreviewSchema.extend(command);
