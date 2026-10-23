import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const googleClientId = process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "safepath-jwt-secret-signing-key-production-recovery-2026",
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        try {
          const backendUrl = process.env.INTERNAL_BACKEND_URL || "http://127.0.0.1:8000";
          const res = await fetch(`${backendUrl}/api/v1/user/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "google",
              provider_account_id: account.providerAccountId,
              email: user.email,
              display_name: user.name || "Người dùng Google",
              avatar_url: user.image || null,
            }),
          });
          if (res.ok) {
            const synced = await res.json();
            user.id = synced.id;
          }
        } catch (err) {
          console.warn("Backend user sync on Google sign in encountered error:", err);
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.id) {
        token.id = user.id;
      }
      if (account?.providerAccountId) {
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id || token.sub;
        (session.user as any).providerAccountId = token.providerAccountId;
      }
      return session;
    },
  },
};

