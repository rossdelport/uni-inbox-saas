-- Snippets: saved reply blocks, inserted by picker or by typing ;shortcode in
-- the composer. Entirely user-owned rows; the API is the only writer.

create table if not exists uni_inbox.snippets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  shortcut text not null,
  name text not null,
  body_text text not null,
  body_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, shortcut)
);

alter table uni_inbox.snippets enable row level security;
create policy snippets_owner_select on uni_inbox.snippets
  for select using (auth.uid() = owner_id);
grant select on uni_inbox.snippets to authenticated;
