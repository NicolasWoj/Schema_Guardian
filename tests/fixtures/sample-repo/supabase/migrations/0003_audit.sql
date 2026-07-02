-- Table d'audit : RLS activée mais AUCUNE policy -> deny-all (aucune ligne lisible).
-- Ce n'est PAS une exposition : cas « gris » qui ne doit jamais remonter en high/medium.

create table public.audit_log (
  id uuid primary key,
  action text not null,
  created_at timestamptz default now()
);

alter table public.audit_log enable row level security;
