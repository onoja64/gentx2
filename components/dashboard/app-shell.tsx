"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Cable, Command, CreditCard, FileClock, LogOut, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { signOutAction } from "@/app/auth/actions";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Operations", icon: Activity },
  { href: "/#history", label: "Sessions", icon: FileClock },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function AppShell({ children, userEmail }: Readonly<{ children: React.ReactNode; userEmail?: string }>) {
  const pathname = usePathname();
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="grid-field pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-70" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] border-r border-[var(--terminal-green)]/10 bg-[#080d0b]/95 px-3 py-4 backdrop-blur-xl lg:flex lg:flex-col">
        <Link href="/" className="mb-9 flex items-center gap-3 rounded-md px-2 py-1.5 focus-ring">
          <div className="relative grid size-9 place-items-center rounded-md border border-[var(--terminal-green)]/30 bg-[var(--terminal-green)]/[0.07] text-[var(--terminal-green)]"><Shield className="size-[18px]" strokeWidth={1.6} /><span className="absolute -right-1 -top-1 size-2 rounded-full bg-[var(--terminal-green)]" /></div>
          <div><div className="mono text-[14px] font-semibold tracking-[-0.05em] text-foreground">GentX<span className="text-[var(--terminal-green)]">2</span></div><div className="eyebrow mt-0.5 text-[7px] text-muted-foreground">CYBER OPERATIONS</div></div>
        </Link>

        <div className="eyebrow px-3 pb-2 text-muted-foreground/70">Workspace</div>
        <nav aria-label="Primary" className="space-y-1">{navItems.map(({ href, label, icon: Icon }) => {
          const active = (href === "/" && pathname === "/") || (href === "/billing" && pathname.startsWith("/billing"));
          return <Link key={href} href={href} className={cn("group flex h-9 items-center gap-3 rounded px-3 mono text-[9px] font-medium transition-colors", active ? "border border-[var(--terminal-green)]/15 bg-[var(--terminal-green)]/[0.045] text-foreground" : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground")}><Icon className={cn("size-3.5", active ? "text-[var(--terminal-green)]" : "text-muted-foreground/80")} strokeWidth={1.7} />{label}{label === "Sessions" && <span className="ml-auto rounded border border-border px-1.5 py-0.5 mono text-[7px] text-muted-foreground">DB</span>}</Link>;
        })}</nav>

        <div className="mt-8 px-3"><div className="eyebrow mb-3 text-muted-foreground/70">Trust boundary</div><div className="rounded-md border border-[var(--aqua)]/15 bg-[var(--aqua)]/[0.025] p-3"><div className="flex items-center gap-2 mono text-[9px] font-medium text-foreground/90"><Cable className="size-3.5 text-[var(--aqua)]" />CreateOS egress gate</div><p className="mt-2 text-[8px] leading-relaxed text-muted-foreground">A run must verify a non-empty scoped allowlist before target code executes.</p><div className="mt-3 flex items-center gap-2 border-t border-border/65 pt-2.5 mono text-[7px] text-muted-foreground"><span className="size-1.5 rounded-full bg-amber-300" />No sandbox reserved</div></div></div>

        <div className="mt-auto px-2"><div className="flex items-center justify-between px-1 pt-2 mono text-[7px] text-muted-foreground/70"><span>GENTX2 / 0.1</span><Command className="size-3" /></div></div>
      </aside>

      <main className="relative min-h-screen lg:pl-[216px]">
        <header className="sticky top-0 z-20 flex h-[58px] items-center justify-between border-b border-[var(--terminal-green)]/10 bg-[#080d0b]/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid size-7 place-items-center rounded border border-[var(--terminal-green)]/20 bg-[var(--terminal-green)]/[0.05] text-[var(--terminal-green)] lg:hidden"><Shield className="size-4" /></div><span className="eyebrow text-muted-foreground">SECURITY OPERATIONS</span><span className="hidden text-muted-foreground/35 sm:inline">/</span><span className="hidden mono text-[8px] text-muted-foreground sm:inline">AUTHORIZED ENGAGEMENTS</span></div>
          <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded border border-border/70 bg-white/[0.02] px-2.5 py-1.5 sm:flex"><ShieldCheck className="size-3 text-[var(--aqua)]" /><span className="mono text-[7px] text-muted-foreground">VERIFIER: SESSION-SCOPED</span></div><div className="hidden h-4 w-px bg-border sm:block" /><div className="flex items-center gap-2 mono text-[8px] text-muted-foreground"><span className="text-[var(--terminal-green)]">AUDIT</span><span className="hidden sm:inline">EVENT-DRIVEN</span></div>{userEmail ? <><span className="hidden max-w-[160px] truncate mono text-[8px] text-muted-foreground md:inline">{userEmail}</span><form action={signOutAction}><button type="submit" aria-label="Sign out" className="grid size-7 place-items-center rounded border border-border bg-white/[0.025] text-muted-foreground transition hover:border-rose-300/25 hover:text-rose-100"><LogOut className="size-3.5" /></button></form></> : <div className="grid size-7 place-items-center rounded-full border border-border bg-white/[0.025] text-muted-foreground"><ShieldAlert className="size-3.5" /></div>}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
