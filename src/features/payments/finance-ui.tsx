"use client";

import { Alert, Button, Collapse, Descriptions, Empty, Table, Tag } from "antd";
import { ApiError } from "@/lib/api-client";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import type { AllocationDetail, FinancialStatus, PaymentPreview } from "@/types/payments";

export function normalizedAmount(value: string): string | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const normalized = `${BigInt(whole)}.${fraction.padEnd(3, "0")}`;
  return normalized === "0.000" ? null : normalized;
}
export function moneyUnits(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")); }
export function sumMoney(values: string[]) {
  const total = values.reduce((sum, value) => sum + moneyUnits(value), 0n);
  return `${total / 1000n}.${(total % 1000n).toString().padStart(3, "0")}`;
}
export function compareMoney(a: string, b: string) { const x = moneyUnits(a), y = moneyUnits(b); return x < y ? -1 : x > y ? 1 : 0; }
export function conflictPreview(error: unknown): PaymentPreview | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.details || typeof error.details !== "object" || !("preview" in error.details)) return null;
  const preview = error.details.preview;
  return preview && typeof preview === "object" && "token" in preview ? preview as PaymentPreview : null;
}
export function FinancialStatusTag({ status }: { status: FinancialStatus }) {
  const labels = { PAYEE: "Payée", PARTIELLE: "Partiellement payée", NON_PAYEE: "Non payée", NON_APPLICABLE: "Non applicable" };
  return <Tag color={status === "PAYEE" ? "green" : status === "PARTIELLE" ? "orange" : status === "NON_PAYEE" ? "red" : "default"}>{labels[status]}</Tag>;
}
export function AllocationPreview({ preview }: { preview: PaymentPreview }) {
  const correction = "kind" in preview;
  return <>
    <Alert showIcon type="info" title={correction ? `${preview.after.paidSessions} séance(s) entièrement réglée(s) après l’opération, contre ${preview.before.paidSessions} avant` : `${preview.additionalPaidSessions} séance(s) supplémentaire(s) entièrement réglée(s)`} description={`${preview.after.paidSessions} payée(s), ${preview.after.partiallyPaidSessions} partiellement payée(s), ${preview.after.unpaidSessions} non payée(s) après cette opération. Répartition automatique sur les séances les plus anciennes.${correction ? " Les variations négatives correspondent aux affectations retirées." : ""}`} />
    <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} style={{ marginTop: 16, marginBottom: 16 }} items={[
      { key: "remaining", label: "Reste à encaisser après", children: formatMoney(preview.after.remaining) },
      { key: "sessions", label: "Séances restant à régler", children: preview.sessionsToSettle },
      { key: "received", label: "Montant encaissé après", children: formatMoney(preview.after.totalReceived) },
    ]} />
    <Collapse items={[{ key: "allocations", label: "Voir la répartition par séance", children: <Table rowKey="chargeId" size="small" dataSource={preview.allocations} scroll={{ x: 780 }} pagination={{ defaultPageSize: 5 }} locale={{ emptyText: "Aucune affectation modifiée par cette opération." }} columns={[
      { title: "Séance", dataIndex: "sessionDate", render: (date: string, row) => `${formatDateOnly(date)} · ${tunisDate(row.startAt).format("HH:mm")}` },
      { title: "Tarif appliqué", dataIndex: "amount", render: formatMoney },
      { title: "Déjà payé", dataIndex: "previouslyPaid", render: formatMoney },
      { title: correction ? "Variation affectée" : "Affecté par ce paiement", dataIndex: "allocated", render: formatMoney },
      { title: "Reste après", dataIndex: "remaining", render: formatMoney },
      { title: "Statut après", dataIndex: "status", render: (status: FinancialStatus) => <FinancialStatusTag status={status} /> },
    ]} /> }]} />
  </>;
}
export function AllocationsTable({ allocations, onPayment }: { allocations: AllocationDetail[]; onPayment?: (id: string) => void }) {
  return <Table<AllocationDetail> rowKey="id" size="small" dataSource={allocations} scroll={{ x: 850 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune affectation enregistrée" /> }} columns={[
    { title: "Séance", render: (_, row) => `${formatDateOnly(row.sessionDate)} · ${tunisDate(row.sessionStartAt).format("HH:mm")}–${tunisDate(row.sessionEndAt).format("HH:mm")}` },
    { title: "Salle", dataIndex: "classroomName" },
    { title: "Tarif appliqué", dataIndex: "sessionPrice", render: formatMoney },
    { title: "Paiement du", dataIndex: "paymentDate", render: (value: string, row) => onPayment ? <Button type="link" size="small" onClick={() => onPayment(row.paymentId)}>{formatDateOnly(value)}</Button> : formatDateOnly(value) },
    { title: "Montant affecté", dataIndex: "amount", render: formatMoney },
    { title: "Affectation", render: (_, row) => <><Tag color={row.valid ? "green" : "default"}>{row.valid ? "Valide" : "Extournée"}</Tag>{!row.valid && row.voidReason && <div className="muted">{row.voidReason}</div>}</> },
    { title: "Enregistrée le", dataIndex: "createdAt", render: (value: string) => tunisDate(value).format("DD/MM/YYYY HH:mm") },
  ]} />;
}
