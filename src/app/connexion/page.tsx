import { LoginView } from "@/components/login-view";
import { getCentreBranding } from "@/services/settings";

export const metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  return <LoginView branding={await getCentreBranding()} />;
}
