import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { api, initDevice, loadToken, saveToken, setUnauthorizedHandler, User } from "@/src/api";
import { clearReminders } from "@/src/reminders";

WebBrowser.maybeCompleteAuthSession();

const SID_RE = /[?#&]session_id=([^&#]+)/;
const extractSid = (url?: string | null) => (url ? (url.match(SID_RE)?.[1] ?? null) : null);

// Web: capture the Google callback before the router can rewrite the URL.
const initialWebSid = Platform.OS === "web" && typeof window !== "undefined" ? extractSid(window.location.href) : null;

function cleanWebUrl() {
  if (Platform.OS !== "web") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("session_id");
  const hash = url.hash.replace(/^#/, "").split("&").filter((p) => p && !p.startsWith("session_id=")).join("&");
  url.hash = hash ? `#${hash}` : "";
  window.history.replaceState(window.history.state, "", url.toString());
}

type AuthResult = { token: string; user: User };
type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sentSids = useRef(new Set<string>());
  const qc = useQueryClient();

  const finish = useCallback(
    async (r: AuthResult) => {
      await saveToken(r.token);
      qc.clear();
      setUser(r.user);
    },
    [qc],
  );

  const exchange = useCallback(
    async (sid: string) => {
      if (sentSids.current.has(sid)) return;
      sentSids.current.add(sid);
      const r = await api<AuthResult>("/auth/session", { method: "POST", body: { session_id: sid, device_id: await initDevice() }, auth: false });
      await finish(r);
      cleanWebUrl();
    },
    [finish],
  );

  const clear = useCallback(async () => {
    await saveToken(null);
    qc.clear();
    setUser(null);
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clear();
    });
    (async () => {
      try {
        const sid = initialWebSid ?? (Platform.OS !== "web" ? extractSid(await Linking.getInitialURL()) : null);
        if (sid) {
          await exchange(sid);
          return;
        }
        if (await loadToken()) setUser(await api<User>("/auth/me", { auth: false }));
      } catch {
        await saveToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [exchange, clear]);

  // Hot deep links (native)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSid(url);
      if (sid) exchange(sid).catch(() => {});
    });
    return () => sub.remove();
  }, [exchange]);

  const login = async (email: string, password: string) => {
    const r = await api<AuthResult>("/auth/login", { method: "POST", body: { email, password, device_id: await initDevice() }, auth: false });
    await finish(r);
  };

  const register = async (email: string, password: string, name: string) => {
    const r = await api<AuthResult>("/auth/register", {
      method: "POST",
      body: { email, password, name, device_id: await initDevice() },
      auth: false,
    });
    await finish(r);
  };

  const loginWithGoogle = async () => {
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL("");
    let captured: string | null = null;
    const sub = Linking.addEventListener("url", ({ url }) => {
      captured = url;
    });
    try {
      const res = await WebBrowser.openAuthSessionAsync(`https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`, redirect);
      const url = (res.type === "success" ? res.url : null) ?? captured ?? (await Linking.getInitialURL());
      const sid = extractSid(url);
      if (sid) await exchange(sid);
      else if (res.type === "success") throw new Error("google_failed");
    } finally {
      sub.remove();
    }
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {}, auth: false });
    } catch {}
    await clearReminders();
    await clear();
  };

  const resetPassword = async (email: string, code: string, password: string) => {
    const r = await api<AuthResult>("/auth/reset", { method: "POST", body: { email, code, password }, auth: false });
    await finish(r);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, loginWithGoogle, logout, resetPassword }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
