"use client";
import { useMemo, useState } from "react";
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Empty, Input, Select, Skeleton, Space, Switch, Table, Tag } from "antd";
import { EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { ApiError, apiRequest } from "@/lib/api-client";
import { tunisDate, tunisInputISO } from "@/lib/dates";
import { BookingList, SessionTable } from "@/components/management-ui";
import { ClassroomForm } from "@/features/classrooms/classroom-form";
import type { ClassroomData, ClassroomDetails, ClassroomRow, SessionRow } from "@/types/management";

export function ClassroomManagement({ initialData }: { initialData: ClassroomData }) {
  const [data, setData] = useState(initialData);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([tunisDate(initialData.startAt), tunisDate(initialData.endAt)]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [loading, setLoading] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClassroomRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [details, setDetails] = useState<ClassroomDetails | null>(null);
  const { modal, message } = App.useApp();

  const filtered = useMemo(() => data.rooms.filter(room => room.name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr"))
    && (status === "all" || room.active === (status === "active")) && (availability === "all" || room.availability === availability)), [data, search, status, availability]);

  async function refresh(startAt = data.startAt, endAt = data.endAt) {
    const query = new URLSearchParams({ startAt, endAt });
    setData(await apiRequest<ClassroomData>(`/api/classrooms?${query}`));
  }
  async function checkAvailability() {
    if (!range || range[1] <= range[0]) { message.error("Choisissez un créneau valide, avec une fin après le début."); return; }
    setLoading(true);
    try { await refresh(tunisInputISO(range[0]), tunisInputISO(range[1])); }
    catch (error) { message.error(error instanceof Error ? error.message : "La disponibilité n’a pas pu être vérifiée."); }
    finally { setLoading(false); }
  }
  function blocked(sessions: SessionRow[]) {
    modal.warning({ title: "Désactivation impossible", width: 650, okText: "Fermer", content: <><p>Dans l’agenda, annulez ou réaffectez ces séances, ou arrêtez la programmation fixe. Pour chaque série, sa prochaine occurrence bloquante est affichée.</p><BookingList sessions={sessions} /></> });
  }
  async function changeStatus(room: ClassroomRow, active: boolean) {
    setChanging(room.id);
    try {
      if (!active) {
        const result = await apiRequest<{ sessions: SessionRow[] }>(`/api/classrooms/${room.id}/upcoming`);
        if (result.sessions.length) { blocked(result.sessions); return; }
      }
      modal.confirm({ title: active ? `Réactiver ${room.name} ?` : `Désactiver ${room.name} ?`,
        content: active ? "La salle pourra recevoir de nouvelles réservations." : "La salle ne pourra plus recevoir de nouvelles réservations. Son historique sera conservé.",
        okText: active ? "Réactiver" : "Désactiver", cancelText: "Annuler", async onOk() {
          setChanging(room.id);
          try {
            await apiRequest(`/api/classrooms/${room.id}/status`, { method: "PATCH", body: JSON.stringify({ active, confirmed: true }) });
            await refresh(); message.success(active ? "La salle est active." : "La salle a été désactivée.");
          } catch (error) {
            const affected = error instanceof ApiError ? (error.details as { sessions?: SessionRow[] } | undefined)?.sessions : undefined;
            if (affected?.length) blocked(affected);
            else message.error(error instanceof Error ? error.message : "Le statut n’a pas pu être modifié.");
          } finally { setChanging(null); }
        } });
    } catch (error) { message.error(error instanceof Error ? error.message : "La vérification a échoué."); }
    finally { setChanging(null); }
  }
  async function showDetails(room: ClassroomRow) {
    setDetails(null); setDrawerOpen(true);
    try { setDetails(await apiRequest<ClassroomDetails>(`/api/classrooms/${room.id}`)); }
    catch (error) { message.error(error instanceof Error ? error.message : "Le détail n’a pas pu être chargé."); setDrawerOpen(false); }
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">VOTRE CENTRE</span><h1>Salles</h1><p>Gérez vos salles et consultez leur disponibilité.</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>Ajouter une salle</Button></div>
    <div className="compact-stats"><Card><span>Salles actives</span><strong>{data.rooms.filter(room => room.active).length}</strong></Card><Card><span>Disponibles sur le créneau</span><strong>{data.rooms.filter(room => room.availability === "DISPONIBLE").length}</strong></Card><Card><span>Occupées sur le créneau</span><strong>{data.rooms.filter(room => room.availability === "OCCUPEE").length}</strong></Card></div>
    <Card className="management-card">
      <div className="availability-toolbar"><div><label>Créneau à consulter · heure de Tunis</label><DatePicker.RangePicker showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm" value={range} onChange={values => setRange(values?.[0] && values[1] ? [values[0], values[1]] : null)} /></div><Button loading={loading} onClick={() => void checkAvailability()}>Vérifier la disponibilité</Button></div>
      <div className="table-toolbar"><Input prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une salle" aria-label="Rechercher une salle" allowClear />
        <Select aria-label="Statut administratif" value={status} onChange={setStatus} options={[{ value: "all", label: "Tous les statuts" }, { value: "active", label: "Actives" }, { value: "inactive", label: "Inactives" }]} />
        <Select aria-label="Disponibilité" value={availability} onChange={setAvailability} options={[{ value: "all", label: "Toute disponibilité" }, { value: "DISPONIBLE", label: "Disponibles" }, { value: "OCCUPEE", label: "Occupées" }, { value: "INACTIVE", label: "Inactives" }]} /></div>
      <p className="muted interval-caption">Disponibilité du {tunisDate(data.startAt).format("DD/MM/YYYY HH:mm")} au {tunisDate(data.endAt).format("DD/MM/YYYY HH:mm")}. Le statut actif est indépendant de l’occupation.</p>
      <Table<ClassroomRow> rowKey="id" dataSource={filtered} loading={loading} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="Aucune salle trouvée" /> }} columns={[
        { title: "Salle", dataIndex: "name", render: (name: string, room) => <Button type="link" className="table-name" onClick={() => void showDetails(room)}>{name}</Button> },
        { title: "Description", dataIndex: "description", render: (value: string | null) => <span className="description-cell">{value || "—"}</span> },
        { title: "Disponibilité", dataIndex: "availability", render: (value: ClassroomRow["availability"]) => <Tag color={value === "DISPONIBLE" ? "green" : value === "OCCUPEE" ? "orange" : "default"}>{value === "DISPONIBLE" ? "Disponible" : value === "OCCUPEE" ? "Occupée" : "Inactive"}</Tag> },
        { title: "Salle active", render: (_, room) => <Switch aria-label={`Activer ou désactiver ${room.name}`} checked={room.active} loading={changing === room.id} onChange={active => void changeStatus(room, active)} /> },
        { title: "Réservations à venir", dataIndex: "futurePlannedCount", render: (value: number) => `${value} séance(s) ou programmation(s)` },
        { title: "Actions", render: (_, room) => <Space><Button icon={<EyeOutlined />} aria-label={`Voir ${room.name}`} onClick={() => void showDetails(room)} /><Button icon={<EditOutlined />} aria-label={`Modifier ${room.name}`} onClick={() => { setEditing(room); setFormOpen(true); }} /></Space> },
      ]} />
    </Card>
    <ClassroomForm room={editing} open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => refresh()} />
    <Drawer title={details?.name ?? "Détails de la salle"} open={drawerOpen} onClose={() => setDrawerOpen(false)} size={850}>
      {!details ? <Skeleton active /> : <><Descriptions bordered column={1} items={[
        { key: "description", label: "Description", children: details.description || "Aucune description" },
        { key: "status", label: "Statut", children: <Tag color={details.active ? "green" : "default"}>{details.active ? "Active" : "Inactive"}</Tag> },
        { key: "created", label: "Créée le", children: tunisDate(details.createdAt).format("DD/MM/YYYY") },
        { key: "updated", label: "Modifiée le", children: tunisDate(details.updatedAt).format("DD/MM/YYYY HH:mm") },
      ]} /><h2 className="subsection-title">Historique et séances à venir</h2><p className="muted">{details.totalSessions} occurrence(s) enregistrée(s). Les 100 dernières occurrences enregistrées et les séances fixes des 90 prochains jours sont affichées.</p><SessionTable sessions={details.sessions} /></>}
    </Drawer>
    <Alert className="subtle-info" type="info" showIcon title="Une salle inactive conserve tout son historique et ne peut pas recevoir de nouvelles réservations." />
  </>;
}
