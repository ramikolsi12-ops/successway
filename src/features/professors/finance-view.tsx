"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, DatePicker, Descriptions, Drawer, Empty, Select, Space, Spin, Table, Tag } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import { AllocationsTable, compareMoney, FinancialStatusTag } from "@/features/payments/finance-ui";
import { PaymentForm } from "@/features/payments/payment-form";
import { PaymentHistory } from "@/features/payments/payment-history";
import { PaymentDetail } from "@/features/payments/payment-detail";
import type { FinanceSummary } from "@/types/management";
import type { FinancialCharge, FinancialStatus, ProfessorFinance } from "@/types/payments";
import { ChargePriceHistory } from "@/features/payments/charge-price-history";

export function FinanceCards({ summary }: { summary: FinanceSummary }) {
  return <div className="finance-overview finance-overview-three">{[
    ["Montant dû au centre", summary.totalDue], ["Montant encaissé", summary.totalReceived],
    ["Reste à encaisser", summary.remaining],
  ].map(([label, value]) => <Card key={label}><span className="stat-label">{label}</span><strong className="money-value">{formatMoney(value)}</strong></Card>)}</div>;
}
function duration(charge: FinancialCharge) {
  const minutes = Math.round((new Date(charge.endAt).getTime() - new Date(charge.startAt).getTime()) / 60000);
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, "0")}` : ""}`;
}
export function ProfessorFinanceView({ teacherId, onChanged }: { teacherId: string; onChanged?: () => Promise<void> }) {
  const [data, setData] = useState<ProfessorFinance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState("all");
  const [range, setRange] = useState<[string, string] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<ProfessorFinance>(`/api/payments/professors/${teacherId}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setData(value); setError(null); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Le suivi financier n’a pas pu être chargé."); });
    return () => controller.abort();
  }, [teacherId]);
  async function refresh() {
    setRefreshing(true);
    try { setData(await apiRequest<ProfessorFinance>(`/api/payments/professors/${teacherId}`)); setError(null); await onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Le suivi financier n’a pas pu être actualisé."); }
    finally { setRefreshing(false); }
  }
  const charges = useMemo(() => (data?.charges ?? []).filter(row => (status === "all" || row.status === status) && (source === "all" || row.pricingSource === source) && (!range || row.sessionDate >= range[0] && row.sessionDate <= range[1])), [data, status, source, range]);
  const charge = data?.charges.find(row => row.id === chargeId);
  if (!data) return error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => void refresh()}>Réessayer</Button>} /> : <Spin tip="Chargement du suivi financier…"><div style={{ height: 200 }} /></Spin>;
  return <>
    <div className="table-toolbar"><Button type="primary" icon={<PlusOutlined />} disabled={compareMoney(data.summary.remaining, "0.000") <= 0} onClick={() => setRecording(true)}>Enregistrer un paiement</Button><Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>Actualiser</Button></div>
    {compareMoney(data.summary.remaining, "0.000") <= 0 && <Alert type="info" showIcon title="Ce professeur n'a aucun montant à régler." className="form-alert" />}
    <p className="muted">Situation financière actuelle sur toutes les périodes. Les filtres ci-dessous portent sur les dates des séances ou des paiements et ne modifient pas ce solde.</p>
    {error && <Alert type="error" showIcon title={error} className="form-alert" />}
    {data.integrityIssues.length > 0 && <Alert type="warning" showIcon title="Historique financier à vérifier" description={<ul>{data.integrityIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>} className="form-alert" />}
    <FinanceCards summary={data.summary} />
    <Card className="management-card" title="Situation du professeur"><Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: "rate", label: "Tarif conventionné par séance", children: data.professor.currentPrice === null ? "Non défini" : formatMoney(data.professor.currentPrice) },
      { key: "completed", label: "Séances effectuées", children: data.completedSessions },
      { key: "paid", label: "Séances payées", children: data.summary.paidSessions },
      { key: "partial", label: "Séances partiellement payées", children: data.summary.partiallyPaidSessions },
      { key: "unpaid", label: "Séances non payées", children: data.summary.unpaidSessions },
      { key: "remaining", label: "Séances restant à régler", children: data.sessionsToSettle },
      { key: "last", label: "Dernier paiement", children: data.summary.lastPaymentDate ? formatDateOnly(data.summary.lastPaymentDate) : "Aucun paiement reçu" },
    ]} /></Card>
    <Card className="management-card" title="Historique financier des séances effectuées">
      <div className="table-toolbar"><Select aria-label="Statut financier des séances" value={status} onChange={setStatus} options={[{ value: "all", label: "Toutes les séances effectuées" }, { value: "PAYEE", label: "Payées" }, { value: "PARTIELLE", label: "Partiellement payées" }, { value: "NON_PAYEE", label: "Non payées" }]} /><Select aria-label="Origine du tarif" value={source} onChange={setSource} options={[{ value: "all", label: "Tous les tarifs" }, { value: "HABITUEL", label: "Tarif habituel" }, { value: "EXCEPTIONNEL", label: "Tarif exceptionnel" }]} />
        <DatePicker.RangePicker aria-label="Dates de début et de fin des séances" format="DD/MM/YYYY" value={range ? [tunisDate(`${range[0]}T12:00:00+01:00`), tunisDate(`${range[1]}T12:00:00+01:00`)] : null} onChange={values => setRange(values?.[0] && values[1] ? [values[0].format("YYYY-MM-DD"), values[1].format("YYYY-MM-DD")] : null)} />
      </div>
      <Table<FinancialCharge> rowKey="id" dataSource={charges} scroll={{ x: 1770 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: count => `${count} séance(s)` }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune séance effectuée pour ces filtres" /> }} columns={[
        { title: "Séance du", dataIndex: "sessionDate", defaultSortOrder: "ascend", sorter: (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id), render: (value: string, row) => <Button type="link" onClick={() => setChargeId(row.id)}>{formatDateOnly(value)}</Button> },
        { title: "Horaire", render: (_, row) => `${tunisDate(row.startAt).format("HH:mm")}–${tunisDate(row.endAt).format("HH:mm")}` },
        { title: "Durée", render: (_, row) => duration(row) }, { title: "Salle", dataIndex: "classroomName" },
        { title: "Type", dataIndex: "type", render: (value: string) => value === "FIXE" ? "Fixe" : "Provisoire" },
        { title: "Tarif historique appliqué", dataIndex: "amount", sorter: (a, b) => compareMoney(a.amount, b.amount), render: formatMoney },
        { title: "Tarification", dataIndex: "pricingSource", render: (value: string) => <Tag color={value === "EXCEPTIONNEL" ? "purple" : "default"}>{value === "EXCEPTIONNEL" ? "Tarif exceptionnel" : "Tarif habituel"}</Tag> },
        { title: "Montant payé", dataIndex: "paid", render: formatMoney }, { title: "Reste à payer", dataIndex: "remaining", render: formatMoney },
        { title: "Statut financier", dataIndex: "status", render: (value: FinancialStatus) => <FinancialStatusTag status={value} /> },
        { title: "Entièrement réglée le", dataIndex: "settledDate", render: (value: string | null) => value ? tunisDate(value).format("DD/MM/YYYY") : "—" },
        { title: "Actions", fixed: "right", render: (_, row) => <Button size="small" onClick={() => setChargeId(row.id)}>Paiements associés</Button> },
      ]} />
      <p className="table-note muted">Le tarif et le statut financier proviennent de la charge historique et des affectations valides. La gestion et les corrections de séance restent accessibles dans l’agenda.</p>
    </Card>
    <Card title="Historique des paiements"><PaymentHistory payments={data.payments} professors={[data.professor]} showProfessor={false} onOpen={setPaymentId} /></Card>
    {recording && <PaymentForm professors={[data.professor]} professorId={teacherId} onClose={() => setRecording(false)} onSaved={refresh} />}
    {paymentId && <PaymentDetail key={paymentId} id={paymentId} professors={[data.professor]} onClose={() => setPaymentId(null)} onChanged={refresh} />}
    <Drawer open={Boolean(charge)} size={1040} title="Règlement de la séance" onClose={() => setChargeId(null)}>{charge && <>
      <Descriptions bordered column={{ xs: 1, sm: 2 }} items={[
        { key: "date", label: "Séance", children: `${formatDateOnly(charge.sessionDate)} · ${tunisDate(charge.startAt).format("HH:mm")}–${tunisDate(charge.endAt).format("HH:mm")}` },
        { key: "room", label: "Salle", children: charge.classroomName }, { key: "price", label: "Tarif historique appliqué", children: formatMoney(charge.amount) },
        { key: "source", label: "Tarification", children: charge.pricingSource === "EXCEPTIONNEL" ? "Tarif exceptionnel" : "Tarif habituel" },
        { key: "paid", label: "Montant payé", children: formatMoney(charge.paid) }, { key: "remaining", label: "Reste à payer", children: formatMoney(charge.remaining) },
        { key: "status", label: "Statut financier", children: <FinancialStatusTag status={charge.status} /> },
      ]} />
      <Space style={{ marginTop: 20, marginBottom: 20 }}><Link href={`/emploi-du-temps?date=${encodeURIComponent(charge.sessionDate)}&event=${encodeURIComponent(charge.agendaId)}`}>Ouvrir cette séance dans l’agenda</Link></Space>
      <ChargePriceHistory history={charge.history} />
      <h3>Paiements associés et historique des affectations</h3><AllocationsTable allocations={charge.allocations} onPayment={setPaymentId} />
    </>}</Drawer>
  </>;
}
