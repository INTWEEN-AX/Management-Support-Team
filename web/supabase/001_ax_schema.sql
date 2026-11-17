-- AX 전용 빈 프로젝트용 초안. 기존 APFS 프로젝트에 적용하지 마세요.
-- 대상: oancjcvjtpbipodewjki / 적용 전 백업·콘솔 승인 필요.
-- 실제 원문/개인 연락처/자격증명/초기 관리자 이메일을 포함하지 않습니다.
begin;
create extension if not exists pgcrypto;
create schema if not exists private;

create function private.ax_safe_text(value text, max_length integer default 2000)
returns boolean language sql immutable set search_path = ''
as $$ select value is null or (length(value) <= max_length
 and value !~ '[[:cntrl:]]'
 and value !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
 and value !~ '(01[016789])[ -]?[0-9]{3,4}[ -]?[0-9]{4}'
 and value !~ '[0-9]{6}[[:space:]]*-[[:space:]]*[1-8][0-9]{6}'
 and value !~* 'https?://') $$;

create function private.ax_valid_report(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
 if jsonb_typeof(value) <> 'object' or (select count(*) from jsonb_object_keys(value)) <> 4 then return false; end if;
 foreach k in array array['filledCells','filledRows','overflowCount','unfilledCount'] loop
  v := value -> k;
  if v is null or jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' then return false; end if;
  if (v::text)::numeric > 100000 then return false; end if;
 end loop;
 return true;
end $$;

create function private.ax_valid_mapping(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; pair jsonb; k text; v jsonb; field text; allowed_fields text[];
begin
 if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 100 then return false; end if;
 for item in select jsonb_array_elements(value) loop
  if jsonb_typeof(item) <> 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(item) key where key not in ('tableId','kind','mode','headerRow','columns','pairs')) then return false; end if;
  if item->>'kind' not in ('staff','performance','unknown') or item->>'kind' is null then return false; end if;
  if coalesce(item->>'mode','repeat') not in ('repeat','pairs') then return false; end if;
  if jsonb_typeof(item->'tableId') <> 'string' or not private.ax_safe_text(item->>'tableId',200) then return false; end if;
  if item->'tableId' is null or item->'headerRow' is null or (item->>'headerRow') !~ '^[0-9]+$' or (item->>'headerRow')::numeric > 1000 then return false; end if;
  if item->>'kind' = 'staff' then
   allowed_fields := array['_index','name','department','position','education','educationSchool','educationMajor','educationDegree','educationGraduationYear','joinDate','employmentType','employmentTenure','careerYears','role'];
  else
   allowed_fields := array['_index','taskName','client','amount','period','startDate','endDate','description','year','share','field','evidenceVerified'];
  end if;
  if item ? 'columns' then
   if jsonb_typeof(item->'columns') <> 'object' then return false; end if;
   for k,v in select * from jsonb_each(item->'columns') loop
    if k !~ '^[0-9]{1,3}$' or jsonb_typeof(v) <> 'string' then return false; end if;
    field := v #>> '{}';
    if field <> '' and not (field = any(allowed_fields)) then return false; end if;
   end loop;
  end if;
  if item ? 'pairs' then
   if jsonb_typeof(item->'pairs') <> 'array' or jsonb_array_length(item->'pairs') > 1000 then return false; end if;
   for pair in select jsonb_array_elements(item->'pairs') loop
    if jsonb_typeof(pair) <> 'object' or exists(select 1 from jsonb_object_keys(pair) key where key not in ('row','column','targetRow','targetColumn','field')) then return false; end if;
    foreach k in array array['row','column','targetRow','targetColumn'] loop
     if pair->k is null or jsonb_typeof(pair->k) <> 'number' or pair->>k !~ '^[0-9]+$' or (pair->>k)::numeric > 1000 then return false; end if;
    end loop;
    if pair->>'field' is null or not (pair->>'field' = any(allowed_fields)) then return false; end if;
   end loop;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create table public.ax_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '업무 계정' check(private.ax_safe_text(display_name,100)),
 role text not null default 'viewer' check(role in ('admin','editor','viewer')),
 approved boolean not null default false, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ax_staff (
 id uuid primary key default gen_random_uuid(),
 department text check(private.ax_safe_text(department,500)), name text not null check(length(btrim(name))>0 and private.ax_safe_text(name,500)),
 position text check(private.ax_safe_text(position,500)), education_school text check(private.ax_safe_text(education_school,500)), education_major text check(private.ax_safe_text(education_major,500)), education_degree text check(private.ax_safe_text(education_degree,500)),
 graduation_year integer check(graduation_year between 1900 and 2200), joined_on date,
 employment_type text check(private.ax_safe_text(employment_type,500)), active boolean not null default true,
 career_years numeric check(career_years between 0 and 80), career_verified boolean not null default false,
 career_source text check(private.ax_safe_text(career_source,500)), source_ref text unique check(private.ax_safe_text(source_ref,500)),
 created_by uuid not null default auth.uid() references public.ax_profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint ax_staff_verified_career_check check(not career_verified or (career_years is not null and career_source is not null and length(btrim(career_source))>0))
);
create table public.ax_performances (
 id uuid primary key default gen_random_uuid(),
 task_name text not null check(length(btrim(task_name))>0 and private.ax_safe_text(task_name,500)), summary text check(private.ax_safe_text(summary,4000)),
 client text check(private.ax_safe_text(client,500)), year integer check(year between 1900 and 2200), amount numeric check(amount between 0 and 1e15),
 period text check(private.ax_safe_text(period,500)), field text check(private.ax_safe_text(field,500)), evidence_verified boolean not null default false,
 share numeric check(share between 0 and 100), source_ref text unique check(private.ax_safe_text(source_ref,500)),
 created_by uuid not null default auth.uid() references public.ax_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ax_participations (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.ax_staff(id) on delete restrict,
 performance_id uuid not null references public.ax_performances(id) on delete restrict,
 role text check(private.ax_safe_text(role,500)), verified boolean not null default false, source_ref text unique check(private.ax_safe_text(source_ref,500)),
 created_by uuid not null default auth.uid() references public.ax_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(staff_id,performance_id)
);
create table public.ax_bids (
 id uuid primary key default gen_random_uuid(), notice_number text check(private.ax_safe_text(notice_number,500)),
 title text not null check(length(btrim(title))>0 and private.ax_safe_text(title,500)), organization text check(private.ax_safe_text(organization,500)),
 deadline text check(private.ax_safe_text(deadline,500)), source_ref text unique check(private.ax_safe_text(source_ref,500)),
 created_by uuid not null default auth.uid() references public.ax_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ax_template_mappings (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name))>0 and private.ax_safe_text(name,500)),
 template_hash text not null check(template_hash ~ '^[a-f0-9]{64}$'), profile jsonb not null check(private.ax_valid_mapping(profile)),
 created_by uuid not null default auth.uid() references public.ax_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ax_generations (
 id uuid primary key default gen_random_uuid(), bid_id uuid references public.ax_bids(id) on delete restrict,
 template_hash text not null check(template_hash ~ '^[a-f0-9]{64}$'), staff_ids uuid[] not null default '{}', performance_ids uuid[] not null default '{}',
 mapping_id uuid references public.ax_template_mappings(id) on delete restrict, report jsonb not null check(private.ax_valid_report(report)),
 selection_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(selection_snapshot)='object'),
 created_by uuid not null default auth.uid() references public.ax_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(cardinality(staff_ids) <= 100 and cardinality(performance_ids) <= 100)
);
create table public.ax_audit_events (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
 entity_type text not null, entity_id uuid not null, action text not null check(action in ('INSERT','UPDATE','DELETE')),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'), created_at timestamptz not null default now()
);
create index ax_participations_staff_idx on public.ax_participations(staff_id);
create index ax_participations_performance_idx on public.ax_participations(performance_id);
create index ax_audit_created_idx on public.ax_audit_events(created_at desc);

create function private.ax_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.ax_profiles where id=auth.uid() and approved and active
$$;
create function private.ax_bootstrap_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.ax_profiles(id,display_name) values(new.id,case when private.ax_safe_text(new.raw_user_meta_data->>'display_name',100) and length(btrim(coalesce(new.raw_user_meta_data->>'display_name','')))>0 then new.raw_user_meta_data->>'display_name' else '업무 계정' end) on conflict(id) do nothing;
 return new;
end $$;
create function private.ax_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_OP='INSERT' then
  if new.created_by is distinct from auth.uid() then raise exception 'Invalid creator' using errcode='42501'; end if;
 else
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'Immutable identity' using errcode='42501'; end if;
 end if;
 new.updated_at:=now();
 return new;
end $$;
create function private.ax_profile_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Immutable identity' using errcode='42501'; end if;
 new.updated_at:=now(); return new;
end $$;
create function private.ax_validate_generation() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_OP <> 'INSERT' then raise exception 'Generation history is immutable' using errcode='42501'; end if;
 if (select count(distinct id) from unnest(new.staff_ids) as id) <> cardinality(new.staff_ids)
 or (select count(*) from public.ax_staff where id=any(new.staff_ids) and active) <> cardinality(new.staff_ids)
 or (select count(distinct id) from unnest(new.performance_ids) as id) <> cardinality(new.performance_ids)
 or (select count(*) from public.ax_performances where id=any(new.performance_ids)) <> cardinality(new.performance_ids) then
  raise exception 'Invalid selection' using errcode='23514';
 end if;
 if new.mapping_id is not null and not exists(select 1 from public.ax_template_mappings where id=new.mapping_id and template_hash=new.template_hash) then raise exception 'Invalid template mapping' using errcode='23514'; end if;
 -- Ignore any client-supplied snapshot. Only RLS-visible, selected DB facts become authoritative history.
 new.selection_snapshot := jsonb_build_object(
  'staff', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.ax_staff s where s.id=any(new.staff_ids)),
  'performances', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.ax_performances p where p.id=any(new.performance_ids))
 );
 return new;
end $$;
create function private.ax_keep_generation_sources() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_TABLE_NAME='ax_staff' and exists(select 1 from public.ax_generations where old.id=any(staff_ids)) then raise exception 'Referenced generation source' using errcode='23503'; end if;
 if TG_TABLE_NAME='ax_performances' and exists(select 1 from public.ax_generations where old.id=any(performance_ids)) then raise exception 'Referenced generation source' using errcode='23503'; end if;
 return old;
end $$;
create function private.ax_record_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare target_id uuid; meta jsonb := '{}'::jsonb;
begin
 target_id := case when TG_OP='DELETE' then old.id else new.id end;
 if TG_TABLE_NAME='ax_generations' and TG_OP='INSERT' then
  meta:=jsonb_build_object('staffCount',cardinality(new.staff_ids),'performanceCount',cardinality(new.performance_ids));
 end if;
 insert into public.ax_audit_events(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),TG_TABLE_NAME,target_id,TG_OP,meta);
 return case when TG_OP='DELETE' then old else new end;
end $$;

create trigger ax_auth_user_created after insert on auth.users for each row execute function private.ax_bootstrap_profile();
create trigger ax_profile_updated before update on public.ax_profiles for each row execute function private.ax_profile_stamp();
create trigger ax_generation_immutable before insert or update or delete on public.ax_generations for each row execute function private.ax_validate_generation();
create trigger ax_staff_source_guard before delete on public.ax_staff for each row execute function private.ax_keep_generation_sources();
create trigger ax_performance_source_guard before delete on public.ax_performances for each row execute function private.ax_keep_generation_sources();

do $$ declare t text; begin
 foreach t in array array['ax_staff','ax_performances','ax_participations','ax_bids','ax_template_mappings','ax_generations'] loop
  execute format('create trigger %I before insert or update on public.%I for each row execute function private.ax_stamp()',t||'_stamp',t);
 end loop;
 foreach t in array array['ax_profiles','ax_staff','ax_performances','ax_participations','ax_bids','ax_template_mappings','ax_generations'] loop
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.ax_record_audit()',t||'_audit',t);
 end loop;
end $$;

alter table public.ax_profiles enable row level security;
alter table public.ax_staff enable row level security;
alter table public.ax_performances enable row level security;
alter table public.ax_participations enable row level security;
alter table public.ax_bids enable row level security;
alter table public.ax_template_mappings enable row level security;
alter table public.ax_generations enable row level security;
alter table public.ax_audit_events enable row level security;

create policy ax_profiles_read on public.ax_profiles for select to authenticated using(id=auth.uid() or private.ax_role()='admin');
create policy ax_profiles_admin_update on public.ax_profiles for update to authenticated using(private.ax_role()='admin') with check(private.ax_role()='admin' and (id<>auth.uid() or (role='admin' and approved and active)));
do $$ declare t text; begin
 foreach t in array array['ax_staff','ax_performances','ax_participations','ax_bids','ax_template_mappings','ax_generations'] loop
  execute format('create policy %I on public.%I for select to authenticated using(private.ax_role() in (''admin'',''editor'',''viewer''))',t||'_read',t);
  execute format('create policy %I on public.%I for insert to authenticated with check(private.ax_role() in (''admin'',''editor'') and created_by=auth.uid())',t||'_insert',t);
  if t <> 'ax_generations' then
   execute format('create policy %I on public.%I for update to authenticated using(private.ax_role() in (''admin'',''editor'')) with check(private.ax_role() in (''admin'',''editor''))',t||'_update',t);
   execute format('create policy %I on public.%I for delete to authenticated using(private.ax_role() in (''admin'',''editor''))',t||'_delete',t);
  end if;
 end loop;
end $$;
create policy ax_audit_admin_read on public.ax_audit_events for select to authenticated using(private.ax_role()='admin');

revoke all on public.ax_profiles,public.ax_staff,public.ax_performances,public.ax_participations,public.ax_bids,public.ax_template_mappings,public.ax_generations,public.ax_audit_events from anon,authenticated;
grant select,update on public.ax_profiles to authenticated;
grant select,insert,update,delete on public.ax_staff,public.ax_performances,public.ax_participations,public.ax_bids,public.ax_template_mappings to authenticated;
grant select,insert on public.ax_generations to authenticated;
grant select on public.ax_audit_events to authenticated;
revoke all on function private.ax_safe_text(text,integer),private.ax_valid_report(jsonb),private.ax_valid_mapping(jsonb),private.ax_role(),private.ax_bootstrap_profile(),private.ax_stamp(),private.ax_profile_stamp(),private.ax_validate_generation(),private.ax_keep_generation_sources(),private.ax_record_audit() from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.ax_role() to authenticated;
grant execute on function private.ax_safe_text(text,integer),private.ax_valid_report(jsonb),private.ax_valid_mapping(jsonb) to authenticated;
commit;
