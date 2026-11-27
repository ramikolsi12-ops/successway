"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Checkbox, Form, Image, Input, Select, Space } from "antd";
import { BankOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { centreSettingsSchema } from "@/validations/settings";
import { timeOf } from "@/lib/scheduling";
import type { CentreSettings, CentreSettingsInput } from "@/types/settings";
import styles from "./settings.module.css";

const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"].map((label, index) => ({ label, value: index + 1 }));
const openingOptions = Array.from({ length: 48 }, (_, index) => ({ value: index * 30, label: timeOf(index * 30) }));
const closingOptions = Array.from({ length: 48 }, (_, index) => ({ value: (index + 1) * 30, label: timeOf((index + 1) * 30) }));

export function CentreSettingsForm({ initial }: { initial: CentreSettings }) {
  const [form] = Form.useForm<CentreSettingsInput>();
  const [settings, setSettings] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewReference = useRef<string | null>(null);
  const busy = useRef(false);
  const { message } = App.useApp();
  const router = useRouter();
  useEffect(() => () => { if (previewReference.current) URL.revokeObjectURL(previewReference.current); }, []);

  function clearPreview() {
    if (previewReference.current) URL.revokeObjectURL(previewReference.current);
    previewReference.current = null;
    setPreview(null); setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function perform(action: string, operation: () => Promise<CentreSettings>, success: string) {
    if (busy.current) return;
    busy.current = true; setPending(action); setError(null);
    try {
      const next = await operation();
      setSettings(next);
      if (action === "settings") form.setFieldsValue({ ...next, email: next.email ?? "" });
      if (action !== "settings") clearPreview();
      message.success(success); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Les paramètres n’ont pas pu être enregistrés."); }
    finally { busy.current = false; setPending(null); }
  }

  async function save() {
    if (busy.current) return;
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const parsed = centreSettingsSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await perform("settings", () => apiRequest<CentreSettings>("/api/settings/centre", { method: "PATCH", body: JSON.stringify(parsed.data) }), "Les paramètres du centre ont été enregistrés.");
  }

  function chooseLogo(next: File | undefined) {
    clearPreview(); setError(null);
    if (!next) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size > 2 * 1024 * 1024 || !next.size) {
      setError("Choisissez une image PNG, JPEG ou WebP de 2 Mo maximum."); return;
    }
    const url = URL.createObjectURL(next);
    previewReference.current = url; setPreview(url); setFile(next);
  }

  async function uploadLogo() {
    if (!file) return;
    await perform("logo", async () => {
      const response = await fetch("/api/settings/logo", { method: "POST", body: file, headers: { "Content-Type": file.type }, credentials: "same-origin", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Le logo n’a pas pu être enregistré.");
      return result as CentreSettings;
    }, "Le logo du centre a été enregistré.");
  }

  return <div className={styles.sections}>
    {error && <Alert type="error" title={error} showIcon />}
    <Card title="Logo du centre">
      <div className={styles.logoRow}>
        <div className={styles.logoPreview}>
          {preview || settings.logoUrl ? <Image src={preview ?? settings.logoUrl!} alt={preview ? "Aperçu du nouveau logo" : "Logo du centre"} width={96} height={96} preview={false} style={{ objectFit: "contain" }} /> : <BankOutlined aria-label="Aucun logo configuré" />}
        </div>
        <div>
          <p className={styles.help}>PNG, JPEG ou WebP · 2 Mo maximum. Le logo est conservé après redémarrage.</p>
          <Space wrap>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className={styles.fileInput} aria-label="Choisir le logo du centre" onChange={event => chooseLogo(event.target.files?.[0])} disabled={!!pending} />
            <Button icon={<UploadOutlined />} disabled={!!pending} onClick={() => fileInput.current?.click()}>{settings.logoUrl ? "Remplacer le logo" : "Importer un logo"}</Button>
            {file && <Button type="primary" loading={pending === "logo"} disabled={!!pending} onClick={() => void uploadLogo()}>Enregistrer le logo</Button>}
            {file && <Button disabled={!!pending} onClick={clearPreview}>Annuler l’import</Button>}
            {settings.logoUrl && <Button danger icon={<DeleteOutlined />} loading={pending === "removeLogo"} disabled={!!pending} onClick={() => void perform("removeLogo", () => apiRequest<CentreSettings>("/api/settings/logo", { method: "DELETE" }), "Le logo du centre a été supprimé.")}>Supprimer le logo</Button>}
          </Space>
          {file && <p className={styles.help}>Aperçu : {file.name}. Cliquez sur « Enregistrer le logo » pour confirmer.</p>}
        </div>
      </div>
    </Card>
    <Form form={form} layout="vertical" initialValues={{ ...initial, email: initial.email ?? "" }} disabled={!!pending} onFinish={() => void save()}>
      <div className={styles.sections}>
        <Card title="Informations du centre">
          <div className={styles.twoColumns}>
            <Form.Item name="name" label="Nom du centre" rules={[{ required: true, whitespace: true, message: "Saisissez le nom du centre." }]}><Input maxLength={150} autoComplete="organization" /></Form.Item>
            <Form.Item name="phone" label="Numéro de téléphone" rules={[{ required: true, whitespace: true, message: "Saisissez le téléphone du centre." }]}><Input maxLength={30} autoComplete="tel" /></Form.Item>
          </div>
          <Form.Item name="address" label="Adresse" rules={[{ required: true, whitespace: true, message: "Saisissez l’adresse du centre." }]}><Input.TextArea maxLength={1000} rows={2} autoComplete="street-address" /></Form.Item>
          <Form.Item name="email" label="Adresse e-mail (facultative)" rules={[{ type: "email", message: "L’adresse e-mail est invalide." }]}><Input maxLength={254} autoComplete="email" /></Form.Item>
        </Card>
        <Card title="Horaires du centre">
          <Alert type="info" title="Les nouvelles réservations respectent ces horaires. Un changement incompatible avec une réservation future sera refusé sans modifier les séances." showIcon className={styles.notice} />
          <div className={styles.twoColumns}>
            <Form.Item name="openingMinute" label="Heure d’ouverture" rules={[{ required: true, message: "Choisissez l’heure d’ouverture." }]}><Select options={openingOptions} /></Form.Item>
            <Form.Item name="closingMinute" label="Heure de fermeture" rules={[{ required: true, message: "Choisissez l’heure de fermeture." }]}><Select options={closingOptions} /></Form.Item>
          </div>
          <Form.Item name="openingDays" label="Jours d’ouverture" rules={[{ required: true, type: "array", min: 1, message: "Choisissez au moins un jour d’ouverture." }]}><Checkbox.Group options={days} className={styles.days} /></Form.Item>
          <p className={styles.help}>Les anciennes séances restent consultables après un changement d’horaires.</p>
        </Card>
        <div><Button type="primary" htmlType="submit" loading={pending === "settings"} disabled={!!pending}>Enregistrer les paramètres</Button></div>
      </div>
    </Form>
  </div>;
}
