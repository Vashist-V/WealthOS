import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { demoSession, supabase } from "./api";
import { randomId } from "./utils";

type Status = "loading" | "signed_out" | "demo" | "user";

interface AuthState {
  status: Status;
  email: string | null;
  displayName: string | null;
  /** True when Supabase is configured, so real accounts are available. */
  accountsEnabled: boolean;
  /** Set while the user is following a password-reset link. */
  recovering: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to true when the account still needs email confirmation. */
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
  enterDemo: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first — check your inbox for the link.";
  if (/already registered/i.test(message)) return "An account with that email already exists. Try signing in.";
  if (/rate limit/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const fallback = () => setStatus(demoSession.get() ? "demo" : "signed_out");
    if (!supabase) {
      fallback();
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail(data.session.user.email ?? null);
        setDisplayName((data.session.user.user_metadata?.display_name as string) ?? null);
        setStatus("user");
      } else fallback();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (session) {
        setEmail(session.user.email ?? null);
        setDisplayName((session.user.user_metadata?.display_name as string) ?? null);
        setStatus("user");
      } else if (event === "SIGNED_OUT") {
        setEmail(null);
        setDisplayName(null);
        fallback();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Cached data belongs to one identity; never let it bleed into another.
  useEffect(() => {
    if (status !== "loading") queryClient.clear();
  }, [status, email, queryClient]);

  const signIn = useCallback(async (mail: string, password: string) => {
    if (!supabase) throw new Error("Accounts are not configured.");
    const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
    if (error) throw new Error(friendly(error.message));
    demoSession.park();
  }, []);

  const signUp = useCallback(async (mail: string, password: string, name: string) => {
    if (!supabase) throw new Error("Accounts are not configured.");
    const { data, error } = await supabase.auth.signUp({
      email: mail,
      password,
      options: { data: { display_name: name }, emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(friendly(error.message));
    if (data.session) demoSession.park();
    return !data.session;
  }, []);

  const sendPasswordReset = useCallback(async (mail: string) => {
    if (!supabase) throw new Error("Accounts are not configured.");
    const { error } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: window.location.origin });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error("Accounts are not configured.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
    setRecovering(false);
  }, []);

  const updateName = useCallback(async (name: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (error) throw new Error(friendly(error.message));
    setDisplayName(name);
  }, []);

  const enterDemo = useCallback(() => {
    if (!demoSession.get()) demoSession.resume(randomId());
    setStatus("demo");
  }, []);

  const signOut = useCallback(async () => {
    if (status === "user" && supabase) await supabase.auth.signOut();
    demoSession.park();
    setStatus("signed_out");
  }, [status]);

  const value = useMemo<AuthState>(
    () => ({
      status, email, displayName, recovering, accountsEnabled: supabase !== null,
      signIn, signUp, sendPasswordReset, updatePassword, updateName, enterDemo, signOut,
    }),
    [status, email, displayName, recovering, signIn, signUp, sendPasswordReset, updatePassword, updateName, enterDemo, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
