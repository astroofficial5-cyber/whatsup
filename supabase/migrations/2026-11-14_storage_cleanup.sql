-- Helpers for the automatic storage cleanup (called only by the server with the service role key).

create or replace function public.storage_usage_bytes()
returns bigint language sql stable security definer set search_path = public, storage
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id in ('media', 'voice', 'avatars');
$$;

create or replace function public.media_oldest(p_limit int default 500)
returns table (name text, size bigint, created_at timestamptz)
language sql stable security definer set search_path = public, storage
as $$
  select o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o
  where o.bucket_id = 'media'
  order by o.created_at asc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke execute on function public.storage_usage_bytes() from anon, authenticated, public;
revoke execute on function public.media_oldest(int) from anon, authenticated, public;
grant execute on function public.storage_usage_bytes() to service_role;
grant execute on function public.media_oldest(int) to service_role;
