-- Whatsup: group controls + per-person receipts (WhatsApp-style ticks)
-- Additive migration. Run once in Supabase SQL Editor. Does not drop any data.

-- 1. New columns on chats
alter table public.chats add column if not exists avatar_url text;
alter table public.chats add column if not exists description text;
alter table public.chats add column if not exists only_admins_send boolean not null default false;

-- 2. Make sure the group creator is an admin (older groups may have role = 'member')
update public.chat_members cm
set role = 'admin'
from public.chats c
where c.id = cm.chat_id
  and c.is_group
  and cm.user_id = c.created_by
  and cm.role <> 'admin';

-- 3. Helper: is the current user an admin of this group?
create or replace function public.is_group_admin(p_chat_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
    where cm.chat_id = p_chat_id
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
      and c.is_group
  );
$$;

-- 4. Per-recipient receipts (each person gets their own delivered/read time)
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

alter table public.message_receipts enable row level security;

drop policy if exists "receipts read members" on public.message_receipts;
create policy "receipts read members" on public.message_receipts
for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_receipts.message_id
    and public.is_chat_member(m.chat_id)
));
-- No insert/update policies: receipts are written only by the functions below.

-- 5. Receipt functions
create or replace function public.mark_messages_delivered()
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.message_receipts (message_id, user_id, delivered_at)
  select m.id, auth.uid(), now()
  from public.messages m
  where m.sender_id <> auth.uid()
    and exists (select 1 from public.chat_members cm
                where cm.chat_id = m.chat_id and cm.user_id = auth.uid())
    and not exists (select 1 from public.message_receipts r
                    where r.message_id = m.id and r.user_id = auth.uid()
                      and r.delivered_at is not null)
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.message_receipts.delivered_at, excluded.delivered_at);
end;
$$;

create or replace function public.mark_messages_read(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if not public.is_chat_member(p_chat_id) then return; end if;
  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select m.id, auth.uid(), now(), now()
  from public.messages m
  where m.chat_id = p_chat_id
    and m.sender_id <> auth.uid()
    and not exists (select 1 from public.message_receipts r
                    where r.message_id = m.id and r.user_id = auth.uid()
                      and r.read_at is not null)
  on conflict (message_id, user_id) do update
    set read_at = coalesce(public.message_receipts.read_at, excluded.read_at),
        delivered_at = coalesce(public.message_receipts.delivered_at, excluded.delivered_at);
end;
$$;

-- 6. Group management functions (admins only)
create or replace function public.update_group_info(
  p_chat_id uuid, p_name text, p_description text, p_avatar_url text, p_only_admins_send boolean default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_group_admin(p_chat_id) then
    raise exception 'فقط مشرفو المجموعة يمكنهم تعديل بياناتها';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'اسم المجموعة مطلوب';
  end if;
  update public.chats
  set name = trim(p_name),
      description = p_description,
      avatar_url = p_avatar_url,
      only_admins_send = coalesce(p_only_admins_send, only_admins_send)
  where id = p_chat_id and is_group;
end;
$$;

create or replace function public.set_member_role(p_chat_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_group_admin(p_chat_id) then
    raise exception 'فقط مشرفو المجموعة يمكنهم تغيير الصلاحيات';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'invalid role';
  end if;
  if p_role <> 'admin' and exists (
    select 1 from public.chats where id = p_chat_id and created_by = p_user_id
  ) then
    raise exception 'لا يمكن تنزيل منشئ المجموعة';
  end if;
  update public.chat_members set role = p_role
  where chat_id = p_chat_id and user_id = p_user_id;
end;
$$;

create or replace function public.leave_group(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_was_admin boolean;
  v_next uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً'; end if;
  if not exists (select 1 from public.chats where id = p_chat_id and is_group) then
    raise exception 'هذه ليست مجموعة';
  end if;

  select cm.role = 'admin' into v_was_admin
  from public.chat_members cm
  where cm.chat_id = p_chat_id and cm.user_id = auth.uid();
  if not found then raise exception 'أنت لست عضوًا في هذه المجموعة'; end if;

  delete from public.chat_members
  where chat_id = p_chat_id and user_id = auth.uid();

  -- If the last admin left, promote the longest-standing member
  if v_was_admin and not exists (
    select 1 from public.chat_members where chat_id = p_chat_id and role = 'admin'
  ) then
    select cm.user_id into v_next
    from public.chat_members cm
    where cm.chat_id = p_chat_id
    order by cm.joined_at
    limit 1;
    if v_next is not null then
      update public.chat_members set role = 'admin'
      where chat_id = p_chat_id and user_id = v_next;
    end if;
  end if;
end;
$$;

-- 7. Only the function path can add members (remove the direct-insert policy)
drop policy if exists "Chat creators can add members" on public.chat_members;

-- 8. "Only admins can send" enforced at the database level
drop policy if exists "Chat members can send as themselves" on public.messages;
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_chat_member(chat_id)
  and (
    not exists (select 1 from public.chats c where c.id = messages.chat_id and c.only_admins_send)
    or public.is_group_admin(messages.chat_id)
  )
);

-- 9. Realtime for member/group changes and receipts
do $$
begin
  begin alter publication supabase_realtime add table public.chats;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_members;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.message_receipts;
  exception when duplicate_object then null; end;
end $$;

-- 10. Make the new functions callable only by logged-in users
revoke execute on function public.update_group_info(uuid, text, text, text, boolean) from anon, public;
revoke execute on function public.set_member_role(uuid, uuid, text) from anon, public;
revoke execute on function public.leave_group(uuid) from anon, public;
grant execute on function public.update_group_info(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
