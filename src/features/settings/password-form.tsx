"use client";

import { useRef, useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { passwordChangeSchema } from "@/validations/auth";

type Values = { currentPassword: string; newPassword: string; confirmPassword: string };

export function PasswordForm() {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const router = useRouter();

  async function reconnect() {
    try { await signOut({ callbackUrl: "/connexion" }); }
    catch { router.replace("/connexion"); router.refresh(); }
  }

  async function save(values: Values) {
    if (submitting.current) return;
    const parsed = passwordChangeSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    submitting.current = true; setSaving(true); setError(null);
    try {
      await apiRequest("/api/account/password", { method: "POST", body: JSON.stringify(parsed.data) });
      form.resetFields(); setChanged(true);
      await reconnect();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Le mot de passe n’a pas pu être modifié."); }
    finally { submitting.current = false; setSaving(false); }
  }

  return <section className="settings-card"><h2>Sécurité du compte</h2>
    <p>Après modification, toutes vos sessions seront invalidées et une nouvelle connexion sera nécessaire.</p>
    {error && <Alert type="error" showIcon title={error} className="form-alert" />}
    {changed ? <Alert type="success" showIcon title="Votre mot de passe a été modifié." description="Reconnectez-vous avec votre nouveau mot de passe." action={<Button onClick={() => void reconnect()}>Se reconnecter</Button>} /> :
      <Form form={form} layout="vertical" onFinish={save} disabled={saving} requiredMark>
        <Form.Item label="Mot de passe actuel" name="currentPassword" rules={[{ required: true, message: "Saisissez votre mot de passe actuel." }]}>
          <Input.Password autoComplete="current-password" maxLength={256} />
        </Form.Item>
        <div className="form-columns"><Form.Item label="Nouveau mot de passe" name="newPassword" rules={[{ required: true, min: 12, max: 256, message: "Choisissez un mot de passe de 12 à 256 caractères." }]}>
          <Input.Password autoComplete="new-password" maxLength={256} />
        </Form.Item>
        <Form.Item label="Confirmer le nouveau mot de passe" name="confirmPassword" dependencies={["newPassword"]} rules={[{ required: true, message: "Confirmez votre nouveau mot de passe." }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("Les deux nouveaux mots de passe ne correspondent pas.")) })]}>
          <Input.Password autoComplete="new-password" maxLength={256} />
        </Form.Item></div>
        <Button type="primary" htmlType="submit" loading={saving}>Modifier le mot de passe</Button>
      </Form>}
  </section>;
}
