"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { App, Avatar, Button, Card, Empty, Input, Select, Space, Switch, Table, Tag } from "antd";
import { EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined, UserOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { MoneyText } from "@/components/management-ui";
import { ProfessorForm } from "@/features/professors/professor-form";
import type { ProfessorRow } from "@/types/management";

export function ProfessorsView({ initialData }: { initialData: ProfessorRow[] }) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProfessorRow | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const { modal, message } = App.useApp();
  const router = useRouter();
  const filtered = useMemo(() => data.filter(professor => {
    const text = query.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
    const name = professor.fullName.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const phoneQuery = query.replace(/\D/g, "");
    return (name.includes(text) || (phoneQuery.length > 0 && professor.phone.replace(/\D/g, "").includes(phoneQuery))) && (status === "all" || professor.active === (status === "active"));
  }), [data, query, status]);
  async function refresh() { setData(await apiRequest<ProfessorRow[]>("/api/professors")); }
  function changeStatus(professor: ProfessorRow, active: boolean) {
    modal.confirm({ title: active ? `Réactiver ${professor.fullName} ?` : `Désactiver ${professor.fullName} ?`,
      content: active ? "Ce professeur pourra de nouveau recevoir des séances." : "Aucune nouvelle séance ne pourra lui être attribuée. Ses séances, tarifs et paiements resteront accessibles.",
      okText: active ? "Réactiver" : "Désactiver", cancelText: "Annuler", async onOk() {
        setChanging(professor.id);
        try { await apiRequest(`/api/professors/${professor.id}/status`, { method: "PATCH", body: JSON.stringify({ active, confirmed: true }) }); await refresh(); message.success("Le statut a été modifié."); }
        catch (error) { message.error(error instanceof Error ? error.message : "Le statut n’a pas pu être modifié."); }
        finally { setChanging(null); }
      } });
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">LES PROFESSEURS DU CENTRE</span><h1>Professeurs</h1><p>Coordonnées, tarifs et suivi de leur activité.</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>Ajouter un professeur</Button></div>
    <div className="compact-stats"><Card><span>Professeurs</span><strong>{data.length}</strong></Card><Card><span>Actifs</span><strong>{data.filter(professor => professor.active).length}</strong></Card><Card><span>Avec un tarif en vigueur</span><strong>{data.filter(professor => professor.currentPrice !== null).length}</strong></Card></div>
    <Card className="management-card"><div className="table-toolbar"><Input aria-label="Rechercher un professeur" prefix={<SearchOutlined />} placeholder="Rechercher par nom ou téléphone" value={query} onChange={event => setQuery(event.target.value)} allowClear /><Select aria-label="Filtrer les professeurs" value={status} onChange={setStatus} options={[{ value: "all", label: "Tous les statuts" }, { value: "active", label: "Actifs" }, { value: "inactive", label: "Inactifs" }]} /></div>
      <Table<ProfessorRow> rowKey="id" dataSource={filtered} scroll={{ x: 1750 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data.length ? "Aucun professeur ne correspond à votre recherche" : "Ajoutez votre premier professeur pour démarrer."} /> }} columns={[
        { title: "Professeur", key: "professor", fixed: "left", width: 230, render: (_, professor) => <Link className="professor-cell" href={`/professeurs/${professor.id}`}><Avatar icon={<UserOutlined />} /><span><strong>{professor.fullName}</strong><small>{professor.phone}</small></span></Link> },
        { title: "Statut", render: (_, professor) => <Space><Switch size="small" aria-label={`Statut de ${professor.fullName}`} checked={professor.active} loading={changing === professor.id} onChange={active => changeStatus(professor, active)} /><Tag color={professor.active ? "green" : "default"}>{professor.active ? "Actif" : "Inactif"}</Tag></Space> },
        { title: "Prix par séance", render: (_, professor) => professor.currentPrice !== null ? formatMoney(professor.currentPrice) : <Link href={`/professeurs/${professor.id}?tab=tarification`}>Non défini</Link> },
        { title: "Séances effectuées", dataIndex: "completedSessions" },
        { title: "Montant dû au centre", render: (_, professor) => <MoneyText value={professor.finance.totalDue} available={professor.finance.hasEntries} /> },
        { title: "Montant encaissé", render: (_, professor) => <MoneyText value={professor.finance.totalReceived} available={professor.finance.hasEntries} /> },
        { title: "Reste à encaisser", render: (_, professor) => <MoneyText value={professor.finance.remaining} available={professor.finance.hasEntries} /> },
        { title: "Dernier paiement", render: (_, professor) => professor.finance.lastPaymentDate ? formatDateOnly(professor.finance.lastPaymentDate) : "—" },
        { title: "Actions", fixed: "right", width: 130, render: (_, professor) => <Space><Link href={`/professeurs/${professor.id}`}><Button icon={<EyeOutlined />} aria-label={`Voir ${professor.fullName}`} /></Link><Button icon={<EditOutlined />} aria-label={`Modifier ${professor.fullName}`} onClick={() => { setEditing(professor); setFormOpen(true); }} /></Space> },
      ]} /><p className="muted table-note">Les montants sont affichés lorsqu’une écriture financière existe. Les professeurs désactivés conservent tout leur historique.</p>
    </Card>
    <ProfessorForm professor={editing} open={formOpen} onClose={() => setFormOpen(false)} onSaved={async id => { await refresh(); if (!editing) router.push(`/professeurs/${id}?tab=tarification`); }} />
  </>;
}
