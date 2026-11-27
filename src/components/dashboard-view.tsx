"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, DatePicker, Empty, Space, Spin, Table, Tag } from "antd";
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, LeftOutlined, RightOutlined, StopOutlined } from "@ant-design/icons";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import type { DashboardData } from "@/services/dashboard";
import { StatusTag } from "@/components/management-ui";
import { PaymentForm } from "@/features/payments/payment-form";
import { compareMoney } from "@/features/payments/finance-ui";
import type { ProfessorRow, SessionStatus } from "@/types/management";

export function DashboardView({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [professor, setProfessor] = useState<ProfessorRow | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedMonth = tunisDate(`${data.month}-01T12:00:00+01:00`);
  const agendaHref = `/emploi-du-temps?date=${encodeURIComponent(data.startDate)}`;
  function navigate(month: string) {
    if (pending || month === data.month) return;
    setProfessor(null);
    startTransition(() => router.replace(`/tableau-de-bord?month=${encodeURIComponent(month)}`, { scroll: false }));
  }
  const stats = [
    { label: "Séances prévues", value: data.statuses.planned, icon: <CalendarOutlined />, color: "blue" },
    { label: "Séances en cours", value: data.statuses.running, icon: <ClockCircleOutlined />, color: "violet" },
    { label: "Séances terminées", value: data.statuses.completed, icon: <CheckCircleOutlined />, color: "teal" },
    { label: "Absences", value: data.statuses.absent, icon: <CloseCircleOutlined />, color: "orange" },
    { label: "Séances annulées", value: data.statuses.cancelled, icon: <StopOutlined />, color: "orange" },
  ];
  return <>
    <div className="page-heading"><div><span className="eyebrow">{data.centreName}</span><h1>Tableau de bord</h1><p>Bonjour, {data.displayName}. Retrouvez l’activité de votre centre pour le mois sélectionné.</p></div><Link href={agendaHref}><Button type="primary" icon={<CalendarOutlined />}>Voir l’emploi du temps</Button></Link></div>
    <div className="dashboard-month-toolbar" aria-label="Mois du tableau de bord">
      <label htmlFor="dashboard-month">Mois sélectionné</label>
      <Space wrap>
        <Button icon={<LeftOutlined />} aria-label="Mois précédent" title="Mois précédent" disabled={pending || data.month === "1900-01"} onClick={() => navigate(selectedMonth.subtract(1, "month").format("YYYY-MM"))} />
        <DatePicker id="dashboard-month" picker="month" value={selectedMonth} format="MMMM YYYY" allowClear={false} disabled={pending} disabledDate={date => date.year() < 1900 || date.year() > 9998} onChange={date => { if (date) navigate(date.format("YYYY-MM")); }} />
        <Button icon={<RightOutlined />} aria-label="Mois suivant" title="Mois suivant" disabled={pending || data.month === "9998-12"} onClick={() => navigate(selectedMonth.add(1, "month").format("YYYY-MM"))} />
        <Button disabled={pending || data.month === data.currentMonth} onClick={() => navigate(data.currentMonth)}>Mois actuel</Button>
      </Space>
      <span className="muted dashboard-month-period" role="status" aria-live="polite">{pending ? "Chargement des données du mois…" : `Du ${formatDateOnly(data.startDate)} au ${formatDateOnly(data.endDate)}`}</span>
    </div>
    <Spin spinning={pending} tip="Actualisation du mois…"><div aria-busy={pending}>
    <div className="section-heading dashboard-month-heading"><h2>{data.monthLabel}</h2><span>{data.sessionsCount} séance(s) sur le mois</span></div>
    {data.sessionsCount === 0 && <Alert className="phase-alert" type="info" showIcon title="Aucune séance pour ce mois" description="Les encaissements reçus pendant cette période restent affichés ci-dessous." />}
    <div className="stat-grid dashboard-activity-grid">{stats.map(stat => <Card key={stat.label} className="stat-card"><span className={`stat-icon ${stat.color}`}>{stat.icon}</span><div className="stat-value">{stat.value}</div><span className="stat-label">{stat.label}</span></Card>)}</div>
    <p className="dashboard-period-summary muted">{data.roomsUsed} salle(s) programmée(s) · {data.scheduledProfessors} professeur(s) programmé(s) sur ce mois.</p>
    {data.integrityIssues.length > 0 && <Alert className="form-alert" type="warning" showIcon title="Historique financier à vérifier" description={<ul>{data.integrityIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>} />}
    <div className="section-heading"><h2>Encaissements et soldes du mois</h2><span>Dinar tunisien · {data.monthLabel}</span></div>
    <div className="compact-stats">
      <Card><span>Montant dû pour les séances du mois</span><strong className="price-stat">{formatMoney(data.finance.totalDue)}</strong><small className="muted">Séances terminées · tarifs historiques</small></Card>
      <Card><span>Encaissements reçus pendant le mois</span><strong className="price-stat">{formatMoney(data.cashReceived)}</strong><small className="muted">Selon la date de réception du paiement</small></Card>
      <Card className="balance-card"><span>Reste à encaisser pour les séances du mois</span><strong className="price-stat">{formatMoney(data.finance.remaining)}</strong><small className="muted">Déjà réglé pour ces séances : {formatMoney(data.finance.totalReceived)}</small></Card>
    </div>
    <div className="inline-summary" aria-label="Règlement des séances du mois">
      <Tag color="green">{data.finance.paidSessions} séance(s) payée(s)</Tag><Tag color="orange">{data.finance.partiallyPaidSessions} partiellement payée(s)</Tag><Tag color="red">{data.finance.unpaidSessions} non payée(s)</Tag>
      <span>{data.finance.sessionsToSettle} séance(s) restant à régler · {data.finance.professorsWithDebt} professeur(s) ayant un solde impayé sur ce mois</span>
    </div>
    <p className="muted dashboard-finance-note">Le montant dû et le reste à encaisser concernent les séances terminées du mois sélectionné. Leurs règlements sont pris en compte même si les paiements ont été reçus après ce mois. Les encaissements suivent la date de réception.</p>
    <Card className="management-card dashboard-month-table" title={<div className="card-heading"><span>Les séances du mois</span><Tag>{data.sessionsCount} séance(s)</Tag></div>} extra={<Link href={agendaHref}>Voir l’emploi du temps</Link>}>
      <Table size="small" rowKey="id" dataSource={data.sessions} loading={pending} pagination={{ defaultPageSize: 10, hideOnSinglePage: true, showSizeChanger: true }} scroll={{ x: 880 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune séance pour ce mois" /> }} columns={[
        { title: "Date", dataIndex: "date", render: formatDateOnly },
        { title: "Horaire", dataIndex: "time", width: 130 },
        { title: "Professeur", dataIndex: "teacher" },
        { title: "Salle", dataIndex: "classroom" },
        { title: "Type", dataIndex: "type", render: (value: string) => <Tag color={value === "FIXE" ? "blue" : "purple"}>{value === "FIXE" ? "Fixe" : "Provisoire"}</Tag> },
        { title: "Statut", dataIndex: "status", render: (status: SessionStatus) => <StatusTag status={status} /> },
        { title: "Actions", render: (_, row) => <Link href={`/emploi-du-temps?date=${encodeURIComponent(row.date)}&event=${encodeURIComponent(row.id)}`}>Ouvrir dans l’agenda</Link> },
      ]} />
    </Card>
    <Card className="management-card dashboard-month-table" title="Soldes impayés des séances du mois" extra={<Link href="/paiements">Voir tous les paiements</Link>}>
      <p className="muted">Les cinq soldes les plus élevés pour les séances du mois sélectionné. Les professeurs inactifs restent inclus.</p>
      <p className="muted dashboard-finance-note">L’enregistrement d’un paiement règle automatiquement les plus anciennes séances impayées du professeur, tous mois confondus. Vérifiez l’aperçu avant de confirmer.</p>
      <Table<DashboardData["debtProfessors"][number]> size="small" rowKey="id" dataSource={data.debtProfessors} loading={pending} pagination={false} scroll={{ x: 930 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun solde impayé pour ce mois" /> }} columns={[
        { title: "Professeur", render: (_, row) => <><Link href={`/professeurs/${row.id}?tab=paiements`}>{row.fullName}</Link>{!row.active && <Tag style={{ marginLeft: 8 }}>Inactif</Tag>}</> },
        { title: "Séances non payées", render: (_, row) => row.monthFinance.unpaidSessions },
        { title: "Partiellement payées", render: (_, row) => row.monthFinance.partiallyPaidSessions },
        { title: "Reste à encaisser", defaultSortOrder: "descend", sorter: (a, b) => compareMoney(a.monthFinance.remaining, b.monthFinance.remaining), render: (_, row) => formatMoney(row.monthFinance.remaining) },
        { title: "Dernier paiement reçu ce mois", render: (_, row) => row.monthFinance.lastPaymentDate ? formatDateOnly(row.monthFinance.lastPaymentDate) : "Aucun" },
        { title: "Actions", render: (_, row) => <Space orientation="vertical" align="start" size={0}><Link href={`/professeurs/${row.id}?tab=paiements`}>Consulter les détails</Link><Button type="link" size="small" disabled={pending} onClick={() => setProfessor(row)}>Enregistrer un paiement</Button></Space> },
      ]} />
    </Card>
    </div></Spin>
    {professor && <PaymentForm key={`${data.month}:${professor.id}`} professors={[professor]} professorId={professor.id} onClose={() => setProfessor(null)} onSaved={async () => { router.refresh(); }} />}
  </>;
}
