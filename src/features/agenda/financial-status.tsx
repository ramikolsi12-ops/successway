import { Tag } from "antd";
import type { FinancialStatus } from "@/types/payments";

export const financialStatusLabels: Record<FinancialStatus, string> = {
  PAYEE: "Payée", PARTIELLE: "Partiellement payée", NON_PAYEE: "Non payée", NON_APPLICABLE: "Non applicable",
};
export function FinancialStatusTag({ status }: { status: FinancialStatus }) {
  return <Tag color={status === "PAYEE" ? "green" : status === "PARTIELLE" ? "orange" : status === "NON_PAYEE" ? "red" : "default"}>{financialStatusLabels[status]}</Tag>;
}
