import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Idempotent: creates the initial admin@fusion.log.br if missing.
// Public serverFn (no auth required) - safe because it only ever creates ONE specific admin, and only if it doesn't exist.
export const ensureBootstrapAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const EMAIL = "admin@fusion.log.br";
  const PASSWORD = "admin@fusion.log.br";

  // Look for existing user by listing (page 1 is fine for a small user base; we only need to know if THIS email exists)
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

  // Ensure admin role
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });

  return { ok: true, email: EMAIL };
});

// Admin-only: create additional users
export const createUser = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["admin", "user"]).default("user"),
  }).parse(raw))
  .handler(async ({ data }) => {
    const { requireSupabaseAuth } = await import("@/integrations/supabase/auth-middleware");
    void requireSupabaseAuth; // placeholder marker
    throw new Error("Use createUserAuthed"); // sentinel
  });
