"use client";

import { useState } from "react";
import { ArrowUpRight, CreditCard, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TestCheckout({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function beginCheckout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Checkout could not be started.");
      window.location.assign(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be started.");
      setBusy(false);
    }
  }

  return <div>
    <Button type="button" onClick={() => void beginCheckout()} disabled={!enabled || busy}>
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
      {busy ? "Opening secure checkout" : "Continue to test checkout"}
      {!busy && <ArrowUpRight className="size-3.5" />}
    </Button>
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
  </div>;
}
