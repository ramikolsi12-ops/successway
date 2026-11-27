"use client";

import { Alert, Button, Form, Input, Switch } from "antd";
import { formatMoney } from "@/lib/format";

/** Keep monetary input as text: neither parsing nor rounding uses floating point. */
export function normalizeSessionPrice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(",", ".");
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(cleaned)) return null;
  const [integer, fraction = ""] = cleaned.split(".");
  return `${integer.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(3, "0")}`;
}

export function SessionPricingFields({ defaultRate, fixed = false, initialOccurrence = false, disabled = false }: {
  defaultRate: string | null; fixed?: boolean; initialOccurrence?: boolean; disabled?: boolean;
}) {
  const form = Form.useFormInstance();
  const exceptional = Form.useWatch("exceptional", form) ?? false;
  const amount = Form.useWatch("priceOverride", form);
  const applied = exceptional ? normalizeSessionPrice(amount) : defaultRate;
  return <section className="agenda-pricing" aria-label="Tarification de la séance">
    <h3>Tarification</h3>
    <p>Tarif habituel du professeur : <strong>{defaultRate !== null ? formatMoney(defaultRate) : "Aucun tarif pour cette date"}</strong></p>
    <Form.Item name="exceptional" valuePropName="checked" label="Appliquer un tarif exceptionnel à cette séance">
      <Switch disabled={disabled} checkedChildren="Oui" unCheckedChildren="Non" onChange={checked => {
        if (form.getFieldValue("overrideDecision")) form.setFieldValue("overrideDecision", checked ? "KEEP" : "RESTORE");
      }} />
    </Form.Item>
    {exceptional && <Form.Item name="priceOverride" label="Tarif exceptionnel (DT)" rules={[
      { validator: (_, value) => normalizeSessionPrice(value) !== null ? Promise.resolve() : Promise.reject(new Error("Saisissez un montant positif ou nul, avec au maximum trois décimales.")) },
    ]}>
      <Input inputMode="decimal" placeholder="Ex. : 20,000" suffix="DT" disabled={disabled} autoComplete="off" />
    </Form.Item>}
    {exceptional && <Button type="link" disabled={disabled} className="agenda-restore-rate" onClick={() => form.setFieldsValue({ exceptional: false, priceOverride: undefined, overrideDecision: "RESTORE" })}>Rétablir le tarif habituel</Button>}
    {fixed && <p className="agenda-form-hint">{initialOccurrence ? "Un tarif exceptionnel saisi ici concerne uniquement la première séance de la programmation. Les séances suivantes conserveront le tarif habituel du professeur." : "Ce tarif exceptionnel concerne uniquement cette séance. Les autres séances fixes conserveront le tarif habituel du professeur."}</p>}
    <p className="agenda-applied-price">Tarif appliqué : <strong>{applied !== null ? formatMoney(applied) : exceptional ? "Saisissez un montant valide" : "Aucun tarif disponible"}</strong></p>
    {!exceptional && defaultRate === null && <Alert type="warning" showIcon title="Aucun tarif habituel pour cette date" description="Définissez le tarif conventionné du professeur ou appliquez un tarif exceptionnel avant de terminer la séance." />}
    <p className="agenda-form-hint">Le tarif est fixé par séance, quelle que soit sa durée.</p>
  </section>;
}
