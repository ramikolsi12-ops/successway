import { tunisDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { FinancialAudit } from "@/types/payments";

function historicalAmount(snapshot: unknown): string {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return "Montant non renseigné";
  const amount: unknown = Reflect.get(snapshot, "amount");
  return typeof amount === "string" && /^\d+\.\d{3}$/.test(amount) ? formatMoney(amount) : "Montant non renseigné";
}

export function ChargePriceHistory({ history }: { history: FinancialAudit[] }) {
  const corrections = history.filter(row => row.action === "CORRECTION_TARIF_SEANCE");
  if (!corrections.length) return null;
  return <section aria-label="Historique des corrections du tarif" style={{ marginTop: 20 }}>
    <h3>Historique des corrections du tarif</h3>
    <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
      {corrections.map(row => <li key={row.id} style={{ marginBottom: 12 }}>
        <p style={{ margin: "0 0 4px" }}><strong>{historicalAmount(row.before)} → {historicalAmount(row.after)}</strong></p>
        <p className="muted" style={{ margin: 0 }}><time dateTime={row.createdAt}>{tunisDate(row.createdAt).format("DD/MM/YYYY HH:mm")}</time> · {row.reason || "Motif non renseigné"}</p>
      </li>)}
    </ol>
  </section>;
}
