import { createFileRoute, useNavigate, useSearch, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ensureBootstrapAdmin } from "@/lib/bootstrap.functions";
import { FusionLogo } from "@/components/FusionLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: search.redirect || "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/auth" });
  const bootstrap = useServerFn(ensureBootstrapAdmin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(true);

  useEffect(() => {
    bootstrap().catch(() => {}).finally(() => setSeeding(false));
  }, [bootstrap]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    nav({ to: search.redirect || "/dashboard" });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8"><FusionLogo /></div>
      <Card className="w-full max-w-md p-8 shadow-[var(--shadow-card)]">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Entrar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Controle Financeiro</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Login</Label>
            <Input
              id="email" type="email" autoComplete="username"
              placeholder="seu@email.com" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Senha</Label>
            <div className="relative">
              <Input
                id="pw" type={showPw ? "text" : "password"} autoComplete="current-password"
                required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" onClick={() => setShowPw((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={loading || seeding} className="w-full h-11 text-base font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
          </Button>
          {seeding && (
            <p className="text-xs text-muted-foreground text-center">Preparando ambiente…</p>
          )}
        </form>
      </Card>
      <p className="mt-8 text-xs text-muted-foreground">© {new Date().getFullYear()} Fusion Logística</p>
    </div>
  );
}
