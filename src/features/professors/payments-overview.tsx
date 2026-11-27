"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Select, Space, Table, Tabs, Tag } from "antd";
import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { compareMoney } from "@/features/payments/finance-ui";
import { PaymentForm } from "@/features/payments/payment-form";
import { PaymentHistory } from "@/features/payments/payment-history";
import { PaymentDetail } from "@/features/payments/payment-detail";
import { ProfessorFinanceView } from "@/features/professors/finance-view";
import type { ProfessorRow } from "@/types/management";
import type { PaymentOverview } from "@/types/payments";

export function PaymentsOverview({ initialData }: { initialData: PaymentOverview }) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState("all");
  const [financial, setFinancial] = useState("all");
  const [tab, setTab] = useState("balances");
  const [historyProfessor, setHistoryProfessor] = useState<string>();
  const [historyVersion, setHistoryVersion] = useState(0);
  const [recording, setRecording] = useState<{ professorId?: string } | null>(null);
  const [professorId, setProfessorId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setLoading(true);
    try { setData(await apiRequest<PaymentOverview>("/api/payments")); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Les soldes n’ont pas pu être actualisés."); }
    finally { setLoading(false); }
  }
  const professors = useMemo(() => data.professors.filter(row => {
    const textMatches = `${row.fullName} ${row.phone}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"));
    const activeMatches = activity === "all" || (activity === "active" ? row.active : !row.active);
    const financeMatches = financial === "all" || financial === "current" && row.finance.remaining === "0.000" || financial === "debt" && compareMoney(row.finance.remaining, "0.000") > 0 || financial === "partial" && row.finance.partiallyPaidSessions > 0;
    return textMatches && activeMatches && financeMatches;
  }), [data, query, activity, financial]);
  const balances = <Card>
    <div className="table-toolbar"><Input value={query} onChange={event => setQuery(event.target.value)} prefix={<SearchOutlined />} placeholder="Rechercher par nom ou téléphone" aria-label="Rechercher un professeur" allowClear />
      <Select value={activity} onChange={setActivity} aria-label="Statut du professeur" options={[{ value: "all", label: "Actifs et inactifs" }, { value: "active", label: "Actifs" }, { value: "inactive", label: "Inactifs" }]} />
      <Select value={financial} onChange={setFinancial} aria-label="Situation financière du professeur" options={[{ value: "all", label: "Toutes les situations" }, { value: "current", label: "À jour" }, { value: "debt", label: "Solde impayé" }, { value: "partial", label: "Paiement partiel" }]} />
    </div>
    <Table<ProfessorRow> rowKey="id" dataSource={professors} loading={loading} scroll={{ x: 1230 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: count => `${count} professeur(s)` }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun professeur pour ces filtres" /> }} expandable={{ expandedRowRender: row => <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: "paid", label: "Séances payées", children: row.finance.paidSessions },
      { key: "partial", label: "Séances partiellement payées", children: row.finance.partiallyPaidSessions },
      { key: "unpaid", label: "Séances non payées", children: row.finance.unpaidSessions },
      { key: "outstanding", label: "Séances restant à régler", children: row.finance.partiallyPaidSessions + row.finance.unpaidSessions },
      { key: "due", label: "Montant dû au centre", children: formatMoney(row.finance.totalDue) },
      { key: "received", label: "Montant encaissé", children: formatMoney(row.finance.totalReceived) },
    ]} /> }} columns={[
      { title: "Professeur", dataIndex: "fullName", sorter: (a, b) => a.fullName.localeCompare(b.fullName, "fr"), render: (value: string, row) => <div><Link href={`/professeurs/${row.id}?tab=paiements`}>{value}</Link><div><Tag color={row.active ? "green" : "default"}>{row.active ? "Actif" : "Inactif"}</Tag></div></div> },
      { title: "Téléphone", dataIndex: "phone" },
      { title: "Tarif conventionné", dataIndex: "currentPrice", render: (value: string | null) => value === null ? "Non défini" : formatMoney(value) },
      { title: "Séances effectuées", dataIndex: "completedSessions", sorter: (a, b) => a.completedSessions - b.completedSessions },
      { title: "Reste à encaisser", defaultSortOrder: "descend", sorter: (a, b) => compareMoney(a.finance.remaining, b.finance.remaining), render: (_, row) => <strong>{formatMoney(row.finance.remaining)}</strong> },
      { title: "Dernier paiement", sorter: (a, b) => (a.finance.lastPaymentDate ?? "").localeCompare(b.finance.lastPaymentDate ?? ""), render: (_, row) => row.finance.lastPaymentDate ? formatDateOnly(row.finance.lastPaymentDate) : "Aucun" },
      { title: "Actions", fixed: "right", width: 235, render: (_, row) => <Space orientation="vertical" align="start" size={0}><Button type="link" size="small" disabled={compareMoney(row.finance.remaining, "0.000") <= 0} title={compareMoney(row.finance.remaining, "0.000") <= 0 ? "Ce professeur n'a aucun montant à régler." : undefined} onClick={() => setRecording({ professorId: row.id })}>Enregistrer un paiement</Button><Button type="link" size="small" onClick={() => setProfessorId(row.id)}>Détails financiers</Button><Button type="link" size="small" onClick={() => { setHistoryProfessor(row.id); setHistoryVersion(value => value + 1); setTab("history"); }}>Voir l’historique</Button></Space> },
    ]} />
    <p className="table-note muted">Dépliez une ligne pour consulter les séances payées, partiellement payées, non payées et les montants cumulés. Les professeurs inactifs peuvent régler leur solde.</p>
  </Card>;
  return <>
    <div className="page-heading"><div><span className="eyebrow">ENCAISSEMENTS DU CENTRE</span><h1>Paiements</h1><p>Les professeurs règlent au centre l’utilisation de ses salles.</p></div><Space wrap><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>Actualiser</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setRecording({})}>Enregistrer un paiement</Button></Space></div>
    {error && <Alert type="error" showIcon title={error} className="form-alert" />}
    {data.integrityIssues.length > 0 && <Alert type="warning" showIcon title="Historique financier à vérifier" description={<ul>{data.integrityIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>} className="form-alert" />}
    <p className="muted">Situation actuelle sur toutes les périodes, pour tous les professeurs. Les soldes impayés sont calculés séparément pour chaque professeur.</p>
    <div className="finance-overview finance-overview-three">{[["Montant dû au centre", data.totals.totalDue], ["Montant encaissé", data.totals.totalReceived], ["Reste à encaisser", data.totals.remaining]].map(([label, value]) => <Card key={label}><span className="stat-label">{label}</span><strong className="money-value">{formatMoney(value)}</strong></Card>)}</div>
    <div className="finance-overview">{[["Séances non payées", data.totals.unpaidSessions], ["Séances partiellement payées", data.totals.partiallyPaidSessions], ["Séances restant à régler", data.totals.sessionsToSettle], ["Professeurs ayant un solde impayé", data.totals.professorsWithDebt]].map(([label, value]) => <Card key={String(label)}><span className="stat-label">{label}</span><strong>{value}</strong></Card>)}</div>
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: "balances", label: "Soldes des professeurs", children: balances }, { key: "history", label: "Historique des paiements", children: <Card><PaymentHistory key={`${historyProfessor ?? "all"}-${historyVersion}`} initialProfessorId={historyProfessor} payments={data.payments} professors={data.professors} onOpen={setPaymentId} /></Card> }]} />
    {recording && <PaymentForm professors={data.professors} professorId={recording.professorId} onClose={() => setRecording(null)} onSaved={refresh} />}
    {paymentId && <PaymentDetail key={paymentId} id={paymentId} professors={data.professors} onClose={() => setPaymentId(null)} onChanged={refresh} />}
    <Drawer open={Boolean(professorId)} title="Détails financiers du professeur" size={1280} onClose={() => setProfessorId(null)}>{professorId && <ProfessorFinanceView key={professorId} teacherId={professorId} onChanged={refresh} />}</Drawer>
  </>;
}
