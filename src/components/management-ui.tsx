"use client";
import { Empty, Table, Tag, Tooltip } from "antd";
import { formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import type { SessionRow, SessionStatus } from "@/types/management";

export function MoneyText({ value, available = true }: { value: string | null; available?: boolean }) {
  return value !== null && available ? <span className="money-value">{formatMoney(value)}</span> : <Tooltip title="Aucune écriture financière enregistrée"><span className="muted">—</span></Tooltip>;
}
export function StatusTag({ status }: { status: SessionStatus }) {
  const labels = { PLANIFIEE: "Prévue", EN_COURS: "En cours", TERMINEE: "Terminée", ABSENT: "Absent", ANNULEE: "Annulée" };
  const colors = { PLANIFIEE: "blue", EN_COURS: "green", TERMINEE: "cyan", ABSENT: "red", ANNULEE: "default" };
  return <Tag color={colors[status]}>{labels[status]}</Tag>;
}
export function BookingList({ sessions }: { sessions: SessionRow[] }) {
  return <div className="blocking-sessions">{sessions.map(session => <div key={session.id}>
    <strong>{tunisDate(session.startAt).format("DD/MM/YYYY HH:mm")} – {tunisDate(session.endAt).format("HH:mm")}</strong>
    <span>{session.teacherName} · {session.classroomName}</span>
    {session.id.includes("@") && <small>Fixe · répétition hebdomadaire</small>}
  </div>)}</div>;
}
export function SessionTable({ sessions, pagination = true }: { sessions: SessionRow[]; pagination?: boolean }) {
  return <Table<SessionRow> rowKey="id" dataSource={sessions} size="middle" scroll={{ x: 690 }}
    pagination={pagination ? { pageSize: 10, showSizeChanger: false } : false}
    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune séance enregistrée" /> }} columns={[
      { title: "Date", dataIndex: "startAt", render: (value: string) => tunisDate(value).format("DD/MM/YYYY") },
      { title: "Horaire", render: (_, row) => `${tunisDate(row.startAt).format("HH:mm")} – ${tunisDate(row.endAt).format("HH:mm")}` },
      { title: "Professeur", dataIndex: "teacherName" }, { title: "Salle", dataIndex: "classroomName" },
      { title: "Statut", dataIndex: "status", render: (status: SessionStatus) => <StatusTag status={status} /> },
    ]} />;
}
