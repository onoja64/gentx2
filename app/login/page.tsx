import { LoginForm } from "@/app/login/login-form";
import { AppShell } from "@/components/dashboard/app-shell";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return <AppShell>
    <main className="mx-auto grid min-h-[80vh] max-w-6xl place-items-center px-4 py-12">
      <LoginForm initialError={query.error ? "Authentication did not complete. Check your email and password, then try again." : undefined} />
    </main>
  </AppShell>;
}
