"use client";

import { useRef, useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { loginSchema } from "@/validations/auth";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const submitting = useRef(false);

  async function submit(values: { identifier: string; password: string }) {
    if (submitting.current) return;
    setError(null);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    submitting.current = true; setLoading(true);
    try {
      const response = await signIn("credentials", { ...parsed.data, redirect: false, callbackUrl: "/tableau-de-bord" });
      if (response?.error || !response?.ok) {
        setError("Connexion impossible. Vérifiez vos identifiants ou réessayez dans 15 minutes après plusieurs tentatives.");
      } else { router.replace("/tableau-de-bord"); router.refresh(); }
    } catch { setError("Le service est indisponible. Vérifiez que la base de données est démarrée."); }
    finally { submitting.current = false; setLoading(false); }
  }

  return <Form layout="vertical" onFinish={submit} requiredMark={false} size="large">
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 24 }} role="alert" />}
    <Form.Item name="identifier" label="Identifiant" rules={[{ required: true, message: "Saisissez votre identifiant." }]}>
      <Input prefix={<UserOutlined />} autoComplete="username" maxLength={100} autoFocus placeholder="Votre identifiant" />
    </Form.Item>
    <Form.Item name="password" label="Mot de passe" rules={[{ required: true, message: "Saisissez votre mot de passe." }]}>
      <Input.Password prefix={<LockOutlined />} autoComplete="current-password" maxLength={256} placeholder="Votre mot de passe" />
    </Form.Item>
    <Button type="primary" htmlType="submit" block loading={loading}>Se connecter</Button>
  </Form>;
}
