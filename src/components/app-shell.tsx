"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Avatar, Button, Drawer, Menu, Modal, Tag } from "antd";
import {
  AppstoreOutlined, CalendarOutlined,
  CreditCardOutlined, HomeOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined, SettingOutlined, UserOutlined,
} from "@ant-design/icons";
import { navigation } from "@/lib/navigation";
import { CentreLogo } from "@/components/centre-logo";
import type { CentreBranding } from "@/types/settings";

const icons = {
  "tableau-de-bord": AppstoreOutlined,
  "emploi-du-temps": CalendarOutlined,
  salles: HomeOutlined,
  professeurs: UserOutlined,
  paiements: CreditCardOutlined,
  parametres: SettingOutlined,
};

export function AppShell({ children, displayName, branding }: { children: React.ReactNode; displayName: string; branding: CentreBranding }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [modal, contextHolder] = Modal.useModal();
  const current = navigation.find(item => path === `/${item.key}` || path.startsWith(`/${item.key}/`));
  const sidebar = (compact = false) => <>
    <Link href="/tableau-de-bord" className="brand" title={branding.name} onClick={() => setOpen(false)}>
      <CentreLogo branding={branding} />
      <span className="brand-name">{branding.name}<span className="brand-subtitle">ADMINISTRATION</span></span>
    </Link>
    <div className="nav-caption">ESPACE ADMINISTRATEUR</div>
    <Menu theme="dark" mode="inline" inlineCollapsed={compact} selectedKeys={[current?.key ?? ""]} items={navigation.map(item => {
      const Icon = icons[item.key];
      return { key: item.key, icon: <Icon />, label: <Link href={`/${item.key}`} onClick={() => setOpen(false)}>{item.label}</Link> };
    })} />
    <div className="sidebar-footer"><Button className="sidebar-logout" type="text" icon={<LogoutOutlined />} loading={loggingOut} onClick={logout} title="Se déconnecter" aria-label="Se déconnecter">{!compact && "Se déconnecter"}</Button>{!compact && <span>Français · TND · Africa/Tunis</span>}</div>
  </>;
  const logout = () => modal.confirm({
    title: "Se déconnecter ?", content: "Vous devrez saisir vos identifiants pour accéder au centre.",
    okText: "Se déconnecter", cancelText: "Annuler", async onOk() {
      setLoggingOut(true);
      try {
        const response = await signOut({ callbackUrl: "/connexion", redirect: false });
        if (!response?.url || "error" in response && response.error) throw new Error("Déconnexion refusée");
        const destination = new URL(response.url, window.location.origin);
        if (destination.origin !== window.location.origin || destination.pathname !== "/connexion" || destination.searchParams.has("error")) throw new Error("Déconnexion non confirmée");
        window.location.assign(destination.href);
      } catch (cause) {
        modal.error({ title: "La déconnexion n’a pas pu être confirmée", content: "Vérifiez votre connexion puis réessayez. Votre espace reste ouvert tant que la déconnexion n’est pas confirmée.", okText: "Fermer" });
        throw cause;
      } finally { setLoggingOut(false); }
    },
  });

  return <div className={`app-layout${collapsed ? " sidebar-collapsed" : ""}`}>
    {contextHolder}
    <aside className="desktop-sidebar" aria-label="Navigation principale">{sidebar(collapsed)}</aside>
    <Drawer title="Navigation" placement="left" size={274} open={open} onClose={() => setOpen(false)} styles={{ body: { padding: 0, background: "#111f3b", color: "white", display: "flex", flexDirection: "column" } }}>{sidebar()}</Drawer>
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-left"><Button className="mobile-menu" type="text" icon={<MenuOutlined />} aria-label="Ouvrir le menu" onClick={() => setOpen(true)} /><Button className="desktop-menu" type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} aria-label={collapsed ? "Développer le menu" : "Réduire le menu"} title={collapsed ? "Développer le menu" : "Réduire le menu"} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} /><span className="topbar-breadcrumb"><span className="topbar-centre">{branding.name}<span className="breadcrumb-separator">/</span></span><strong>{current?.label ?? "Administration"}</strong></span></div>
        <div className="account"><Tag className="admin-tag">Administrateur</Tag><Avatar icon={<UserOutlined />} style={{ background: "#edf2ff", color: "#2256d8" }} /><span className="account-name">{displayName}</span><Button type="text" icon={<LogoutOutlined />} aria-label="Se déconnecter" title="Se déconnecter" loading={loggingOut} onClick={logout} /></div>
      </header>
      <main className="page-content">{children}</main>
      <footer className="app-footer">{branding.name}<span>Tunisie · Africa/Tunis · DT</span></footer>
    </div>
  </div>;
}
