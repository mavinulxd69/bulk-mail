import "server-only";
import { createClient } from "@supabase/supabase-js";
// Service-role client: bypasses RLS. Server-only; always scope queries by user_id yourself.
export const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
