"use client";

import { createClient } from "@supabase/supabase-js";

// ✅ Usage sûr : la clé anon est PUBLIQUE par conception et gouvernée par la RLS.
// L'exposer dans un Client Component est le pattern attendu — aucun finding ne doit être levé.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function PublicFeed() {
  const loadPosts = async () => {
    const { data } = await supabase.from("posts").select("id, title");
    return data ?? [];
  };

  void loadPosts;
  return null;
}
