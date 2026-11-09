"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, MessageSquarePlus, MoreVertical, Paperclip, Smile, Send,
  CheckCheck, Phone, Video, ArrowLeft, LogOut, UserRound, Users, X
} from "lucide-react";

type Profile = { id: string; username: string | null; full_name: string | null; avatar_url: string | null; };
type Chat = { id: string; title: string; subtitle: string; avatar: string; time: string; unread: number; isGroup: boolean; updatedAt: string; };
type Message = { id: string; chat_id: string; sender_id: string; content: string; created_at: string; };

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileChat, setMobileChat] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group">("direct");
  const [userQuery, setUserQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const namesRef = useRef<Record<string, string>>({});

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { namesRef.current = names; }, [names]);

  // ---------- Auth ----------
  useEffect(() => {
    const sb = supabase;
    if (!sb) { setAuthReady(true); return; }
    sb.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: listener } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchNames(ids: string[]): Promise<Record<string, string>> {
    const sb = supabase;
    const out: Record<string, string> = {};
    if (!sb) return out;
    const need = Array.from(new Set(ids)).filter(id => id && !namesRef.current[id]);
    if (need.length) {
      const { data } = await sb.from("profiles").select("id, username, full_name").in("id", need);
      data?.forEach((p: any) => { out[p.id] = p.full_name || p.username || "User"; });
      setNames(prev => ({ ...prev, ...out }));
    }
    return { ...namesRef.current, ...out };
  }

  async function loadChats(selectId?: string) {
    const sb = supabase;
    if (!sb || !user) return;
    const { data, error } = await sb
      .from("chat_members")
      .select("chat_id, chats(id, name, is_group, updated_at)")
      .eq("user_id", user.id);
    if (error) { setNotice(error.message); return; }

    const list: any[] = (data || []).map((r: any) => r.chats).filter(Boolean);
    const directIds = list.filter(c => !c.is_group).map(c => c.id);
    const otherByChat: Record<string, string> = {};
    let nm: Record
