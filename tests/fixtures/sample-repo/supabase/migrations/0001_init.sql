-- Dépôt SQL d'exemple pour tester le scan RLS.
-- users / notes / documents : protégées (RLS + policy). secrets : orpheline (aucune RLS).

create table public.users (
  id uuid primary key,
  email text not null
);

create table public.notes (
  id uuid primary key,
  owner uuid not null,
  body text
);

create table public.documents (
  id uuid primary key,
  title text not null
);

create table public.secrets (
  id uuid primary key,
  value text not null
);

-- Piège : la ligne suivante est COMMENTÉE, elle ne doit PAS protéger `secrets`.
-- alter table public.secrets enable row level security;

alter table public.users enable row level security;
alter table public.notes enable row level security;
alter table public.documents enable row level security;

create policy "users can read self" on public.users
  for select using (auth.uid() = id);

create policy "notes owner can read" on public.notes
  for select using (auth.uid() = owner);

create policy "documents are readable" on public.documents
  for select using (true);
