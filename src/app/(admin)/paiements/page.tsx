import { requireAdministrator } from "@/server/authorization";
import { getPaymentsOverview } from "@/services/payments";
import { PaymentsOverview } from "@/features/professors/payments-overview";
export const metadata = { title: "Paiements reçus" };
export default async function PaymentsPage() {
  await requireAdministrator();
  return <PaymentsOverview initialData={await getPaymentsOverview()} />;
}
