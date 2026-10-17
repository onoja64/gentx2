"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type AuthMode = "sign-in" | "sign-up";

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const credentials = { email: email.trim(), password };
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp(credentials);
        if (signUpError) throw new Error(signUpError.message.slice(0, 200));
        if (!data.session) {
          setMessage("Supabase did not start a session. Check that email confirmation is disabled for this project, or sign in if you already have an account.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword(credentials);
        if (signInError) throw new Error(signInError.message.slice(0, 200));
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
  }

  return <Card className="terminal-panel w-full max-w-md p-6">
    <div className="flex items-center gap-2 text-[var(--terminal-green)]"><LockKeyhole className="size-4" /><span className="mono text-[10px] tracking-[.16em]">AUTHENTICATED ACCESS</span></div>
    <h1 className="mt-5 mono text-xl font-semibold">{mode === "sign-in" ? "Operator sign-in" : "Create operator account"}</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your email address and password. New accounts can sign in immediately when email confirmation is disabled in Supabase.</p>
    <div className="mt-5 grid grid-cols-2 rounded-md border border-border/70 p-1" role="tablist" aria-label="Authentication mode">
      <button type="button" role="tab" aria-selected={mode === "sign-in"} onClick={() => changeMode("sign-in")} className={`rounded px-3 py-2 text-xs ${mode === "sign-in" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === "sign-up"} onClick={() => changeMode("sign-up")} className={`rounded px-3 py-2 text-xs ${mode === "sign-up" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>Sign up</button>
    </div>
    <form onSubmit={submit} className="mt-5 space-y-4">
      <div className="space-y-2"><label htmlFor="email" className="eyebrow text-muted-foreground">Email address</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary/50" placeholder="you@example.com" /></div>
      <div className="space-y-2"><label htmlFor="password" className="eyebrow text-muted-foreground">Password</label><input id="password" name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-up" ? 8 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary/50" /></div>
      {mode === "sign-up" && <p className="-mt-2 text-xs text-muted-foreground">Use at least 8 characters for a new password.</p>}
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="rounded border border-amber-300/25 bg-amber-300/[0.05] p-3 text-sm leading-6 text-amber-100">{message}</p>}
      <Button type="submit" disabled={busy || !email.includes("@") || password.length === 0 || (mode === "sign-up" && password.length < 8)} className="w-full">{busy ? <><LoaderCircle className="size-4 animate-spin" />{mode === "sign-in" ? "Signing in" : "Creating account"}</> : <>{mode === "sign-in" ? "Sign in" : "Create account"}<ArrowUpRight className="size-4" /></>}</Button>
    </form>
  </Card>;
}
