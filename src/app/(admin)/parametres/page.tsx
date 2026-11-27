import { requireAdministrator } from "@/server/authorization";
import { getCentreSettings } from "@/services/settings";
import { CentreSettingsForm } from "@/features/settings/centre-settings";
import { PasswordForm } from "@/features/settings/password-form";

export const metadata = { title: "Paramètres" };
export default async function SettingsPage() {
  const admin = await requireAdministrator();
  const settings = await getCentreSettings();
  return <><div className="page-heading"><div><span className="eyebrow">CONFIGURATION</span><h1>Paramètres</h1><p>Configurez les informations et les préférences du centre.</p></div></div>
    <CentreSettingsForm initial={settings} />
    <section className="settings-card"><h2>Préférences de l’application</h2><dl><dt>Langue</dt><dd>Français</dd><dt>Devise</dt><dd>Dinar tunisien (TND) · 3 décimales</dd><dt>Fuseau horaire</dt><dd>Africa/Tunis</dd><dt>Dates et heures</dt><dd>JJ/MM/AAAA · 24 heures · semaine dès lundi</dd><dt>Identifiant administrateur</dt><dd>{admin.identifier}</dd><dt>Accès</dt><dd>Administrateur uniquement</dd></dl></section>
    <PasswordForm />
  </>;
}
