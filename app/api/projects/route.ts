import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProject, listProjects } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try { return NextResponse.json({ projects: await listProjects(supabase) }, { headers: { "cache-control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Project storage is unavailable; apply the Supabase migration first" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const raw = await request.json();
    const parsed = CreateProjectSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "Project name must be 1–120 characters" }, { status: 400 });
    const project = await createProject(supabase, user.id, parsed.data.name);
    return NextResponse.json({ project }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "Project could not be created" }, { status: 503 }); }
}
