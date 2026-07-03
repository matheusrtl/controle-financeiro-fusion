import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { FusionLogo } from "@/components/FusionLogo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActiveReport } from "@/lib/reports.functions";
import { isCurrentUserAdmin } from "@/lib/users.functions";
import { Upload, History, Users, LogOut, LayoutDashboard } from "lucide-react";
import { formatDateBR } from "@/lib/format";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const fetchActive = useServerFn(getActiveReport);
  const fetchAdmin = useServerFn(isCurrentUserAdmin);
  const active = useQuery({ queryKey: ["active-report"], queryFn: () => fetchActive() });
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => fetchAdmin() });
  const isAdmin = adminQ.data?.isAdmin;

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  const rep = active.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 py-3 sm:px-6">
          <Link to="/dashboard" className="shrink-0"><FusionLogo /></Link>
          <div className="hidden md:flex flex-col leading-tight">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Relatório ativo</div>
            <div className="text-sm font-semibold text-foreground truncate max-w-[380px]">
              {rep?.filename ?? "Nenhum relatório importado"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {rep ? `Período ${formatDateBR(rep.period_start)} – ${formatDateBR(rep.period_end)} · ${rep.row_count.toLocaleString("pt-BR")} lançamentos` : "Faça o upload da sua planilha"}
            </div>
          </div>
          <nav className="ml-auto flex items-center gap-1">
            <NavItem to="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
            {isAdmin && <NavItem to="/upload" icon={<Upload className="h-4 w-4" />} label="Novo Upload" />}
            <NavItem to="/historico" icon={<History className="h-4 w-4" />} label="Histórico" />
            {isAdmin && <NavItem to="/usuarios" icon={<Users className="h-4 w-4" />} label="Usuários" />}
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span>
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to as never}
      className="group inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
      activeProps={{ className: "active" }}
    >
      {icon}<span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
