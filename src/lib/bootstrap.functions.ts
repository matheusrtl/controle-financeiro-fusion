import { createServerFn } from "@tanstack/react-start";

// Idempotent: creates the initial admin@fusion.log.br if missing.
export const ensureBootstrapAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const EMAIL = "admin@fusion.log.br";
  const PASSWORD = "admin@fusion.log.br";

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw new Error(listErr.message);
  let user = list.users.find((u) => u.email === EMAIL);

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    user = data.user!;
  }

  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });

  return { ok: true, email: EMAIL };
});

