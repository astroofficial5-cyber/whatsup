-- Whatsup: profile pictures, media messages, wallpapers, reactions, edit/delete,
-- per-chat preferences and anti-spam limits.
-- Additive and idempotent: run once in the Supabase SQL Editor. Safe to re-run.
-- The app keeps working (with the new features disabled) until this has been run.

-- 1. Profile columns ---------------------------------------------------------
alter table public.profiles add column if not exists about text;
alter table public.profiles add column if not exists wallpaper text;        -- preset id or 'url:https://...'
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- 2. Message columns ---------------------------------------------------------
alter table public.messages add column if not exists type text default 'text';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_name text;
alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists media_size integer;
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_media_size_chk') then
    alter table public.messages
      add constraint messages_media_size_chk
      check (media_size is null or media_size <= 16777216);
  end if;
end $$;

-- 3. Anti-spam: at most 15 messages per 10 seconds per sender -----------------
create index if not exists messages_sender_created_idx on public.messages(sender_id, created_at desc);

create or replace function public.messages_rate_limit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (
    select count(*) from public.messages
    where sender_id = new.sender_id and created_at > now() - interval '10 seconds'
  ) >= 15 then
    raise exception 'You are sending messages too fast. Please slow down.';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit_trg on public.messages;
create trigger messages_rate_limit_trg
before insert on public.messages
for each row execute function public.messages_rate_limit();

-- 4. Edit / delete (for everyone) -------------------------------------------
create or replace function public.edit_message(p_message_id uuid, p_content text)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into v from public.messages where id = p_message_id;
  if not found or v.sender_id <> auth.uid() then
    raise exception 'You can only edit your own messages';
  end if;
  if v.deleted_at is not null then raise exception 'This message was deleted'; end if;
  if coalesce(v.type, 'text') <> 'text' then raise exception 'Only text messages can be edited'; end if;
  if v.created_at < now() - interval '15 minutes' then
    raise exception 'Messages can only be edited for 15 minutes';
  end if;
  if p_content is null or length(trim(p_content)) = 0 or length(p_content) > 10000 then
    raise exception 'Invalid message';
  end if;
  update public.messages
  set content = trim(p_content), edited_at = now()
  where id = p_message_id;
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into v from public.messages where id = p_message_id;
  if not found then raise exception 'Message not found'; end if;
  if v.sender_id <> auth.uid() and not exists (
    select 1 from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
    where cm.chat_id = v.chat_id and cm.user_id = auth.uid()
      and cm.role = 'admin' and c.is_group
  ) then
    raise exception 'You cannot delete this message';
  end if;
  update public.messages
  set deleted_at = now(),
      content = 'This message was deleted',
      media_path = null, media_name = null, media_mime = null, media_size = null,
      audio_path = null, audio_duration = null,
      reply_to = null
  where id = p_message_id;
end;
$$;

-- 5. Reactions (one emoji per person per message) ---------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions read members" on public.message_reactions;
create policy "reactions read members" on public.message_reactions
for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_reactions.message_id
    and public.is_chat_member(m.chat_id)
));
-- No insert/update/delete policies: reactions are written only by the function below.

create or replace function public.react_to_message(p_message_id uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_chat uuid; v_old text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select chat_id into v_chat from public.messages where id = p_message_id;
  if v_chat is null or not public.is_chat_member(v_chat) then
    raise exception 'Not allowed';
  end if;
  select emoji into v_old from public.message_reactions
  where message_id = p_message_id and user_id = auth.uid();
  if p_emoji is null or length(trim(p_emoji)) = 0 or v_old = p_emoji then
    delete from public.message_reactions
    where message_id = p_message_id and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (p_message_id, auth.uid(), left(trim(p_emoji), 16))
    on conflict (message_id, user_id)
    do update set emoji = excluded.emoji, created_at = now();
  end if;
end;
$$;

-- 6. Per-user chat preferences (pin / archive / mute / own wallpaper) -------
create table if not exists public.chat_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  pinned boolean not null default false,
  archived boolean not null default false,
  muted boolean not null default false,
  wallpaper text,
  primary key (user_id, chat_id)
);

alter table public.chat_prefs enable row level security;

drop policy if exists "chat_prefs own" on public.chat_prefs;
create policy "chat_prefs own" on public.chat_prefs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_chat_member(chat_id));

-- 7. Storage buckets with hard size + type limits ----------------------------
-- avatars: public (profile pictures and custom wallpapers), max 3 MB, images only
-- media:   private (signed URLs), max 16 MB, images / video / common documents
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 16777216,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Avatars: each user can write only inside their own folder (<user id>/...)
drop policy if exists "avatars own insert" on storage.objects;
create policy "avatars own insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects
for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete" on storage.objects
for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Media: files live in <chat id>/..., only members of that chat can read or upload
drop policy if exists "media members read" on storage.objects;
create policy "media members read" on storage.objects
for select to authenticated
using (bucket_id = 'media' and public.is_chat_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "media members upload" on storage.objects;
create policy "media members upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'media' and public.is_chat_member(((storage.foldername(name))[1])::uuid));

-- 8. Realtime -----------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.message_reactions;
  exception when duplicate_object then null; end;
end $$;

-- 9. Only logged-in users may call the new functions -------------------------
revoke execute on function public.edit_message(uuid, text) from anon, public;
revoke execute on function public.delete_message(uuid) from anon, public;
revoke execute on function public.react_to_message(uuid, text) from anon, public;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.react_to_message(uuid, text) to authenticated;

-- 10. Voice message columns + a hard size limit on the existing voice bucket ---
alter table public.messages add column if not exists audio_path text;
alter table public.messages add column if not exists audio_duration integer;
update storage.buckets set file_size_limit = 5242880 where id = 'voice';

-- 11. Chat-list helpers: last message per chat and persistent unread counts ----
create or replace function public.last_messages()
returns table (
  chat_id uuid, id uuid, sender_id uuid, content text, type text,
  created_at timestamptz, deleted_at timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select distinct on (m.chat_id)
    m.chat_id, m.id, m.sender_id, m.content, m.type, m.created_at, m.deleted_at
  from public.messages m
  where public.is_chat_member(m.chat_id)
  order by m.chat_id, m.created_at desc;
$$;

-- Unread = messages from others, newer than when I joined, from the last 30 days,
-- that I have no "read" receipt for.
create or replace function public.unread_counts()
returns table (chat_id uuid, unread bigint)
language sql stable security definer set search_path = public
as $$
  select m.chat_id, count(*)::bigint
  from public.messages m
  join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at >= cm.joined_at
    and m.created_at > now() - interval '30 days'
    and not exists (
      select 1 from public.message_receipts r
      where r.message_id = m.id and r.user_id = auth.uid() and r.read_at is not null
    )
  group by m.chat_id;
$$;

revoke execute on function public.last_messages() from anon, public;
revoke execute on function public.unread_counts() from anon, public;
grant execute on function public.last_messages() to authenticated;
grant execute on function public.unread_counts() to authenticated;

-- 12. Senders may delete their own uploaded files (used when they delete a message) --
drop policy if exists "media own delete" on storage.objects;
create policy "media own delete" on storage.objects
for delete to authenticated
using (bucket_id = 'media' and owner_id = (select auth.uid())::text);
