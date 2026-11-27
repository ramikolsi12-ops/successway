export function formatMoney(value: string): string {
  if (!/^-?\d+\.\d{3}$/.test(value)) throw new Error("Le montant doit être normalisé à trois décimales.");
  const [integer, fraction] = value.split(".");
  const grouped = new Intl.NumberFormat("fr-TN", { maximumFractionDigits: 0 }).format(BigInt(integer));
  const negativeZero = value.startsWith("-0.") ? "−" : "";
  return `${negativeZero}${grouped},${fraction} DT`;
}

export function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
