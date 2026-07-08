
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sugestao_vencimento DATE;

-- Allow authenticated users to update transactions (only sugestao_vencimento in practice via GRANT)
GRANT UPDATE (sugestao_vencimento) ON public.transactions TO authenticated;

CREATE POLICY "Auth update sugestao_vencimento"
ON public.transactions
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
