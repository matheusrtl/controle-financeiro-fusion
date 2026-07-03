
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Reports
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  period_start date,
  period_end date
);
CREATE UNIQUE INDEX one_active_report ON public.reports(status) WHERE status = 'active';
GRANT SELECT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read reports" ON public.reports FOR SELECT TO authenticated USING (true);

-- Transactions
CREATE TABLE public.transactions (
  id bigserial PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  documento text,
  fornecedor text,
  emissao date,
  vencimento date,
  pagamento date,
  valor numeric(18,2) NOT NULL DEFAULT 0,
  multa numeric(18,2) NOT NULL DEFAULT 0,
  juros numeric(18,2) NOT NULL DEFAULT 0,
  desconto numeric(18,2) NOT NULL DEFAULT 0,
  valor_pago numeric(18,2) NOT NULL DEFAULT 0,
  valor_aberto numeric(18,2) NOT NULL DEFAULT 0,
  valor_total numeric(18,2) NOT NULL DEFAULT 0,
  centro_custo text,
  obs_parcela text,
  obs_lancamento text,
  conta text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('pago','aberto','vencido'))
);
CREATE INDEX tx_report ON public.transactions(report_id);
CREATE INDEX tx_venc ON public.transactions(vencimento);
CREATE INDEX tx_pag ON public.transactions(pagamento);
CREATE INDEX tx_status ON public.transactions(status);
CREATE INDEX tx_fornecedor ON public.transactions(fornecedor);
CREATE INDEX tx_cc ON public.transactions(centro_custo);
CREATE INDEX tx_conta ON public.transactions(conta);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read tx" ON public.transactions FOR SELECT TO authenticated USING (true);
