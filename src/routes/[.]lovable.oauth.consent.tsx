import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FusionLogo } from "@/components/FusionLogo";
import { Loader2 } from "lucide-react";

type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: { client?: { name?: string }; redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};

function getOauth(): OAuthNs {
  return (supabase.auth as unknown as { oauth: OAuthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { redirect: next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await getOauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-md p-6 text-sm text-muted-foreground">
        Não foi possível carregar essa autorização: {String((error as Error)?.message ?? error)}
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const oauth = getOauth();
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) { setBusy(false); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); setError("O servidor de autorização não retornou um redirecionamento."); return; }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "um aplicativo externo";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8"><FusionLogo /></div>
      <Card className="w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-foreground">Conectar {clientName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Isto permite que <strong>{clientName}</strong> acesse seus dados de fluxo de caixa
          como você, usando as mesmas permissões da sua conta.
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Autorizar"}
          </Button>
          <Button onClick={() => decide(false)} disabled={busy} variant="outline" className="flex-1">
            Negar
          </Button>
        </div>
      </Card>
    </main>
  );
}
