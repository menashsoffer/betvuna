-- Supabase blocks UPDATE without WHERE (pg_safeupdate) for calls coming through the API.
-- settings has a single row (id = true), so target it explicitly.

create or replace function public.admin_reset_wall() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  delete from public.participants where is_simulated;
  update public.participants set joined_at = null, join_seq = null, updated_at = now() where join_seq is not null;
  update public.settings set wall_epoch = wall_epoch + 1, updated_at = now() where id;
end $$;

create or replace function public.admin_set_join_open(p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.settings set join_open = p_open, updated_at = now() where id;
end $$;
