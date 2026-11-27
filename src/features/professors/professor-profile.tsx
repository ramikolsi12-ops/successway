"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, App, Avatar, Button, Card, Descriptions, Empty, Switch, Table, Tabs, Tag } from "antd";
import { EditOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import { SessionTable } from "@/components/management-ui";
import { ProfessorForm } from "@/features/professors/professor-form";
import { RateForm } from "@/features/professors/rate-form";
import { FinanceCards, ProfessorFinanceView } from "@/features/professors/finance-view";
import type { MonthlyActivity, ProfessorDetails, RateAgreementRow } from "@/types/management";

export function ProfessorProfile({ initialData, initialTab }: { initialData: ProfessorDetails; initialTab: string }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const { modal, message } = App.useApp();
  async function refresh() { setData(await apiRequest<ProfessorDetails>(`/api/professors/${data.id}`)); }
  function setActive(active: boolean) {
    modal.confirm({ title: active ? "Réactiver ce professeur ?" : "Désactiver ce professeur ?", content: active ? "Il pourra recevoir de nouvelles séances." : "Il ne pourra plus recevoir de nouvelles séances. Son historique sera conservé.", okText: active ? "Réactiver" : "Désactiver", cancelText: "Annuler", async onOk() {
      setChanging(true);
      try { await apiRequest(`/api/professors/${data.id}/status`, { method: "PATCH", body: JSON.stringify({ active, confirmed: true }) }); await refresh(); message.success("Le statut a été modifié."); }
      catch (error) { message.error(error instanceof Error ? error.message : "L’opération a échoué."); }
      finally { setChanging(false); }
    } });
  }
  const info = <Card title="Informations générales" extra={<Button icon={<EditOutlined />} onClick={() => setEditing(true)}>Modifier</Button>}>
    <Descriptions column={{ xs: 1, sm: 2 }} items={[
      { key: "firstName", label: "Prénom", children: data.firstName }, { key: "lastName", label: "Nom", children: data.lastName },
      { key: "phone", label: "Téléphone", children: data.phone }, { key: "email", label: "E-mail", children: data.email || "Non renseigné" },
      { key: "address", label: "Adresse", children: data.address || "Non renseignée", span: 2 },
      { key: "notes", label: "Notes", children: <span className="preserve-lines">{data.notes || "Aucune note"}</span>, span: 2 },
      { key: "created", label: "Ajouté le", children: tunisDate(data.createdAt).format("DD/MM/YYYY") },
      { key: "active", label: "Professeur actif", children: <Switch checked={data.active} loading={changing} onChange={setActive} aria-label="Statut du professeur" /> },
    ]} />
  </Card>;
  const pricing = <Card title="Historique de tarification" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setRateOpen(true)}>Ajouter un tarif</Button>}>
    <Alert type="info" showIcon title="Prix payé au centre par séance effectuée" description="Les périodes ne peuvent pas se chevaucher. Une modification de tarif ne modifie pas les montants des séances déjà terminées." className="form-alert" />
    <Table<RateAgreementRow> rowKey="id" dataSource={data.agreements} scroll={{ x: 650 }} pagination={{ defaultPageSize: 10 }} locale={{ emptyText: <Empty description="Aucun tarif défini pour ce professeur" /> }} columns={[
      { title: "Prix par séance", dataIndex: "pricePerSession", render: (value: string) => formatMoney(value) },
      { title: "À partir du", dataIndex: "startDate", render: (value: string) => formatDateOnly(value) },
      { title: "Jusqu’au", dataIndex: "endDate", render: (value: string | null) => value ? formatDateOnly(value) : "Sans date de fin" },
      { title: "Statut", render: (_, agreement) => {
        const today = tunisDate().format("YYYY-MM-DD");
        return <Tag color={!agreement.active ? "default" : agreement.startDate > today ? "blue" : !agreement.endDate || agreement.endDate >= today ? "green" : "default"}>{!agreement.active ? "Archivé" : agreement.startDate > today ? "À venir" : !agreement.endDate || agreement.endDate >= today ? "En vigueur" : "Ancien"}</Tag>;
      } }, { title: "Notes", dataIndex: "notes", render: (value: string | null) => value || "—" },
    ]} />
  </Card>;
  const sessionContent = <Card title="Séances du professeur"><div className="inline-summary"><Tag color="blue">{data.sessions.filter(session => session.status === "PLANIFIEE").length} prévue(s) dans la liste</Tag><Tag color="green">{data.completedSessions} effectuée(s) au total</Tag><Tag color="red">{data.sessions.filter(session => session.status === "ABSENT").length} absence(s) dans la liste</Tag><span>{data.totalSessions} occurrence(s) enregistrée(s).</span></div><p className="muted">Les 100 dernières occurrences enregistrées et les séances fixes des 90 prochains jours sont consultables ici. <Link href="/emploi-du-temps">Gérer les séances dans l’agenda</Link>.</p><SessionTable sessions={data.sessions} /></Card>;
  const payments = <ProfessorFinanceView teacherId={data.id} onChanged={refresh} />;
  const statistics = <><FinanceCards summary={data.finance} /><Card title="Activité par mois"><Table<MonthlyActivity> rowKey="month" dataSource={data.monthlyActivity} pagination={{ defaultPageSize: 12 }} locale={{ emptyText: <Empty description="Aucune activité enregistrée" /> }} columns={[
    { title: "Mois", dataIndex: "month", render: (value: string) => tunisDate(`${value}-01T00:00:00Z`).format("MMMM YYYY") },
    { title: "Séances effectuées", dataIndex: "completedSessions" },
    { title: "Montant dû au centre", dataIndex: "due", render: (value: string | null) => value ? formatMoney(value) : "—" },
    { title: "Paiements reçus", dataIndex: "received", render: (value: string | null) => value ? formatMoney(value) : "—" },
  ]} /></Card></>;
  return <>
    <Link className="back-link" href="/professeurs">Tous les professeurs</Link>
    <div className="page-heading"><div className="profile-heading"><Avatar size={64} icon={<UserOutlined />} /><div><span className="eyebrow">FICHE PROFESSEUR</span><h1>{data.fullName}</h1><p>{data.phone}{data.email ? ` · ${data.email}` : ""}</p></div></div><Tag color={data.active ? "green" : "default"}>{data.active ? "Actif" : "Inactif"}</Tag></div>
    <div className="compact-stats"><Card><span>Prix par séance en vigueur</span><strong className="price-stat">{data.currentPrice !== null ? formatMoney(data.currentPrice) : "Non défini"}</strong><Button type="link" onClick={() => setTab("tarification")}>Gérer la tarification</Button></Card><Card><span>Séances effectuées</span><strong>{data.completedSessions}</strong></Card><Card><span>Dernier paiement</span><strong className="date-stat">{data.finance.lastPaymentDate ? formatDateOnly(data.finance.lastPaymentDate) : "Aucun"}</strong></Card></div>
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: "informations", label: "Informations générales", children: info }, { key: "tarification", label: "Tarification", children: pricing }, { key: "seances", label: "Séances", children: sessionContent }, { key: "paiements", label: "Paiements", children: payments }, { key: "statistiques", label: "Statistiques", children: statistics }]} />
    <ProfessorForm professor={data} open={editing} onClose={() => setEditing(false)} onSaved={async () => refresh()} />
    <RateForm professorId={data.id} open={rateOpen} onClose={() => setRateOpen(false)} onSaved={refresh} hasPrevious={data.agreements.some(agreement => agreement.active)} />
  </>;
}
