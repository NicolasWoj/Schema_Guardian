"use client";

import { createClient } from "@supabase/supabase-js";

// 🚨 Démo de fuite : dans un Client Component, la clé service_role finit
// dans le bundle JavaScript envoyé au navigateur. Elle contourne toute la RLS.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export function LeakDemo() {
  const loadAllProfiles = async () => {
    // Atteignable depuis le navigateur, sans aucune protection RLS.
    const { data } = await supabaseAdmin.from("profiles").select("*");
    return data ?? [];
  };

  void loadAllProfiles;
  return null;
}
