"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyTheme } from "@prepquest/ui";
import type {
  LoginInput,
  LoginResponse,
  MeResponse,
  MfaRequiredResponse,
  SignupInput,
} from "@prepquest/shared";
import { api, refreshSession, setAccessToken } from "./api";

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  status: Status;
  user: MeResponse | null;
  /** Resolves to `{ mfaToken }` when the account needs a second factor, or `null` once signed in. */
  login: (input: LoginInput) => Promise<{ mfaToken: string } | null>;
  /** Second step of a 2FA login (also used after social sign-in). */
  completeMfa: (input: { mfaToken: string; code?: string; recoveryCode?: string }) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Replace the cached user after a profile/settings change. */
  setUser: (user: MeResponse) => void;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<MeResponse | null>(null);

  const adopt = useCallback((me: MeResponse) => {
    setUserState(me);
    setStatus("authed");
    // account preference wins on sign-in; "system" keeps whatever this device is showing
    if (me.settings.theme !== "system") applyTheme(me.settings.theme, me.settings.readableMode);
  }, []);

  const adoptSession = useCallback(
    (res: LoginResponse) => {
      setAccessToken(res.accessToken);
      adopt(res.user);
    },
    [adopt],
  );

  useEffect(() => {
    let alive = true;
    void refreshSession().then((res) => {
      if (!alive) return;
      if (res) adopt(res.user);
      else setStatus("anon");
    });
    return () => {
      alive = false;
    };
  }, [adopt]);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api<LoginResponse | MfaRequiredResponse>("/auth/login", {
        method: "POST",
        json: input,
      });
      if ("mfaRequired" in res) return { mfaToken: res.mfaToken };
      adoptSession(res);
      return null;
    },
    [adoptSession],
  );

  const completeMfa = useCallback(
    async (input: { mfaToken: string; code?: string; recoveryCode?: string }) => {
      adoptSession(await api<LoginResponse>("/auth/2fa/login", { method: "POST", json: input }));
    },
    [adoptSession],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      await api("/auth/signup", { method: "POST", json: input });
      await login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", json: {} });
    } finally {
      setAccessToken(null);
      setUserState(null);
      setStatus("anon");
    }
  }, []);

  const reload = useCallback(async () => {
    adopt(await api<MeResponse>("/me"));
  }, [adopt]);

  const value = useMemo<AuthValue>(
    () => ({ status, user, login, completeMfa, signup, logout, setUser: setUserState, reload }),
    [status, user, login, completeMfa, signup, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
