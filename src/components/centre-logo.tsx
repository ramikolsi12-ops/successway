import Image from "next/image";
import { ReadOutlined } from "@ant-design/icons";
import type { CentreBranding } from "@/types/settings";

export function CentreLogo({ branding }: { branding: CentreBranding }) {
  return <span className={`brand-symbol centre-logo${branding.logoUrl ? " centre-logo-image" : ""}`}>
    {branding.logoUrl ? <Image src={branding.logoUrl} alt={`Logo de ${branding.name}`} width={48} height={48} unoptimized /> : <ReadOutlined aria-hidden />}
  </span>;
}
