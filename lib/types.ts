export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  about?: string | null;
  wallpaper?: string | null;
  last_seen_at?: string | null;
};

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  type?: string | null; // text | voice | image | video | file
  audio_path?: string | null;
  audio_duration?: number | null;
  media_path?: string | null;
  media_name?: string | null;
  media_mime?: string | null;
  media_size?: number | null;
  reply_to?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
};

export type Chat = {
  id: string;
  title: string;
  subtitle: string;
  avatar: string;
  avatarUrl?: string | null;
  onlyAdminsSend?: boolean;
  time: string;
  unread: number;
  isGroup: boolean;
  updatedAt: string;
  otherId?: string | null; // the other person in a direct chat
  lastText: string;
  lastMine: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  wallpaper?: string | null; // per-chat override of the user's wallpaper
};

export type GroupMember = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
};

export type Person = {
  name: string;
  avatar: string | null;
  about: string | null;
  lastSeen: string | null;
};
