create table public.baplie_containers (
  id bigint generated always as identity primary key,
  voyage_id bigint not null references public.voyages(id) on delete cascade,
  container_number text not null,
  size_type text,
  status text check (status in ('full', 'empty')),
  weight_kg numeric,
  pol text,
  pod text,
  final_dest text,
  bl_ref text,
  slot text,
  is_imo boolean not null default false,
  imo_class text,
  un_number text,
  is_oog boolean not null default false,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id)
);

create index baplie_containers_voyage_id_idx on public.baplie_containers(voyage_id);
create index baplie_containers_container_number_idx on public.baplie_containers(voyage_id, container_number);

alter table public.baplie_containers enable row level security;

create policy "Authenticated users can read baplie_containers"
  on public.baplie_containers for select
  to authenticated
  using (true);

create policy "Authenticated users can insert baplie_containers"
  on public.baplie_containers for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update baplie_containers"
  on public.baplie_containers for update
  to authenticated
  using (true);

create policy "Authenticated users can delete baplie_containers"
  on public.baplie_containers for delete
  to authenticated
  using (true);
