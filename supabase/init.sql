-- Reference copy of the migration applied to the Supabase project (d4-companion / fpavqjpkxtxwqojjqakl)
create table public.ticks (
  party text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (party, key)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  party text not null,
  session_date date not null,
  levels text,
  notes text,
  created_at timestamptz not null default now()
);
create index sessions_party_idx on public.sessions (party);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  party text not null,
  character text not null,
  item text not null,
  source text,
  note text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index targets_party_idx on public.targets (party);

alter table public.ticks enable row level security;
alter table public.sessions enable row level security;
alter table public.targets enable row level security;

create policy "anon select" on public.ticks for select to anon using (true);
create policy "anon insert" on public.ticks for insert to anon with check (true);
create policy "anon update" on public.ticks for update to anon using (true) with check (true);
create policy "anon delete" on public.ticks for delete to anon using (true);

create policy "anon select" on public.sessions for select to anon using (true);
create policy "anon insert" on public.sessions for insert to anon with check (true);
create policy "anon update" on public.sessions for update to anon using (true) with check (true);
create policy "anon delete" on public.sessions for delete to anon using (true);

create policy "anon select" on public.targets for select to anon using (true);
create policy "anon insert" on public.targets for insert to anon with check (true);
create policy "anon update" on public.targets for update to anon using (true) with check (true);
create policy "anon delete" on public.targets for delete to anon using (true);

alter publication supabase_realtime add table public.ticks, public.sessions, public.targets;
