-- 2026-11-17 final read-only audit found ax_proposal_mvp already present.
-- REVIEW ONLY: do not re-run 001 on an existing project.
-- Target: AX oancjcvjtpbipodewjki. No row changes, drops or bootstrap replacement.
-- Compare current definitions and save the prior function definitions privately before applying.
begin;
do $$ begin
 if to_regclass('public.ax_staff') is null or to_regclass('public.ax_generations') is null then
  raise exception 'Existing AX schema required; inspect the project before continuing';
 end if;
end $$;
create or replace function private.ax_valid_mapping(value jsonb)
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

create or replace function private.ax_validate_generation() returns trigger language plpgsql set search_path = '' as $$
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
commit;
