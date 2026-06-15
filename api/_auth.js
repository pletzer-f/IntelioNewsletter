// api/_auth.js — verify a Supabase Auth bearer token on server-side routes.
// Returns the authenticated user object, or null if the token is missing/invalid.

import { createClient } from '@supabase/supabase-js';

export async function getUserFromRequest(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
