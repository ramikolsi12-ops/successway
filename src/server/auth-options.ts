import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authenticateAdministrator } from "@/services/authentication";
import { invalidateAdministratorSession } from "@/services/account-security";
import { authenticationEnvironment } from "@/server/environment";

const environment = authenticationEnvironment();

export const authOptions: NextAuthOptions = {
  secret: environment.secret,
  useSecureCookies: environment.secureCookies,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/connexion", error: "/connexion" },
  providers: [CredentialsProvider({
    name: "Administrateur",
    credentials: {
      identifier: { label: "Identifiant", type: "text" },
      password: { label: "Mot de passe", type: "password" },
    },
    async authorize(credentials) {
      if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) {
        throw new Error("Configuration d'authentification invalide.");
      }
      return authenticateAdministrator(credentials);
    },
  })],
  events: {
    async signOut(message) {
      if ("token" in message && message.token) await invalidateAdministratorSession(message.token.adminId, message.token.sessionVersion);
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.adminId = user.id; token.sessionVersion = user.sessionVersion; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) { session.user.id = token.adminId; session.user.sessionVersion = token.sessionVersion; }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/") && !url.startsWith("//")) return `${baseUrl}${url}`;
      try { if (new URL(url).origin === baseUrl) return url; } catch { /* Invalid external destinations use the safe default. */ }
      return `${baseUrl}/tableau-de-bord`;
    },
  },
};
