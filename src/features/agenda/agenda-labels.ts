import type { SessionStatus } from "@/types/management";

export const statusLabels: Record<SessionStatus, string> = {
  PLANIFIEE: "Prévue", EN_COURS: "En cours", TERMINEE: "Terminée", ABSENT: "Absent", ANNULEE: "Annulée",
};
export const weekdays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const weekdayOptions = weekdays.map((label, index) => ({ value: index + 1, label }));
export const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const value = `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
  return { value, label: value };
});
export const endTimeOptions = [...timeOptions.slice(1), { value: "24:00", label: "24:00 · minuit" }];
