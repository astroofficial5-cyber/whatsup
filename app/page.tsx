"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Chat, GroupMember, Message, Person, Profile } from "@/lib/types";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import MediaBubble from "@/components/MediaBubble";
import {
  ACCEPT_FILES,
  ACCEPT_MEDIA,
  compressImage,
  describeFile,
  uploadPublicImage,
  validateMedia,
} from "@/lib/media";
import {
  WALLPAPERS,
  applyTheme,
  loadTheme,
  saveTheme,
  wallpaperStyle,
} from "@/lib/theme";
import type { ThemeMode } from "@/lib/theme";
import {
  Search, MessageSquarePlus, MoreVertical, Paperclip, Smile, Send,
  Check, CheckCheck, ArrowLeft, LogOut, Users, X, Mic, Trash2,
  Settings as SettingsIcon, Moon, Sun, Monitor, Camera, Image as ImageIcon,
  FileText, Download, Reply, Pencil, Copy, ChevronDown, Pin, PinOff,
  BellOff, Bell, Archive, Palette, Info, Plus
} from "lucide-react";

type ReactionMap = Record<string, Record<string, string>>;
type ReceiptMap = Record<string, Record<string, { delivered_at?: string | null; read_at?: string | null }>>;
type Filter = "all" | "unread" | "groups" | "archived";

const PAGE = 50;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_REC_SECS = 180;
const MAX_VOICE_BYTES = 5 * 1024 * 1024;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😋",
  "😎","🤩","🥳","😏","😒","😞","😔","😢","😭","😤","😡","🤯","😱","😴","🤔","🙄",
  "👍","👎","👏","🙌","🙏","💪","👌","✌️","🤝","👋","❤️","🧡","💛","💚","💙","💜",
  "🖤","💔","🔥","✨","🎉","🎂","🌹","⭐","💯","✅","❌","🎵","📞","📷","🍕","☕"
];

function ts(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();

  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

function clock(iso?: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

function lastSeenLabel(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return `last seen today at ${clock(iso)}`;
  if (d.toDateString() === yesterday.toDateString()) return `last seen yesterday at ${clock(iso)}`;
  return `last seen ${d.toLocaleDateString()}`;
}

function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function previewOf(m: { content?: string | null; type?: string | null; deleted_at?: string | null }): string {
  if (m.deleted_at) return "🚫 This message was deleted";
  if (m.type === "voice") return "🎤 Voice message";
  if (m.type === "image") return "📷 Photo";
  if (m.type === "video") return "🎥 Video";
  if (m.type === "file") return `📄 ${m.content || "File"}`;
  return m.content || "";
}

function friendlyError(err: any): string {
  const msg = String((err && err.message) || err || "Something went wrong.");

  if (/bucket not found/i.test(msg)) {
    return "Uploads aren't set up yet. Run the latest Supabase migration first.";
  }
  if (/maximum allowed size|payload too large|too large/i.test(msg)) {
    return "This file is too big.";
  }
  if (/mime type/i.test(msg)) return "This file type isn't allowed.";
  if (/row-level security/i.test(msg)) return "You don't have permission to do that.";
  if (/could not find the function|schema cache|does not exist/i.test(msg)) {
    return "This feature needs the latest database update (see supabase/migrations).";
  }
  return msg;
}

function sortChats(list: Chat[]): Chat[] {
  return [...list].sort(
    (a, b) => (Number(b.pinned) - Number(a.pinned)) || (ts(b.updatedAt) - ts(a.updatedAt))
  );
}

function Ticks({ status }: { status: "sent" | "delivered" | "read" }) {
  if (status === "read") return <CheckCheck size={15} color="#53bdeb" />;
  if (status === "delivered") return <CheckCheck size={15} color="#8696a0" />;
  return <Check size={15} color="#8696a0" />;
}

function WallpaperPicker({
  value,
  dark,
  busy,
  onPick,
  onUpload,
}: {
  value: string | null | undefined;
  dark: boolean;
  busy: boolean;
  onPick: (id: string) => void;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const current = value || "default";
  const isCustom = current.startsWith("url:");

  return (
    <div className="swatches">
      {WALLPAPERS.map(w => (
        <button
          key={w.id}
          type="button"
          className={`swatch ${current === w.id ? "on" : ""}`}
          style={wallpaperStyle(w.id, dark)}
          onClick={() => onPick(w.id)}
        >
          <span>{w.label}</span>
        </button>
      ))}

      <button
        type="button"
        className={`swatch ${isCustom ? "on" : ""}`}
        style={isCustom ? wallpaperStyle(current, dark) : undefined}
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        <span>{busy ? "Uploading…" : "My photo"}</span>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f);
        }}
      />
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);
  const [mobileChat, setMobileChat] = useState(false);

  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [dark, setDark] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group">("direct");
  const [userQuery, setUserQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [aboutDraft, setAboutDraft] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [wallBusy, setWallBusy] = useState(false);
  const [notifPerm, setNotifPerm] = useState<string>("default");
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [headMenu, setHeadMenu] = useState(false);
  const [showWallpaper, setShowWallpaper] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupRole, setGroupRole] = useState<"admin" | "member">("member");
  const [groupInfoName, setGroupInfoName] = useState("");
  const [groupInfoDescription, setGroupInfoDescription] = useState("");
  const [groupInfoAvatar, setGroupInfoAvatar] = useState("");
  const [groupAvatarBusy, setGroupAvatarBusy] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<Profile[]>([]);
  const [groupOnlyAdmins, setGroupOnlyAdmins] = useState(false);

  const [receipts, setReceipts] = useState<ReceiptMap>({});
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [chatMembers, setChatMembers] = useState<{ id: string; role: string }[]>([]);
  const [infoMsgId, setInfoMsgId] = useState<string | null>(null);

  const [menuMsgId, setMenuMsgId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);

  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typingMap, setTypingMap] = useState<Record<string, number>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const peopleRef = useRef<Record<string, Person>>({});
  const draftsRef = useRef<Record<string, string>>({});
  const presenceRef = useRef<any>(null);
  const lastTypingSentRef = useRef(0);
  const scrollModeRef = useRef<"bottom" | "older">("bottom");
  const prevHeightRef = useRef(0);
  const lastIdRef = useRef("");
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);
  const timerRef = useRef<any>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ---------- Theme ----------
  useEffect(() => {
    const m = loadTheme();
    setThemeMode(m);
    setDark(applyTheme(m));

    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
  }, []);

  useEffect(() => {
    if (themeMode !== "system" || typeof window.matchMedia !== "function") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(applyTheme("system"));

    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode]);

  function chooseTheme(m: ThemeMode) {
    saveTheme(m);
    setThemeMode(m);
    setDark(applyTheme(m));
  }

  // ---------- Auth ----------
  useEffect(() => {
    const sb: any = supabase;

    if (!sb) {
      setAuthReady(true);
      return;
    }

    sb.auth.getSession().then(({ data }: any) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    const { data: listener } = sb.auth.onAuthStateChange(
      (_e: any, session: any) => setUser(session?.user ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---------- People (names, photos, last seen) ----------
  async function fetchPeople(ids: string[], force = false): Promise<Record<string, Person>> {
    const sb: any = supabase;
    if (!sb) return peopleRef.current;

    const need = Array.from(new Set(ids)).filter(
      id => id && (force || !peopleRef.current[id])
    );
    if (!need.length) return peopleRef.current;

    const { data } = await sb.from("profiles").select("*").in("id", need);

    const out: Record<string, Person> = {};
    (data || []).forEach((p: any) => {
      out[p.id] = {
        name: p.full_name || p.username || "User",
        avatar: p.avatar_url || null,
        about: p.about || null,
        lastSeen: p.last_seen_at || null,
      };
    });

    peopleRef.current = { ...peopleRef.current, ...out };
    setPeople(peopleRef.current);
    return peopleRef.current;
  }

  function nameOf(id: string): string {
    return people[id]?.name || "";
  }

  // ---------- Receipts ----------
  function markDelivered() {
    const sb: any = supabase;
    if (!sb) return;
    sb.rpc("mark_messages_delivered").then(() => {}, () => {});
  }

  function markRead(chatId: string) {
    const sb: any = supabase;
    if (!sb) return;
    sb.rpc("mark_messages_read", { p_chat_id: chatId }).then(() => {}, () => {});
  }

  // ---------- Chats ----------
  async function loadChats(selectId?: string) {
    const sb: any = supabase;
    if (!sb || !user) return;

    const { data, error } = await sb
      .from("chat_members")
      .select("chat_id, chats(id, name, is_group, updated_at, avatar_url, only_admins_send)")
      .eq("user_id", user.id);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    const list: any[] = (data || []).map((r: any) => r.chats).filter(Boolean);
    const directIds: string[] = list.filter((c: any) => !c.is_group).map((c: any) => c.id as string);

    const otherByChat: Record<string, string> = {};

    if (directIds.length) {
      const { data: others } = await sb
        .from("chat_members")
        .select("chat_id, user_id")
        .in("chat_id", directIds)
        .neq("user_id", user.id);

      (others || []).forEach((o: any) => {
        otherByChat[o.chat_id] = o.user_id;
      });
    }

    const [prefsRes, lastRes, unreadRes, pm] = await Promise.all([
      sb.from("chat_prefs").select("chat_id, pinned, archived, muted, wallpaper").eq("user_id", user.id),
      sb.rpc("last_messages"),
      sb.rpc("unread_counts"),
      fetchPeople(Object.values(otherByChat), true),
    ]);

    const prefs: Record<string, any> = {};
    ((prefsRes && prefsRes.data) || []).forEach((p: any) => {
      prefs[p.chat_id] = p;
    });

    const lastBy: Record<string, any> = {};
    ((lastRes && lastRes.data) || []).forEach((l: any) => {
      lastBy[l.chat_id] = l;
    });

    let unreadBy: Record<string, number> | null = null;
    if (unreadRes && !unreadRes.error) {
      unreadBy = {};
      (unreadRes.data || []).forEach((u: any) => {
        if (unreadBy) unreadBy[u.chat_id] = Number(u.unread) || 0;
      });
    }

    const mapped: Chat[] = list.map((c: any) => {
      const otherId: string | null = c.is_group ? null : (otherByChat[c.id] || null);
      const person = otherId ? pm[otherId] : undefined;

      const title: string = c.is_group
        ? (c.name || "Group")
        : (person?.name || "Conversation");

      const prev = chatsRef.current.find(x => x.id === c.id);
      const pref = prefs[c.id] || {};
      const last = lastBy[c.id];

      const updatedAt: string =
        last && ts(last.created_at) > ts(c.updated_at)
          ? last.created_at
          : (c.updated_at || (last && last.created_at) || "");

      const unread = c.id === activeIdRef.current
        ? 0
        : unreadBy
          ? (unreadBy[c.id] || 0)
          : (prev?.unread || 0);

      return {
        id: c.id,
        title,
        isGroup: !!c.is_group,
        subtitle: c.is_group ? "Group" : "Direct message",
        avatar: (title[0] || "W").toUpperCase(),
        avatarUrl: c.is_group ? (c.avatar_url || null) : (person?.avatar || null),
        onlyAdminsSend: !!c.only_admins_send,
        time: formatTime(updatedAt),
        unread,
        updatedAt,
        otherId,
        lastText: last ? previewOf(last) : (prev?.lastText || ""),
        lastMine: last ? last.sender_id === user.id : (prev?.lastMine || false),
        pinned: !!pref.pinned,
        archived: !!pref.archived,
        muted: !!pref.muted,
        wallpaper: pref.wallpaper || null,
      } as Chat;
    });

    const sorted = sortChats(mapped);
    setChats(sorted);

    if (selectId) {
      setActiveId(selectId);
      setMobileChat(true);
    } else if (!activeIdRef.current && sorted.length) {
      const first = sorted.find(c => !c.archived) || sorted[0];
      setActiveId(first.id);
    }
  }

  async function setPref(
    chatId: string,
    patch: Partial<{ pinned: boolean; archived: boolean; muted: boolean; wallpaper: string | null }>
  ) {
    const sb: any = supabase;
    if (!sb || !user) return;

    setChats(prev => sortChats(prev.map(c => (c.id === chatId ? { ...c, ...patch } : c))));

    const { error } = await sb
      .from("chat_prefs")
      .upsert({ user_id: user.id, chat_id: chatId, ...patch }, { onConflict: "user_id,chat_id" });

    if (error) {
      setNotice(friendlyError(error));
      loadChats();
    }
  }

  async function loadGroupMembers(chatId: string) {
    const sb: any = supabase;
    if (!sb) return;

    const { data: memberRows, error } = await sb
      .from("chat_members")
      .select("user_id, role")
      .eq("chat_id", chatId);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    const ids = (memberRows || []).map((m: any) => m.user_id);

    if (!ids.length) {
      setGroupMembers([]);
      setGroupRole("member");
      return;
    }

    const { data: profiles, error: profileError } = await sb
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", ids);

    if (profileError) {
      setNotice(friendlyError(profileError));
      return;
    }

    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

    const members: GroupMember[] = (memberRows || []).map((m: any) => {
      const p: any = profileById.get(m.user_id);

      return {
        id: m.user_id,
        full_name: p?.full_name || null,
        username: p?.username || null,
        avatar_url: p?.avatar_url || null,
        role: m.role === "admin" ? "admin" : "member",
      };
    });

    setGroupMembers(members);

    const currentUser = members.find(m => m.id === user?.id);
    setGroupRole(currentUser?.role || "member");
  }

  async function openGroupInfo() {
    if (!activeId || !active?.isGroup) return;

    const sb: any = supabase;
    if (!sb) return;

    const { data, error } = await sb
      .from("chats")
      .select("name, description, avatar_url, only_admins_send")
      .eq("id", activeId)
      .single();

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setGroupInfoName(data?.name || "");
    setGroupInfoDescription(data?.description || "");
    setGroupInfoAvatar(data?.avatar_url || "");
    setGroupOnlyAdmins(!!data?.only_admins_send);
    setMemberSearch("");
    setMemberSearchResults([]);

    await loadGroupMembers(activeId);
    setGroupInfoOpen(true);
  }

  async function saveGroupInfo() {
    const sb: any = supabase;
    if (!sb || !activeId) return;

    const { error } = await sb.rpc("update_group_info", {
      p_chat_id: activeId,
      p_name: groupInfoName.trim(),
      p_description: groupInfoDescription.trim(),
      p_avatar_url: groupInfoAvatar.trim(),
      p_only_admins_send: groupOnlyAdmins,
    });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    await loadChats(activeId);
    await loadGroupMembers(activeId);
    setGroupInfoOpen(false);
  }

  async function uploadGroupAvatar(file: File) {
    const sb: any = supabase;
    if (!sb || !user || !activeId) return;

    setGroupAvatarBusy(true);
    try {
      const url = await uploadPublicImage(sb, `${user.id}/group-${activeId}.jpg`, file, 512);
      setGroupInfoAvatar(url);
    } catch (err: any) {
      setNotice(friendlyError(err));
    } finally {
      setGroupAvatarBusy(false);
    }
  }

  async function addMemberToGroup(memberId: string) {
    const sb: any = supabase;
    if (!sb || !activeId) return;

    const { error } = await sb.rpc("add_group_member", {
      p_chat_id: activeId,
      p_user_id: memberId,
    });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setMemberSearch("");
    setMemberSearchResults([]);
    await loadGroupMembers(activeId);
    await loadChats(activeId);
  }

  async function removeMemberFromGroup(memberId: string) {
    const sb: any = supabase;
    if (!sb || !activeId) return;

    const { error } = await sb.rpc("remove_group_member", {
      p_chat_id: activeId,
      p_user_id: memberId,
    });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    await loadGroupMembers(activeId);
    await loadChats(activeId);
  }

  async function loadChatMembers(chatId: string) {
    const sb: any = supabase;
    if (!sb) return;

    const { data: mem } = await sb
      .from("chat_members")
      .select("user_id, role")
      .eq("chat_id", chatId);

    const list: { id: string; role: string }[] = (mem || []).map(
      (m: any) => ({ id: m.user_id as string, role: m.role as string })
    );

    setChatMembers(list);
    fetchPeople(list.map(m => m.id));
  }

  // Receipts for my messages in the loaded page.
  async function loadReceipts(rows: Message[]) {
    const sb: any = supabase;
    if (!sb || !user) return;

    const mine = rows
      .filter(r => r.sender_id === user.id)
      .slice(-200)
      .map(r => r.id);
    if (!mine.length) return;

    const { data: rec } = await sb
      .from("message_receipts")
      .select("message_id, user_id, delivered_at, read_at")
      .in("message_id", mine);

    const map: ReceiptMap = {};
    (rec || []).forEach((r: any) => {
      if (!map[r.message_id]) map[r.message_id] = {};
      map[r.message_id][r.user_id] = { delivered_at: r.delivered_at, read_at: r.read_at };
    });
    setReceipts(prev => ({ ...prev, ...map }));
  }

  async function loadReactions(rows: Message[]) {
    const sb: any = supabase;
    if (!sb || !rows.length) return;

    const { data, error } = await sb
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .in("message_id", rows.map(r => r.id));

    if (error || !data) return; // reactions need the latest migration; ignore until then

    const map: ReactionMap = {};
    (data as any[]).forEach((r: any) => {
      if (!map[r.message_id]) map[r.message_id] = {};
      map[r.message_id][r.user_id] = r.emoji;
    });
    setReactions(prev => ({ ...prev, ...map }));
  }

  // Status of one of my messages: read by everyone, delivered to everyone, or just sent.
  function statusFor(m: Message): "sent" | "delivered" | "read" {
    const others = chatMembers.filter(x => x.id !== user?.id).map(x => x.id);
    if (!others.length) return "sent";
    const rec = receipts[m.id] || {};
    if (others.every(id => rec[id]?.read_at)) return "read";
    if (others.every(id => rec[id]?.delivered_at || rec[id]?.read_at)) return "delivered";
    return "sent";
  }

  async function setMemberRole(memberId: string, role: "admin" | "member") {
    const sb: any = supabase;
    if (!sb || !activeId) return;

    const { error } = await sb.rpc("set_member_role", {
      p_chat_id: activeId,
      p_user_id: memberId,
      p_role: role,
    });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    await loadGroupMembers(activeId);
    await loadChatMembers(activeId);
  }

  async function leaveCurrentGroup() {
    const sb: any = supabase;
    if (!sb || !activeId) return;

    const { error } = await sb.rpc("leave_group", { p_chat_id: activeId });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setGroupInfoOpen(false);
    setActiveId(null);
    setMobileChat(false);
    setMessages([]);
    setGroupMembers([]);
    await loadChats();
  }

  // Search for people to add to the open group.
  useEffect(() => {
    const sb: any = supabase;

    if (
      !sb ||
      !user ||
      !groupInfoOpen ||
      !activeId ||
      !memberSearch.trim() ||
      groupRole !== "admin"
    ) {
      setMemberSearchResults([]);
      return;
    }

    const q = memberSearch.replace(/[,()%*]/g, "").trim();
    let alive = true;

    sb.from("profiles")
      .select("id, username, full_name, avatar_url")
      .neq("id", user.id)
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(20)
      .then(({ data }: any) => {
        if (!alive) return;

        const existingIds = new Set(groupMembers.map(m => m.id));
        setMemberSearchResults(
          ((data || []) as Profile[]).filter(p => !existingIds.has(p.id))
        );
      });

    return () => {
      alive = false;
    };
  }, [groupInfoOpen, activeId, memberSearch, groupRole, groupMembers, user]);

  // ---------- Profile and chats after login ----------
  useEffect(() => {
    const sb: any = supabase;

    if (!sb || !user) {
      setChats([]);
      setActiveId(null);
      setMessages([]);
      return;
    }

    sb.from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data }: any) => {
        if (data) {
          setProfile(data as Profile);
          peopleRef.current = {
            ...peopleRef.current,
            [user.id]: {
              name: data.full_name || data.username || "You",
              avatar: data.avatar_url || null,
              about: data.about || null,
              lastSeen: data.last_seen_at || null,
            },
          };
          setPeople(peopleRef.current);
        }
      });

    loadChats();
    markDelivered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---------- "Last seen" heartbeat ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user) return;

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      sb.from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id)
        .then(() => {}, () => {});
    };

    ping();
    const t = setInterval(ping, 120000);
    document.addEventListener("visibilitychange", ping);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [user]);

  // ---------- Online presence + typing indicator ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user) return;

    const ch = sb.channel("presence-all", { config: { presence: { key: user.id } } });

    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      setOnline(new Set(Object.keys(st)));
    })
      .on("broadcast", { event: "typing" }, (msg: any) => {
        const p = msg && msg.payload;
        if (!p || p.user_id === user.id) return;
        setTypingMap(prev => ({ ...prev, [`${p.chat_id}:${p.user_id}`]: Date.now() }));
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") ch.track({ at: Date.now() });
      });

    presenceRef.current = ch;

    return () => {
      presenceRef.current = null;
      sb.removeChannel(ch);
    };
  }, [user]);

  useEffect(() => {
    const t = setInterval(() => {
      setTypingMap(prev => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, number> = {};

        Object.keys(prev).forEach(k => {
          if (now - prev[k] < 5000) next[k] = prev[k];
          else changed = true;
        });

        return changed ? next : prev;
      });
    }, 1500);

    return () => clearInterval(t);
  }, []);

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;

    const chatId = activeIdRef.current;
    if (!chatId || !user || !presenceRef.current) return;

    presenceRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { chat_id: chatId, user_id: user.id },
    });
  }

  function typingIn(chatId: string): string[] {
    return Object.keys(typingMap)
      .filter(k => k.startsWith(`${chatId}:`))
      .map(k => k.slice(chatId.length + 1));
  }

  // ---------- Realtime messages ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user) return;

    const channel = sb.channel("messages-all")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const m = payload.new as Message;
          const mine = m.sender_id === user.id;

          if (m.chat_id === activeIdRef.current) {
            setMessages(prev =>
              prev.some(x => x.id === m.id) ? prev : [...prev, m]
            );
            fetchPeople([m.sender_id]);
            if (!mine) markRead(m.chat_id);
          } else if (!chatsRef.current.some(c => c.id === m.chat_id)) {
            if (!mine) markDelivered();
            loadChats();
            return;
          } else if (!mine) {
            markDelivered();
            setChats(prev => prev.map(c =>
              c.id === m.chat_id ? { ...c, unread: c.unread + 1 } : c
            ));
          }

          if (
            !mine &&
            typeof document !== "undefined" &&
            document.hidden &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            const chat = chatsRef.current.find(c => c.id === m.chat_id);
            if (!chat?.muted) {
              try {
                new Notification(chat?.title || "Whatsup", { body: previewOf(m) });
              } catch {
                // some browsers only allow notifications from a service worker
              }
            }
          }

          setChats(prev => sortChats(prev.map(c =>
            c.id === m.chat_id
              ? {
                  ...c,
                  updatedAt: m.created_at,
                  time: formatTime(m.created_at),
                  lastText: previewOf(m),
                  lastMine: mine,
                }
              : c
          )));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload: any) => {
          const m = payload.new as Message;

          setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, ...m } : x)));

          if (m.deleted_at) {
            setChats(prev => prev.map(c =>
              c.id === m.chat_id && ts(c.updatedAt) === ts(m.created_at)
                ? { ...c, lastText: previewOf(m) }
                : c
            ));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_receipts" },
        (payload: any) => {
          const r = payload.new as any;
          if (!r?.message_id) return;
          setReceipts(prev => ({
            ...prev,
            [r.message_id]: {
              ...(prev[r.message_id] || {}),
              [r.user_id]: { delivered_at: r.delivered_at, read_at: r.read_at },
            },
          }));
        }
      )
      .subscribe();

    // Reactions live on their own channel so a missing table can never break messages.
    const reactionChannel = sb.channel("reactions-all")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        (payload: any) => {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          if (!row || !row.message_id) return;

          setReactions(prev => {
            const cur = { ...(prev[row.message_id] || {}) };
            if (payload.eventType === "DELETE") delete cur[row.user_id];
            else cur[row.user_id] = row.emoji;
            return { ...prev, [row.message_id]: cur };
          });
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
      sb.removeChannel(reactionChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---------- Load active conversation history ----------
  useEffect(() => {
    const sb: any = supabase;

    if (!sb || !user || !activeId) {
      setMessages([]);
      return;
    }

    let alive = true;

    setMessages([]);
    setChatMembers([]);
    setHasMore(false);
    setReplyTo(null);
    setEditing(null);
    setMenuMsgId(null);
    setShowAttach(false);
    setHeadMenu(false);
    setDraft(draftsRef.current[activeId] || "");
    scrollModeRef.current = "bottom";
    lastIdRef.current = "";

    (async () => {
      const { data, error } = await sb
        .from("messages")
        .select("*")
        .eq("chat_id", activeId)
        .order("created_at", { ascending: false })
        .limit(PAGE);

      if (!alive) return;

      if (error) {
        setNotice(friendlyError(error));
        return;
      }

      const rows = ((data || []) as Message[]).slice().reverse();

      setMessages(prev => {
        const ids = new Set(rows.map(r => r.id));
        return [...rows, ...prev.filter(p => !ids.has(p.id))];
      });
      setHasMore(rows.length === PAGE);

      fetchPeople(rows.map(r => r.sender_id));
      loadChatMembers(activeId);
      loadReceipts(rows);
      loadReactions(rows);
    })();

    const chat = chatsRef.current.find(c => c.id === activeId);
    if (chat?.otherId) fetchPeople([chat.otherId], true);

    setChats(prev => prev.map(c =>
      c.id === activeId ? { ...c, unread: 0 } : c
    ));

    markRead(activeId);

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, user]);

  async function loadOlder() {
    const sb: any = supabase;
    if (!sb || !activeId || loadingOlder || !messages.length) return;

    setLoadingOlder(true);

    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("chat_id", activeId)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);

    setLoadingOlder(false);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    const rows = ((data || []) as Message[]).slice().reverse();
    const area = areaRef.current;

    prevHeightRef.current = area ? area.scrollHeight : 0;
    scrollModeRef.current = "older";

    setMessages(prev => {
      const ids = new Set(prev.map(p => p.id));
      return [...rows.filter(r => !ids.has(r.id)), ...prev];
    });
    setHasMore(rows.length === PAGE);

    fetchPeople(rows.map(r => r.sender_id));
    loadReceipts(rows);
    loadReactions(rows);
  }

  // Keep the view pinned to the newest message, but never yank it while reading old ones.
  useEffect(() => {
    const area = areaRef.current;

    if (scrollModeRef.current === "older") {
      if (area) area.scrollTop = area.scrollHeight - prevHeightRef.current;
      scrollModeRef.current = "bottom";
      return;
    }

    const last = messages.length ? messages[messages.length - 1].id : "";

    if (last && last !== lastIdRef.current) {
      const first = lastIdRef.current === "";
      lastIdRef.current = last;
      bottomRef.current?.scrollIntoView({ behavior: first ? "auto" : "smooth" });
    }
  }, [messages]);

  // ---------- Tab title with unread count ----------
  useEffect(() => {
    const total = chats.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
    document.title = total > 0 ? `(${total}) Whatsup` : "Whatsup — Chat simply";
  }, [chats]);

  // ---------- User search for new chats ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user || !showNew) return;

    const q = userQuery.replace(/[,()%*]/g, "").trim();
    let alive = true;

    let req: any = sb
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .neq("id", user.id);

    if (q) {
      req = req.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);
    }

    req.limit(20).then(({ data }: any) => {
      if (alive) setResults((data as Profile[]) || []);
    });

    return () => {
      alive = false;
    };
  }, [showNew, userQuery, user]);

  function closeNew() {
    setShowNew(false);
    setNewMode("direct");
    setUserQuery("");
    setResults([]);
    setGroupName("");
    setPicked([]);
  }

  async function startDirect(otherId: string) {
    const sb: any = supabase;
    if (!sb) return;

    const { data, error } = await sb.rpc("create_direct_chat", { other_user: otherId });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    closeNew();
    await loadChats(data as string);
  }

  async function createGroup() {
    const sb: any = supabase;
    if (!sb) return;

    if (!groupName.trim()) {
      setNotice("Please enter a group name.");
      return;
    }

    const { data, error } = await sb.rpc("create_group_chat", {
      group_name: groupName.trim(),
      member_ids: picked,
    });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    closeNew();
    await loadChats(data as string);
  }

  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");

    const sb: any = supabase;

    if (!sb) {
      setNotice("Supabase is not configured.");
      return;
    }

    const result: any = authMode === "signup"
      ? await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
      : await sb.auth.signInWithPassword({ email, password });

    if (result.error) {
      setNotice(result.error.message);
    } else if (authMode === "signup" && !result.data?.session) {
      setNotice("تم إنشاء الحساب. افحص بريدك لتأكيده ثم سجّل الدخول.");
    }
  }

  // ---------- Sending ----------
  function appendMessage(m: Message) {
    setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
  }

  function updateDraft(value: string) {
    setDraft(value);
    if (activeIdRef.current) draftsRef.current[activeIdRef.current] = value;
    if (value.trim()) sendTyping();
  }

  function clearDraft() {
    setDraft("");
    if (activeIdRef.current) draftsRef.current[activeIdRef.current] = "";
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();

    const sb: any = supabase;
    const content = draft.trim();

    if (!sb || !user || !activeId || !content) return;

    setNotice("");
    setShowEmoji(false);

    if (editing) {
      const target = editing;
      const { error } = await sb.rpc("edit_message", {
        p_message_id: target.id,
        p_content: content,
      });

      if (error) {
        setNotice(friendlyError(error));
        return;
      }

      setMessages(prev => prev.map(x =>
        x.id === target.id ? { ...x, content, edited_at: new Date().toISOString() } : x
      ));
      setEditing(null);
      clearDraft();
      return;
    }

    const row: any = { chat_id: activeId, sender_id: user.id, content };
    if (replyTo) row.reply_to = replyTo.id;

    const pendingReply = replyTo;
    clearDraft();
    setReplyTo(null);

    const { data, error } = await sb.from("messages").insert(row).select().single();

    if (error) {
      setNotice(friendlyError(error));
      setDraft(content);
      setReplyTo(pendingReply);
      return;
    }

    if (data) appendMessage(data as Message);
  }

  async function sendMedia(file: File) {
    const sb: any = supabase;
    const chatId = activeIdRef.current;

    if (!sb || !user || !chatId) return;

    if (uploading) {
      setNotice("Please wait for the current upload to finish.");
      return;
    }

    const problem = validateMedia(file);
    if (problem) {
      setNotice(problem);
      return;
    }

    const info = describeFile(file);
    if (!info) return;

    setUploading(true);
    setNotice("");
    setShowAttach(false);

    try {
      let blob: Blob = file;
      let mime = info.mime;
      let ext = info.ext;

      // Photos are shrunk before upload, which keeps storage small and uploads fast.
      if (info.kind === "image" && info.mime !== "image/gif") {
        const out = await compressImage(file, 1600, 0.82);
        blob = out.blob;
        mime = out.mime;
        ext = out.ext;
      }

      const path = `${chatId}/${crypto.randomUUID()}.${ext}`;

      const up = await sb.storage
        .from("media")
        .upload(path, blob, { contentType: mime, cacheControl: "3600" });

      if (up.error) throw up.error;

      const name = file.name.slice(0, 200);
      const row: any = {
        chat_id: chatId,
        sender_id: user.id,
        content: name,
        type: info.kind,
        media_path: path,
        media_name: name,
        media_mime: mime,
        media_size: blob.size,
      };
      if (replyTo) row.reply_to = replyTo.id;

      const { data, error } = await sb.from("messages").insert(row).select().single();

      if (error) {
        await sb.storage.from("media").remove([path]);
        throw error;
      }

      setReplyTo(null);
      if (data) appendMessage(data as Message);
    } catch (err: any) {
      setNotice(friendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) sendMedia(f);
  }

  // ---------- Voice messages ----------
  async function sendVoice(blob: Blob, duration: number) {
    const sb: any = supabase;
    const chatId = activeIdRef.current;

    if (!sb || !user || !chatId) return;

    if (blob.size > MAX_VOICE_BYTES) {
      setNotice("This voice message is too long to send.");
      return;
    }

    const ext = blob.type.includes("mp4")
      ? "m4a"
      : blob.type.includes("ogg")
        ? "ogg"
        : "webm";

    const path = `${chatId}/${crypto.randomUUID()}.${ext}`;

    const up = await sb.storage
      .from("voice")
      .upload(path, blob, { contentType: blob.type });

    if (up.error) {
      setNotice(friendlyError(up.error));
      return;
    }

    const row: any = {
      chat_id: chatId,
      sender_id: user.id,
      content: "🎤 Voice message",
      type: "voice",
      audio_path: path,
      audio_duration: duration,
    };
    if (replyTo) row.reply_to = replyTo.id;

    const { data, error } = await sb.from("messages").insert(row).select().single();

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setReplyTo(null);
    if (data) appendMessage(data as Message);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Voice recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);

      chunksRef.current = [];
      cancelRef.current = false;

      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        setRecording(false);
        setRecSecs(0);

        if (cancelRef.current) return;

        const type = (mr.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type });
        const duration = Math.max(
          1,
          Math.round((Date.now() - recStartRef.current) / 1000)
        );

        await sendVoice(blob, duration);
      };

      mr.start();
      mrRef.current = mr;
      recStartRef.current = Date.now();

      setShowEmoji(false);
      setShowAttach(false);
      setRecording(true);
      setRecSecs(0);

      timerRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - recStartRef.current) / 1000);
        setRecSecs(secs);
        if (secs >= MAX_REC_SECS) stopRecording(true);
      }, 500);
    } catch {
      setNotice("Microphone access was denied. Allow it in your browser settings.");
    }
  }

  function stopRecording(send: boolean) {
    cancelRef.current = !send;

    if (mrRef.current && mrRef.current.state !== "inactive") {
      mrRef.current.stop();
    }
  }

  // ---------- Message actions ----------
  async function reactTo(m: Message, emoji: string) {
    const sb: any = supabase;
    if (!sb || !user) return;

    setMenuMsgId(null);

    const mine = reactions[m.id]?.[user.id];

    setReactions(prev => {
      const cur = { ...(prev[m.id] || {}) };
      if (mine === emoji) delete cur[user.id];
      else cur[user.id] = emoji;
      return { ...prev, [m.id]: cur };
    });

    const { error } = await sb.rpc("react_to_message", {
      p_message_id: m.id,
      p_emoji: emoji,
    });

    if (error) {
      setNotice(friendlyError(error));
      setReactions(prev => {
        const cur = { ...(prev[m.id] || {}) };
        if (mine) cur[user.id] = mine;
        else delete cur[user.id];
        return { ...prev, [m.id]: cur };
      });
    }
  }

  async function deleteMessage(m: Message) {
    const sb: any = supabase;
    if (!sb || !user) return;

    setMenuMsgId(null);

    if (!window.confirm("Delete this message for everyone?")) return;

    const path = m.media_path;
    const mineMsg = m.sender_id === user.id;

    const { error } = await sb.rpc("delete_message", { p_message_id: m.id });

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    // Free the storage space too (only the sender is allowed to remove their own upload).
    if (path && mineMsg) {
      sb.storage.from("media").remove([path]).then(() => {}, () => {});
    }

    const now = new Date().toISOString();
    setMessages(prev => prev.map(x =>
      x.id === m.id
        ? {
            ...x,
            deleted_at: now,
            content: "This message was deleted",
            media_path: null,
            audio_path: null,
            reply_to: null,
          }
        : x
    ));
  }

  async function copyMessage(m: Message) {
    setMenuMsgId(null);
    try {
      await navigator.clipboard.writeText(m.content);
    } catch {
      setNotice("Couldn't copy. Your browser blocked clipboard access.");
    }
  }

  function startReply(m: Message) {
    setMenuMsgId(null);
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  }

  function startEdit(m: Message) {
    setMenuMsgId(null);
    setReplyTo(null);
    setEditing(m);
    updateDraft(m.content);
    inputRef.current?.focus();
  }

  function cancelEdit() {
    setEditing(null);
    clearDraft();
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1300);
  }

  // ---------- Emoji ----------
  function addEmoji(emoji: string) {
    const el = inputRef.current;

    if (el && el.selectionStart != null) {
      const s = el.selectionStart;
      const e = el.selectionEnd ?? s;
      const next = draft.slice(0, s) + emoji + draft.slice(e);

      updateDraft(next);

      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(s + emoji.length, s + emoji.length);
      });
    } else {
      updateDraft(draft + emoji);
    }
  }

  // ---------- Profile settings ----------
  function openSettings() {
    setNameDraft(profile?.full_name || "");
    setAboutDraft(profile?.about || "");
    setShowSettings(true);
  }

  function rememberSelf(patch: Partial<Person>) {
    if (!user) return;
    const cur = peopleRef.current[user.id] || { name: "You", avatar: null, about: null, lastSeen: null };
    peopleRef.current = { ...peopleRef.current, [user.id]: { ...cur, ...patch } };
    setPeople(peopleRef.current);
  }

  async function saveSettings() {
    const sb: any = supabase;
    const name = nameDraft.trim();
    const about = aboutDraft.trim();

    if (!sb || !user) return;

    if (!name) {
      setNotice("Name can't be empty.");
      return;
    }

    const { error } = await sb
      .from("profiles")
      .update({ full_name: name })
      .eq("id", user.id);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setProfile(p => (p ? { ...p, full_name: name } : p));
    rememberSelf({ name });

    if (about !== (profile?.about || "")) {
      const res = await sb.from("profiles").update({ about }).eq("id", user.id);

      if (res.error) {
        setNotice(friendlyError(res.error));
        return;
      }

      setProfile(p => (p ? { ...p, about } : p));
      rememberSelf({ about: about || null });
    }

    setShowSettings(false);
  }

  async function uploadAvatar(file: File) {
    const sb: any = supabase;
    if (!sb || !user) return;

    setAvatarBusy(true);
    try {
      const url = await uploadPublicImage(sb, `${user.id}/avatar.jpg`, file, 512);
      const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      if (error) throw error;

      setProfile(p => (p ? { ...p, avatar_url: url } : p));
      rememberSelf({ avatar: url });
    } catch (err: any) {
      setNotice(friendlyError(err));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    const sb: any = supabase;
    if (!sb || !user) return;

    const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", user.id);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setProfile(p => (p ? { ...p, avatar_url: null } : p));
    rememberSelf({ avatar: null });
  }

  async function saveGlobalWallpaper(value: string) {
    const sb: any = supabase;
    if (!sb || !user) return;

    const { error } = await sb.from("profiles").update({ wallpaper: value }).eq("id", user.id);

    if (error) {
      setNotice(friendlyError(error));
      return;
    }

    setProfile(p => (p ? { ...p, wallpaper: value } : p));
  }

  async function uploadWallpaper(file: File, scope: "global" | "chat") {
    const sb: any = supabase;
    if (!sb || !user) return;

    setWallBusy(true);
    try {
      const chatId = activeIdRef.current;
      const path =
        scope === "chat" && chatId
          ? `${user.id}/wallpaper-${chatId}.jpg`
          : `${user.id}/wallpaper.jpg`;

      const url = await uploadPublicImage(sb, path, file, 1600);
      const value = `url:${url}`;

      if (scope === "chat" && chatId) await setPref(chatId, { wallpaper: value });
      else await saveGlobalWallpaper(value);
    } catch (err: any) {
      setNotice(friendlyError(err));
    } finally {
      setWallBusy(false);
    }
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotice("This browser doesn't support notifications.");
      return;
    }

    const res = await Notification.requestPermission();
    setNotifPerm(res);
  }

  async function signOut() {
    await supabase?.auth.signOut();

    setShowSettings(false);
    setUser(null);
    setProfile(null);
    setChats([]);
    setActiveId(null);
    setMessages([]);
    setMobileChat(false);
    draftsRef.current = {};
  }

  const active = chats.find(c => c.id === activeId) || null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();

    return chats.filter(c => {
      if (!c.title.toLowerCase().includes(q)) return false;
      if (filter === "archived") return c.archived;
      if (c.archived) return false;
      if (filter === "unread") return c.unread > 0;
      if (filter === "groups") return c.isGroup;
      return true;
    });
  }, [chats, query, filter]);

  if (!authReady) return null;

  if (!supabase) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">w</div>
          <h1>Whatsup</h1>
          <p>Backend is not configured. Please set the Supabase environment variables.</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">w</div>
          <h1>Welcome to Whatsup</h1>
          <p>Your conversations, all in one place.</p>

          <form onSubmit={authenticate}>
            {authMode === "signup" && (
              <input
                placeholder="Full name"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            )}

            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password (min. 6 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={6}
              required
            />

            <button className="primary" type="submit">
              {authMode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          {notice && <div className="notice">{notice}</div>}

          <button
            className="text-button"
            onClick={() => {
              setNotice("");
              setAuthMode(authMode === "login" ? "signup" : "login");
            }}
          >
            {authMode === "login"
              ? "New here? Create an account"
              : "Already have an account? Log in"}
          </button>
        </div>
      </main>
    );
  }

  const hasText = draft.trim().length > 0;
  const myActiveRole = chatMembers.find(x => x.id === user?.id)?.role;
  const canSend = !active?.onlyAdminsSend || myActiveRole === "admin";
  const otherPerson = active?.otherId ? people[active.otherId] : undefined;
  const activeTyping = active ? typingIn(active.id) : [];
  const effectiveWallpaper = (active && active.wallpaper) || profile?.wallpaper || "default";
  const wallStyle = wallpaperStyle(effectiveWallpaper, dark);
  const myAvatar = profile?.avatar_url || people[user.id]?.avatar || null;

  let headerStatus = "";
  let headerTyping = false;

  if (active) {
    if (activeTyping.length) {
      headerTyping = true;
      headerStatus = active.isGroup
        ? `${activeTyping.map(id => nameOf(id) || "Someone").join(", ")} typing…`
        : "typing…";
    } else if (active.isGroup) {
      headerStatus = chatMembers.length ? `${chatMembers.length} members` : "Group";
    } else if (active.otherId && online.has(active.otherId)) {
      headerStatus = "online";
    } else if (otherPerson?.lastSeen) {
      headerStatus = lastSeenLabel(otherPerson.lastSeen);
    } else {
      headerStatus = "Direct message";
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileChat ? "hide-mobile" : ""}`}>
        <header className="sidebar-header">
          <div className="brand">
            <span className="brand-mark small">w</span>
            <span>Whatsup</span>
          </div>

          <div className="header-actions">
            <button
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => chooseTheme(dark ? "light" : "dark")}
            >
              {dark ? <Sun /> : <Moon />}
            </button>
            <button title="New chat" onClick={() => setShowNew(true)}>
              <MessageSquarePlus />
            </button>
            <button title="Settings" onClick={openSettings}>
              <SettingsIcon />
            </button>
          </div>
        </header>

        <div className="search-wrap">
          <Search size={18} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats"
          />
        </div>

        <div className="filters">
          {(["all", "unread", "groups", "archived"] as Filter[]).map(f => (
            <button
              key={f}
              className={`filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "unread" ? "Unread" : f === "groups" ? "Groups" : "Archived"}
            </button>
          ))}
        </div>

        <div className="chat-list">
          {filtered.length === 0 && (
            <div style={{ padding: 20, opacity: 0.7, textAlign: "center" }}>
              {filter === "archived"
                ? "No archived chats."
                : "No conversations yet. Tap the + icon to start one."}
            </div>
          )}

          {filtered.map(chat => {
            const typers = typingIn(chat.id);

            return (
              <button
                key={chat.id}
                className={`chat-row ${activeId === chat.id ? "selected" : ""}`}
                onClick={() => {
                  setActiveId(chat.id);
                  setMobileChat(true);
                }}
              >
                <Avatar
                  label={chat.title}
                  url={chat.avatarUrl}
                  online={!chat.isGroup && !!chat.otherId && online.has(chat.otherId)}
                />

                <div className="chat-info">
                  <div className="chat-top">
                    <strong>{chat.title}</strong>
                    <time>{chat.time}</time>
                  </div>

                  <div className="chat-bottom">
                    {typers.length ? (
                      <span className="typing">typing…</span>
                    ) : (
                      <span>
                        {chat.lastText
                          ? `${chat.lastMine ? "You: " : ""}${chat.lastText}`
                          : chat.subtitle}
                      </span>
                    )}

                    <span className="meta">
                      {chat.muted ? <BellOff size={13} /> : null}
                      {chat.pinned ? <Pin size={13} /> : null}
                      {chat.unread > 0 && (
                        <b className={chat.muted ? "muted" : ""}>
                          {chat.unread > 99 ? "99+" : chat.unread}
                        </b>
                      )}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <footer className="sidebar-footer">
          <Avatar label={profile?.full_name || user.email || "W"} url={myAvatar} />
          <div className="who">
            <strong>{profile?.full_name || user.email}</strong>
            <small>{profile?.about || "Online"}</small>
          </div>
          <button onClick={signOut} title="Sign out">
            <LogOut size={18} />
          </button>
        </footer>
      </aside>

      <section
        className={`conversation ${!mobileChat ? "hide-mobile" : ""}`}
        onDragOver={e => {
          if (!active || !canSend) return;
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={e => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (!active || !canSend) return;
          const f = e.dataTransfer?.files?.[0];
          if (f) sendMedia(f);
        }}
      >
        {dragging && <div className="drop-hint">Drop a photo, video or file to send</div>}

        {!active ? (
          <div className="messages-area" style={wallStyle}>
            <div className="empty-state">
              <div className="empty-icon">✉</div>
              <h2>Welcome</h2>
              <p>Select a chat or start a new one.</p>
            </div>
          </div>
        ) : (
          <>
            <header className="conversation-header">
              <button
                className="back-button"
                onClick={() => setMobileChat(false)}
              >
                <ArrowLeft />
              </button>

              <button
                type="button"
                className="header-person"
                onClick={() => (active.isGroup ? openGroupInfo() : setShowContact(true))}
              >
                <Avatar
                  label={active.title}
                  url={active.avatarUrl}
                  online={!active.isGroup && !!active.otherId && online.has(active.otherId)}
                />
                <span className="contact">
                  <strong>{active.title}</strong>
                  <small className={headerTyping ? "typing" : ""}>{headerStatus}</small>
                </span>
              </button>

              <div className="header-actions">
                <button title="More" onClick={() => setHeadMenu(v => !v)}>
                  <MoreVertical />
                </button>

                {headMenu && (
                  <>
                    <div className="menu-scrim" onClick={() => setHeadMenu(false)} />
                    <div className="menu-pop">
                      <button
                        onClick={() => {
                          setHeadMenu(false);
                          if (active.isGroup) openGroupInfo();
                          else setShowContact(true);
                        }}
                      >
                        {active.isGroup ? <Users size={17} /> : <Info size={17} />}
                        {active.isGroup ? "Group info" : "Contact info"}
                      </button>
                      <button
                        onClick={() => {
                          setHeadMenu(false);
                          setShowWallpaper(true);
                        }}
                      >
                        <Palette size={17} /> Chat wallpaper
                      </button>
                      <button
                        onClick={() => {
                          setHeadMenu(false);
                          setPref(active.id, { muted: !active.muted });
                        }}
                      >
                        {active.muted ? <Bell size={17} /> : <BellOff size={17} />}
                        {active.muted ? "Unmute notifications" : "Mute notifications"}
                      </button>
                      <button
                        onClick={() => {
                          setHeadMenu(false);
                          setPref(active.id, { pinned: !active.pinned });
                        }}
                      >
                        {active.pinned ? <PinOff size={17} /> : <Pin size={17} />}
                        {active.pinned ? "Unpin chat" : "Pin chat"}
                      </button>
                      <button
                        onClick={() => {
                          setHeadMenu(false);
                          setPref(active.id, { archived: !active.archived });
                        }}
                      >
                        <Archive size={17} />
                        {active.archived ? "Unarchive chat" : "Archive chat"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </header>

            <div
              className="messages-area"
              ref={areaRef}
              style={wallStyle}
              onClick={() => {
                if (showEmoji) setShowEmoji(false);
                if (showAttach) setShowAttach(false);
              }}
            >
              <div className="encryption">
                <span>🔒</span> Messages are stored securely and visible only to chat members. Not end-to-end encrypted.
              </div>

              {hasMore && (
                <button className="load-older" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              )}

              {messages.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">✉</div>
                  <h2>Say hello!</h2>
                  <p>Your conversation starts here.</p>
                </div>
              )}

              {messages.map((m, i) => {
                const prev = i > 0 ? messages[i - 1] : null;
                const showDay =
                  !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();

                const out = m.sender_id === user.id;
                const deleted = !!m.deleted_at;

                const isMedia =
                  !deleted &&
                  ((m.type === "voice" && !!m.audio_path) ||
                    ((m.type === "image" || m.type === "video" || m.type === "file") && !!m.media_path));

                const isText = !m.type || m.type === "text";
                const rx = reactions[m.id] || {};
                const rxGroups: Record<string, { count: number; mine: boolean }> = {};
                Object.keys(rx).forEach(uid => {
                  const em = rx[uid];
                  if (!rxGroups[em]) rxGroups[em] = { count: 0, mine: false };
                  rxGroups[em].count += 1;
                  if (uid === user.id) rxGroups[em].mine = true;
                });
                const rxEmojis = Object.keys(rxGroups);

                const replied = m.reply_to ? messages.find(x => x.id === m.reply_to) : null;
                const canEdit =
                  out && !deleted && isText && Date.now() - ts(m.created_at) < EDIT_WINDOW_MS;
                const canDelete = out || (active.isGroup && myActiveRole === "admin");
                const menuUp = i >= messages.length - 3 && messages.length > 3;

                return (
                  <Fragment key={m.id}>
                    {showDay && <div className="date-sep">{dayLabel(m.created_at)}</div>}

                    <div
                      id={`msg-${m.id}`}
                      className={`message ${out ? "outgoing" : "incoming"} ${deleted ? "deleted" : ""} ${rxEmojis.length ? "has-reactions" : ""}`}
                    >
                      {!deleted && (
                        <button
                          type="button"
                          className="msg-chevron"
                          title="Message options"
                          onClick={e => {
                            e.stopPropagation();
                            setMenuMsgId(menuMsgId === m.id ? null : m.id);
                          }}
                        >
                          <ChevronDown size={16} />
                        </button>
                      )}

                      {menuMsgId === m.id && (
                        <>
                          <div className="menu-scrim" onClick={() => setMenuMsgId(null)} />
                          <div className={`msg-menu ${menuUp ? "up" : ""}`}>
                            <div className="react-row">
                              {QUICK_REACTIONS.map(em => (
                                <button key={em} type="button" onClick={() => reactTo(m, em)}>
                                  {em}
                                </button>
                              ))}
                            </div>
                            <button type="button" onClick={() => startReply(m)}>
                              <Reply size={16} /> Reply
                            </button>
                            {isText && (
                              <button type="button" onClick={() => copyMessage(m)}>
                                <Copy size={16} /> Copy
                              </button>
                            )}
                            {canEdit && (
                              <button type="button" onClick={() => startEdit(m)}>
                                <Pencil size={16} /> Edit
                              </button>
                            )}
                            {out && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuMsgId(null);
                                  setInfoMsgId(m.id);
                                }}
                              >
                                <Info size={16} /> Message info
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" className="danger" onClick={() => deleteMessage(m)}>
                                <Trash2 size={16} /> Delete
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {active.isGroup && !out && (
                        <span className="sender">{nameOf(m.sender_id)}</span>
                      )}

                      {m.reply_to && !deleted && (
                        <button
                          type="button"
                          className="quote"
                          onClick={() => replied && jumpTo(replied.id)}
                        >
                          <strong>
                            {replied
                              ? replied.sender_id === user.id
                                ? "You"
                                : nameOf(replied.sender_id) || "User"
                              : "Message"}
                          </strong>
                          <span>{replied ? previewOf(replied) : "Original message isn't loaded"}</span>
                        </button>
                      )}

                      {deleted ? (
                        <div className="text">🚫 This message was deleted</div>
                      ) : isMedia ? (
                        <MediaBubble m={m} onOpenImage={setLightbox} />
                      ) : (
                        <div className="text">{m.content}</div>
                      )}

                      <small>
                        {m.edited_at && !deleted ? <span className="edited">edited</span> : null}
                        {clock(m.created_at)}
                        {out && !deleted ? (
                          <button
                            type="button"
                            title="Message info"
                            onClick={e => {
                              e.stopPropagation();
                              setInfoMsgId(m.id);
                            }}
                            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex" }}
                          >
                            <Ticks status={statusFor(m)} />
                          </button>
                        ) : null}
                      </small>

                      {rxEmojis.length > 0 && (
                        <div className="reactions">
                          {rxEmojis.map(em => (
                            <button
                              key={em}
                              type="button"
                              className={`reaction-chip ${rxGroups[em].mine ? "mine" : ""}`}
                              onClick={() => reactTo(m, em)}
                            >
                              {em}
                              {rxGroups[em].count > 1 ? <small>{rxGroups[em].count}</small> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}

              <div ref={bottomRef} />
            </div>

            {showEmoji && (
              <div className="emoji-grid">
                {EMOJIS.map(em => (
                  <button key={em} type="button" onClick={() => addEmoji(em)}>
                    {em}
                  </button>
                ))}
              </div>
            )}

            {replyTo && (
              <div className="composer-bar">
                <div className="bar-body">
                  <strong>
                    Replying to {replyTo.sender_id === user.id ? "yourself" : nameOf(replyTo.sender_id) || "message"}
                  </strong>
                  <span>{previewOf(replyTo)}</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setReplyTo(null)} title="Cancel reply">
                  <X size={18} />
                </button>
              </div>
            )}

            {editing && (
              <div className="composer-bar">
                <div className="bar-body">
                  <strong>Editing message</strong>
                  <span>{editing.content}</span>
                </div>
                <button type="button" className="icon-btn" onClick={cancelEdit} title="Cancel edit">
                  <X size={18} />
                </button>
              </div>
            )}

            {uploading && <div className="upload-status">Uploading… please wait</div>}

            {recording ? (
              <div
                className="composer"
                style={{ alignItems: "center", gap: 12 }}
              >
                <button
                  type="button"
                  title="Cancel"
                  onClick={() => stopRecording(false)}
                >
                  <Trash2 />
                </button>

                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#ef4444",
                    }}
                  />
                  <span>Recording… {fmtSecs(recSecs)}</span>
                </div>

                <button
                  className="send-button"
                  type="button"
                  title="Send voice message"
                  onClick={() => stopRecording(true)}
                >
                  <Send size={19} />
                </button>
              </div>
            ) : !canSend ? (
              <div
                className="composer"
                style={{ justifyContent: "center", opacity: 0.7 }}
              >
                Only admins can send messages in this group.
              </div>
            ) : (
              <form className="composer" onSubmit={sendMessage}>
                <button
                  type="button"
                  title="Emoji"
                  onClick={() => {
                    setShowAttach(false);
                    setShowEmoji(v => !v);
                  }}
                >
                  <Smile />
                </button>

                <button
                  type="button"
                  title="Attach"
                  disabled={uploading || !!editing}
                  onClick={() => {
                    setShowEmoji(false);
                    setShowAttach(v => !v);
                  }}
                >
                  <Paperclip />
                </button>

                {showAttach && (
                  <div className="attach-menu">
                    <button type="button" onClick={() => mediaInputRef.current?.click()}>
                      <ImageIcon size={18} /> Photo or video
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>
                      <FileText size={18} /> Document
                    </button>
                  </div>
                )}

                <input
                  ref={mediaInputRef}
                  type="file"
                  accept={ACCEPT_MEDIA}
                  hidden
                  onChange={onPickFile}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_FILES}
                  hidden
                  onChange={onPickFile}
                />

                <input
                  ref={inputRef}
                  type="text"
                  className="text-input"
                  value={draft}
                  maxLength={10000}
                  onChange={e => updateDraft(e.target.value)}
                  onFocus={() => {
                    setShowEmoji(false);
                    setShowAttach(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === "Escape") {
                      if (editing) cancelEdit();
                      else if (replyTo) setReplyTo(null);
                    }
                  }}
                  onPaste={e => {
                    const f = e.clipboardData?.files?.[0];
                    if (f && f.type.startsWith("image/") && !editing) {
                      e.preventDefault();
                      sendMedia(f);
                    }
                  }}
                  placeholder="Type a message"
                />

                {hasText ? (
                  <button
                    className="send-button"
                    type="submit"
                    title={editing ? "Save edit" : "Send"}
                  >
                    {editing ? <Check size={19} /> : <Send size={19} />}
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="button"
                    title="Record voice message"
                    disabled={!!editing}
                    onClick={startRecording}
                  >
                    <Mic size={19} />
                  </button>
                )}
              </form>
            )}
          </>
        )}

        {notice && (
          <div className="notice floating" onClick={() => setNotice("")}>
            {notice}
          </div>
        )}
      </section>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lb-actions" onClick={e => e.stopPropagation()}>
            <a href={lightbox} target="_blank" rel="noopener noreferrer" download title="Download">
              <Download size={20} />
            </a>
            <button type="button" onClick={() => setLightbox(null)} title="Close">
              <X size={20} />
            </button>
          </div>
          <img src={lightbox} alt="" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {showContact && active && !active.isGroup && (
        <Modal title="Contact info" onClose={() => setShowContact(false)}>
          <div className="avatar-edit">
            <Avatar label={active.title} url={active.avatarUrl} className="avatar big" />
            <strong style={{ fontSize: 18 }}>{active.title}</strong>
            <small style={{ color: "var(--muted)" }}>
              {active.otherId && online.has(active.otherId)
                ? "online"
                : lastSeenLabel(otherPerson?.lastSeen) || ""}
            </small>
          </div>
          <div className="section-title">About</div>
          <div>{otherPerson?.about || "Hey there! I am using Whatsup."}</div>
        </Modal>
      )}

      {showWallpaper && active && (
        <Modal title="Chat wallpaper" onClose={() => setShowWallpaper(false)}>
          <small style={{ color: "var(--muted)" }}>
            This only changes how this chat looks for you. Nobody else sees it.
          </small>
          <WallpaperPicker
            value={active.wallpaper || profile?.wallpaper || "default"}
            dark={dark}
            busy={wallBusy}
            onPick={id => setPref(active.id, { wallpaper: id })}
            onUpload={f => uploadWallpaper(f, "chat")}
          />
          {active.wallpaper && (
            <button
              type="button"
              className="btn"
              onClick={() => setPref(active.id, { wallpaper: null })}
            >
              Use my default wallpaper
            </button>
          )}
        </Modal>
      )}

      {groupInfoOpen && active?.isGroup && (
        <Modal title="Group info" onClose={() => setGroupInfoOpen(false)} wide>
          <div className="avatar-edit">
            <Avatar
              label={groupInfoName || active.title}
              url={groupInfoAvatar || active.avatarUrl}
              className="avatar med"
            />
            {groupRole === "admin" && (
              <>
                <button
                  type="button"
                  className="btn small"
                  disabled={groupAvatarBusy}
                  onClick={() => groupAvatarInputRef.current?.click()}
                >
                  <Camera size={14} /> {groupAvatarBusy ? "Uploading…" : "Change group photo"}
                </button>
                <input
                  ref={groupAvatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) uploadGroupAvatar(f);
                  }}
                />
              </>
            )}
          </div>

          <div>
            <label className="field-label">Group name</label>
            <input
              className="field"
              value={groupInfoName}
              onChange={e => setGroupInfoName(e.target.value)}
              placeholder="Group name"
              disabled={groupRole !== "admin"}
            />
          </div>

          <div>
            <label className="field-label">Description</label>
            <textarea
              className="field"
              value={groupInfoDescription}
              onChange={e => setGroupInfoDescription(e.target.value)}
              placeholder="Write a short group description..."
              rows={3}
              disabled={groupRole !== "admin"}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={groupOnlyAdmins}
              disabled={groupRole !== "admin"}
              onChange={e => setGroupOnlyAdmins(e.target.checked)}
            />
            Only admins can send messages
          </label>

          {groupRole === "admin" && (
            <button className="btn green" onClick={saveGroupInfo}>
              Save group info
            </button>
          )}

          <div className="section-title">Members ({groupMembers.length})</div>

          <div>
            {groupMembers.map(member => (
              <div key={member.id} className="row-item">
                <Avatar
                  label={member.full_name || member.username || "User"}
                  url={member.avatar_url}
                />

                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {member.full_name || member.username || "Unknown user"}
                    {member.id === user.id ? " (You)" : ""}
                  </div>
                  <small>{member.role === "admin" ? "Admin" : "Member"}</small>
                </div>

                {member.id !== user.id && groupRole === "admin" && (
                  <>
                    <button
                      className="btn small chip-info"
                      onClick={() =>
                        setMemberRole(member.id, member.role === "admin" ? "member" : "admin")
                      }
                    >
                      {member.role === "admin" ? "Demote" : "Make admin"}
                    </button>
                    <button
                      className="btn small chip-danger"
                      onClick={() => removeMemberFromGroup(member.id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {groupRole === "admin" && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>Add members</div>

              <input
                className="field"
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="Search by name"
              />

              {memberSearchResults.map(p => {
                const label = p.full_name || p.username || "User";

                return (
                  <button
                    key={p.id}
                    className="pick-row"
                    onClick={() => addMemberToGroup(p.id)}
                  >
                    <Avatar label={label} url={p.avatar_url} />
                    <span>{label}</span>
                    <span style={{ marginLeft: "auto", color: "var(--green2)" }}>Add</span>
                  </button>
                );
              })}
            </div>
          )}

          <button className="btn danger" onClick={leaveCurrentGroup}>
            Leave group
          </button>
        </Modal>
      )}

      {infoMsgId && (() => {
        const msg = messages.find(x => x.id === infoMsgId);
        if (!msg) return null;
        const rec = receipts[msg.id] || {};
        const others = chatMembers.filter(x => x.id !== user.id);
        const fmt = (iso?: string | null) =>
          iso ? new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";

        return (
          <Modal title="Message info" onClose={() => setInfoMsgId(null)}>
            <div style={{ opacity: 0.8 }}>Sent: {fmt(msg.created_at)}</div>
            {msg.edited_at && <div style={{ opacity: 0.8 }}>Edited: {fmt(msg.edited_at)}</div>}
            {others.length === 0 && <div style={{ opacity: 0.6 }}>No other members yet.</div>}
            {others.map(o => {
              const r = rec[o.id];
              return (
                <div key={o.id} className="row-item" style={{ display: "block" }}>
                  <div style={{ fontWeight: 600 }}>{nameOf(o.id) || "User"}</div>
                  <div style={{ opacity: 0.75 }}>Delivered: {fmt(r?.delivered_at)}</div>
                  <div style={{ opacity: 0.75 }}>Read: {fmt(r?.read_at)}</div>
                </div>
              );
            })}
          </Modal>
        );
      })()}

      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <div className="avatar-edit">
            <div onClick={() => avatarInputRef.current?.click()}>
              <Avatar
                label={profile?.full_name || user.email || "W"}
                url={myAvatar}
                className="avatar big"
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn small"
                disabled={avatarBusy}
                onClick={() => avatarInputRef.current?.click()}
              >
                <Camera size={14} /> {avatarBusy ? "Uploading…" : "Change photo"}
              </button>
              {myAvatar && (
                <button type="button" className="btn small danger" onClick={removeAvatar}>
                  Remove
                </button>
              )}
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) uploadAvatar(f);
              }}
            />
          </div>

          <div>
            <label className="field-label">Display name</label>
            <input
              className="field"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder="Your name"
              maxLength={60}
            />
          </div>

          <div>
            <label className="field-label">About</label>
            <input
              className="field"
              value={aboutDraft}
              onChange={e => setAboutDraft(e.target.value)}
              placeholder="Hey there! I am using Whatsup."
              maxLength={140}
            />
          </div>

          <div>
            <label className="field-label">Email</label>
            <div>{user.email}</div>
          </div>

          <div className="section-title">Appearance</div>
          <div className="seg">
            <button className={themeMode === "light" ? "on" : ""} onClick={() => chooseTheme("light")}>
              <Sun size={15} /> Light
            </button>
            <button className={themeMode === "dark" ? "on" : ""} onClick={() => chooseTheme("dark")}>
              <Moon size={15} /> Dark
            </button>
            <button className={themeMode === "system" ? "on" : ""} onClick={() => chooseTheme("system")}>
              <Monitor size={15} /> Auto
            </button>
          </div>

          <div className="section-title">Chat wallpaper</div>
          <WallpaperPicker
            value={profile?.wallpaper || "default"}
            dark={dark}
            busy={wallBusy}
            onPick={saveGlobalWallpaper}
            onUpload={f => uploadWallpaper(f, "global")}
          />

          <div className="section-title">Notifications</div>
          {notifPerm === "granted" ? (
            <small style={{ color: "var(--muted)" }}>
              Desktop notifications are on. Muted chats stay silent.
            </small>
          ) : notifPerm === "denied" ? (
            <small style={{ color: "var(--muted)" }}>
              Notifications are blocked. Allow them in your browser site settings.
            </small>
          ) : (
            <button className="btn" onClick={enableNotifications}>
              <Bell size={16} /> Turn on desktop notifications
            </button>
          )}

          <button className="btn green" onClick={saveSettings}>
            Save changes
          </button>

          <button className="btn danger" onClick={signOut}>
            <LogOut size={16} /> Log out
          </button>
        </Modal>
      )}

      {showNew && (
        <Modal title={newMode === "direct" ? "New chat" : "New group"} onClose={closeNew}>
          <div className="seg">
            <button className={newMode === "direct" ? "on" : ""} onClick={() => setNewMode("direct")}>
              Direct
            </button>
            <button className={newMode === "group" ? "on" : ""} onClick={() => setNewMode("group")}>
              <Users size={16} />
              Group
            </button>
          </div>

          {newMode === "group" && (
            <input
              className="field"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name"
              maxLength={80}
            />
          )}

          <input
            className="field"
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            placeholder="Search by name"
          />

          <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
            {results.length === 0 && (
              <div style={{ padding: 16, opacity: 0.6, textAlign: "center" }}>
                No users found.
              </div>
            )}

            {results.map(p => {
              const label = p.full_name || p.username || "User";
              const on = picked.includes(p.id);

              return (
                <button
                  key={p.id}
                  className={`pick-row ${on ? "on" : ""}`}
                  onClick={() => {
                    if (newMode === "direct") {
                      startDirect(p.id);
                    } else {
                      setPicked(prev =>
                        on ? prev.filter(x => x !== p.id) : [...prev, p.id]
                      );
                    }
                  }}
                >
                  <Avatar label={label} url={p.avatar_url} />
                  <span>{label}</span>
                  {newMode === "group" && on && (
                    <span style={{ marginLeft: "auto" }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>

          {newMode === "group" && (
            <button className="btn green" onClick={createGroup}>
              <Plus size={16} /> Create group ({picked.length} selected)
            </button>
          )}
        </Modal>
      )}
    </main>
  );
}
