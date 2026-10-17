import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function relativeRedirect(path: string, status = 303) {
  return new Response(null, { status, headers: { location: path, "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096) return relativeRedirect("/login?error=auth");
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return relativeRedirect("/login?error=auth");
    return relativeRedirect("/");
  } catch {
    return relativeRedirect("/login?error=auth");
  }
}
