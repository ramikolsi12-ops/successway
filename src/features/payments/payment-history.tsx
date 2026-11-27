"use client";

import { useMemo, useState } from "react";
import { Button, DatePicker, Empty, Input, Select, Space, Table, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { tunisDate } from "@/lib/dates";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { compareMoney, sumMoney } from "./finance-ui";
import type { ProfessorRow } from "@/types/management";
import type { FinancialPayment } from "@/types/payments";

export function PaymentHistory({ payments, professors, onOpen, showProfessor = true, initialProfessorId }: {
  payments: FinancialPayment[]; professors: ProfessorRow[]; onOpen: (id: string) => void; showProfessor?: boolean; initialProfessorId?: string;
}) {
  const [teacherId, setTeacherId] = useState<string | undefined>(initialProfessorId);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [range, setRange] = useState<[string, string] | null>(null);
  function changePeriod(value: string) {
    setPeriod(value);
    const today = tunisDate();
    if (value === "all" || value === "custom") setRange(null);
    else if (value === "today") setRange([today.format("YYYY-MM-DD"), today.format("YYYY-MM-DD")]);
    else if (value === "week") setRange([today.startOf("week").format("YYYY-MM-DD"), today.endOf("week").format("YYYY-MM-DD")]);
    else if (value === "month") setRange([today.startOf("month").format("YYYY-MM-DD"), today.endOf("month").format("YYYY-MM-DD")]);
    else if (value === "previous") setRange([today.subtract(1, "month").startOf("month").format("YYYY-MM-DD"), today.subtract(1, "month").endOf("month").format("YYYY-MM-DD")]);
  }
  const periodPayments = useMemo(() => payments.filter(row => (!teacherId || row.teacherId === teacherId) && (!range || row.paymentDate >= range[0] && row.paymentDate <= range[1]) && `${row.teacherName} ${row.id} ${row.notes ?? ""}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [payments, teacherId, range, query]);
  const filtered = periodPayments.filter(row => status === "all" || (status === "valid" ? row.valid : !row.valid));
  const total = sumMoney(periodPayments.filter(row => row.valid).map(row => row.amount));
  return <>
    <div className="table-toolbar"><Input prefix={<SearchOutlined />} aria-label="Rechercher dans l’historique" placeholder="Nom, identifiant ou note" value={query} onChange={event => setQuery(event.target.value)} allowClear />
      {showProfessor && <Select allowClear showSearch optionFilterProp="label" aria-label="Filtrer les paiements par professeur" placeholder="Tous les professeurs" value={teacherId} onChange={setTeacherId} options={professors.map(row => ({ value: row.id, label: `${row.fullName}${row.active ? "" : " · Inactif"}` }))} />}
      <Select aria-label="Filtrer le statut des paiements" value={status} onChange={setStatus} options={[{ value: "all", label: "Valides et annulés" }, { value: "valid", label: "Valides" }, { value: "cancelled", label: "Annulés / corrigés" }]} />
      <Select aria-label="Période des encaissements" value={period} onChange={changePeriod} options={[{ value: "all", label: "Toutes périodes" }, { value: "today", label: "Aujourd’hui" }, { value: "week", label: "Cette semaine" }, { value: "month", label: "Ce mois" }, { value: "previous", label: "Mois précédent" }, { value: "custom", label: "Période personnalisée" }]} />
      <DatePicker.RangePicker aria-label="Dates de début et de fin des encaissements" format="DD/MM/YYYY" value={range ? [tunisDate(`${range[0]}T12:00:00+01:00`), tunisDate(`${range[1]}T12:00:00+01:00`)] : null} onChange={dates => { setPeriod("custom"); setRange(dates?.[0] && dates[1] ? [dates[0].format("YYYY-MM-DD"), dates[1].format("YYYY-MM-DD")] : null); }} />
    </div>
    <p className="inline-summary"><strong>Encaissements valides {range ? `du ${formatDateOnly(range[0])} au ${formatDateOnly(range[1])}` : "sur toutes les périodes"} : {formatMoney(total)}</strong><span>Dates des paiements, heure de Tunis. Les paiements annulés ou corrigés sont exclus de ce total.</span></p>
    <Table<FinancialPayment> rowKey="id" dataSource={filtered} scroll={{ x: showProfessor ? 1280 : 1100 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: count => `${count} paiement(s)` }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun paiement pour ces filtres" /> }} columns={[
      { title: "Identifiant", render: (_, row) => <Button type="link" onClick={() => onOpen(row.id)}>{row.id.slice(0, 8)}</Button> },
      { title: "Date du paiement", dataIndex: "paymentDate", defaultSortOrder: "descend", sorter: (a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.createdAt.localeCompare(b.createdAt), render: formatDateOnly },
      ...(showProfessor ? [{ title: "Professeur", dataIndex: "teacherName" }] : []),
      { title: "Montant reçu", dataIndex: "amount", sorter: (a, b) => compareMoney(a.amount, b.amount), render: formatMoney },
      { title: "Séances couvertes", render: (_, row) => new Set(row.allocations.filter(allocation => allocation.valid).map(allocation => allocation.chargeId)).size },
      { title: "Affecté aux séances", dataIndex: "allocated", render: formatMoney },
      { title: "Notes", dataIndex: "notes", ellipsis: true, render: value => value || "—" },
      { title: "Enregistré le", dataIndex: "createdAt", render: (value: string) => tunisDate(value).format("DD/MM/YYYY HH:mm") },
      { title: "Statut", render: (_, row) => <Tag color={row.valid ? "green" : "default"}>{row.valid ? "Valide" : row.replacementId ? "Corrigé" : "Annulé"}</Tag> },
      { title: "Actions", fixed: "right", render: (_, row) => <Space><Button size="small" onClick={() => onOpen(row.id)}>Détails</Button></Space> },
    ]} />
  </>;
}
