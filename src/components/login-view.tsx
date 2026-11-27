"use client";

import { LockOutlined } from "@ant-design/icons";
import { LoginForm } from "@/components/login-form";
import { CentreLogo } from "@/components/centre-logo";
import type { CentreBranding } from "@/types/settings";

export function LoginView({ branding }: { branding: CentreBranding }) {
  return <main className="login-page">
    <section className="login-story">
      <div className="login-brand"><CentreLogo branding={branding} /><span>{branding.name}</span></div>
      <div><span className="eyebrow light">VOTRE CENTRE, EN TOUTE SIMPLICITÉ</span><h1>Plus de clarté.<br />Plus de temps<br /><span>pour transmettre.</span></h1><p>Un espace pour organiser votre centre,<br />accompagner vos équipes et suivre votre activité.</p></div>
      <div className="login-story-footer">Conçu pour votre centre en Tunisie.</div>
    </section>
    <section className="login-form-area"><div className="login-card">
      <span className="login-lock"><LockOutlined /></span>
      <span className="eyebrow">ESPACE ADMINISTRATEUR</span>
      <h2>Bienvenue</h2><p className="muted">Connectez-vous pour retrouver l’espace de gestion de {branding.name}.</p>
      <LoginForm />
      <div className="login-note"><LockOutlined /> Accès réservé à l’administration du centre.</div>
    </div><span className="login-bottom">{branding.name} · Administration du centre</span></section>
  </main>;
}
