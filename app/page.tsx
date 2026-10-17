import { redirect } from "next/navigation";
import { OperationsDashboard } from "@/components/dashboard/operations-dashboard";
import { AppShell } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { createWorkspaceAction } from "@/app/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const query = await searchParams;
  let supabase;
  try { supabase = await createSupabaseServerClient(); }
  catch { return <AppShell><main className="mx-auto max-w-3xl p-8"><h1 className="mono text-lg">Supabase configuration required</h1><p className="mt-3 text-sm text-muted-foreground">Set the Supabase project URL and publishable key, then apply the tracked migrations.</p></main></AppShell>; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: rows, error } = await supabase.from("projects").select("id,name,owner_id,created_at").order("created_at", { ascending: true }).limit(1);
  if (error) return <AppShell><main className="mx-auto max-w-3xl p-8"><h1 className="mono text-lg">Supabase migration required</h1><p className="mt-3 text-sm text-muted-foreground">The Auth service responded, but GentX2’s project schema is not available yet. Apply the tracked migrations in `supabase/migrations/` before starting scans.</p></main></AppShell>;
  let project = rows?.[0];
  if (!project) return <AppShell><main className="mx-auto grid min-h-[70vh] max-w-3xl content-center gap-4 p-8"><h1 className="mono text-lg">No workspace yet</h1><p className="max-w-xl text-sm text-muted-foreground">Create an empty workspace to begin. GentX2 will not create project or target records until you choose to do so.</p>{query.workspace === "error" && <p role="alert" className="text-sm text-rose-300">Workspace creation failed. Check the project schema and your account permissions.</p>}<form action={createWorkspaceAction}><Button type="submit">Create empty workspace</Button></form></main></AppShell>;
  return <OperationsDashboard initialProjectId={project.id} userEmail={user.email ?? "operator"} />;
}
