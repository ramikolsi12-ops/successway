export interface CentreSettings {
  name: string;
  phone: string;
  address: string;
  email: string | null;
  openingMinute: number;
  closingMinute: number;
  openingDays: number[];
  logoUrl: string | null;
}

export type CentreSettingsInput = Omit<CentreSettings, "logoUrl">;
export type CentreBranding = Pick<CentreSettings, "name" | "logoUrl">;
