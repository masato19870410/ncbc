-- prospects テーブル作成（営業リサーチ結果の保存先）
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  area text,
  summary text,
  hypothesis text,
  website_status text,
  website_url text,
  website_note text,
  contact jsonb,
  sources jsonb,
  source_preset text,
  created_at timestamptz not null default now()
);

alter table public.prospects enable row level security;

drop policy if exists "Allow public select" on public.prospects;
drop policy if exists "Allow public insert" on public.prospects;

create policy "Allow public select"
  on public.prospects
  for select
  to anon, authenticated
  using (true);

create policy "Allow public insert"
  on public.prospects
  for insert
  to anon, authenticated
  with check (true);
