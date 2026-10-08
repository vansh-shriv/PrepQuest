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
import type { LoginInput, LoginResponse, MeResponse, SignupInput } from "@prepquest/shared";
import { api, refreshSession, setAccessToken } from "./api";

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  status: Status;
  user: MeResponse | null;
  login: (input: LoginInput) => Promise<void>;
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
      const res = await api<LoginResponse>("/auth/login", { method: "POST", json: input });
      setAccessToken(res.accessToken);
      adopt(res.user);
    },
    [adopt],
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
    () => ({ status, user, login, signup, logout, setUser: setUserState, reload }),
    [status, user, login, signup, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
