"use client";
import { Button, Result } from "antd";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Result status="error" title="Les données n’ont pas pu être chargées" subTitle="Vérifiez que PostgreSQL est démarré et que la base a été initialisée, puis réessayez." extra={<Button type="primary" onClick={reset}>Réessayer</Button>} />;
}
