"use client";

import { createClient } from "@supabase/supabase-js";

// Clé anon (usage côté client légitime) + table `users` protégée par RLS.
// Le seul problème ici est l'OVER-FETCH : le select tire `password_hash` vers le navigateur,
// donc la donnée fuit dans la réponse réseau même si la RLS restreint les lignes.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function AccountCard() {
  const { data } = await supabase.from("users").select("id, email, password_hash");
  return data ?? [];
}
