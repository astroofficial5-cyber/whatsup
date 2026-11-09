-- Run this file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid references public.chats(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at);

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

create policy "Profiles are visible to authenticated users"
on public.profiles for select to authenticated using (true);
create policy "Users can create their profile"
on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users can update their profile"
on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "Members can view their chats"
on public.chats for select to authenticated
using (public.is_chat_member(id));
create policy "Authenticated users can create chats"
on public.chats for insert to authenticated with check (created_by = auth.uid());

create or replace function public.is_chat_member(target_chat_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = target_chat_id and user_id = auth.uid()
  );
$$;

create policy "Members can view chat membership"
on public.chat_members for select to authenticated
using (public.is_chat_member(chat_id));
create policy "Chat creators can add members"
on public.chat_members for insert to authenticated
with check (exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()));

create policy "Chat members can read messages"
on public.messages for select to authenticated
using (public.is_chat_member(chat_id));
create policy "Chat members can send as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_chat_member(chat_id)
);

-- Create a profile automatically after sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Enable realtime updates for messages.
alter publication supabase_realtime add table public.messages;
