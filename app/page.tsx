"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, MessageSquarePlus, MoreVertical, Paperclip, Smile, Send,
  Check, CheckCheck, Phone, Video, ArrowLeft, LogOut, UserRound, Users, X,
  Mic, Trash2, Settings as SettingsIcon
} from "lucide-react";

type Profile = { id: string; username: string | null; full_name: string | null; avatar_url: string | null; };
type Chat = { id: string; title: string; subtitle: string; avatar: string; time: string; unread: number; isGroup: boolean; updatedAt: string; };
type Message = {
  id: string; chat_id: string; sender_id: string; content: string; created_at: string;
  delivered_at?: string | null; read_at?: string | null;
  type?: string | null; audio_path?: string | null; audio_duration?: number | null;
};

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😋",
  "😎","🤩","🥳","😏","😒","😞","😔","😢","😭","😤","😡","🤯","😱","😴","🤔","🙄",
  "👍","👎","👏","🙌","🙏","💪","👌","✌️","🤝","👋","❤️","🧡","💛","💚","💙","💜",
  "🖤","💔","🔥","✨","🎉","🎂","🌹","⭐","💯","✅","❌","🎵","📞","📷","🍕","☕"
];

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function Ticks({ m }: { m: Message }) {
  if (m.read_at) return <CheckCheck size={15} color="#53bdeb" />;
  if (m.delivered_at) return <CheckCheck size={15} color="#8696a0" />;
  return <Check size={15} color="#8696a0" />;
}

function VoiceMessage({ path, duration }: { path: string; duration?: number | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const sb: any = supabase;
    if (!sb) return;
    let alive = true;
    sb.storage.from("voice").createSignedUrl(path, 3600).then(({ data }: any) => {
      if (alive && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220 }}>
      {url
        ? <audio controls preload="metadata" src={url} style={{ height: 36, maxWidth: 240 }} />
        : <span style={{ opacity: 0.7, fontSize: 13 }}>Loading voice message…</span>}
      {duration ? <small>{fmtSecs(duration)}</small> : null}
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

  // emoji + settings + voice
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const namesRef = useRef<Record<string, string>>({});
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);
  const timerRef = useRef<any>(null);
  const cancelRef = useRef(false);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { namesRef.current = names; }, [names]);
  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  // ---------- Auth ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb) { setAuthReady(true); return; }
    sb.auth.getSession().then(({ data }: any) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: listener } = sb.auth.onAuthStateChange((_e: any, session: any) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchNames(ids: string[]): Promise<Record<string, string>> {
    const sb: any = supabase;
    const out: Record<string, string> = {};
    if (!sb) return out;
    const need = Array.from(new Set(ids)).filter(id => id && !namesRef.current[id]);
    if (need.length) {
      const { data } = await sb.from("profiles").select("id, username, full_name").in("id", need);
      (data || []).forEach((p: any) => { out[p.id] = p.full_name || p.username || "User"; });
      setNames(prev => ({ ...prev, ...out }));
    }
    return { ...namesRef.current, ...out };
  }

  // ---------- Receipts helpers ----------
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

  async function loadChats(selectId?: string) {
    const sb: any = supabase;
    if (!sb || !user) return;
    const { data, error } = await sb
      .from("chat_members")
      .select("chat_id, chats(id, name, is_group, updated_at)")
      .eq("user_id", user.id);
    if (error) { setNotice(error.message); return; }

    const list: any[] = (data || []).map((r: any) => r.chats).filter(Boolean);
    const directIds = list.filter((c: any) => !c.is_group).map((c: any) => c.id);
    const otherByChat: Record<string, string> = {};
    let nm: Record<string, string> = namesRef.current;
    if (directIds.length) {
      const { data: others } = await sb
        .from("chat_members").select("chat_id, user_id")
        .in("chat_id", directIds).neq("user_id", user.id);
      (others || []).forEach((o: any) => { otherByChat[o.chat_id] = o.user_id; });
      nm = await fetchNames(Object.values(otherByChat));
    }

    const mapped: Chat[] = list.map((c: any) => {
      const title: string = c.is_group ? (c.name || "Group") : (nm[otherByChat[c.id]] || "Conversation");
      const prev = chatsRef.current.find(x => x.id === c.id);
      return {
        id: c.id, title, isGroup: !!c.is_group,
        subtitle: c.is_group ? "Group" : "Direct message",
        avatar: (title[0] || "W").toUpperCase(),
        time: formatTime(c.updated_at), unread: prev?.unread || 0,
        updatedAt: c.updated_at || ""
      };
    }).sort((a: Chat, b: Chat) => b.updatedAt.localeCompare(a.updatedAt));

    setChats(mapped);
    if (selectId) { setActiveId(selectId); setMobileChat(true); }
    else if (!activeIdRef.current && mapped.length) setActiveId(mapped[0].id);
  }

  // ---------- Profile + chats after login ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user) { setChats([]); setActiveId(null); setMessages([]); return; }
    sb.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }: any) => { if (data) setProfile(data as Profile); });
    loadChats();
    markDelivered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---------- One realtime channel for all my chats (RLS filters what I can see) ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user) return;
    const channel = sb.channel("messages-all")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload: any) => {
        const m = payload.new as Message;
        const mine = m.sender_id === user.id;
        if (m.chat_id === activeIdRef.current) {
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
          fetchNames([m.sender_id]);
          if (!mine) markRead(m.chat_id);
        } else if (!chatsRef.current.some(c => c.id === m.chat_id)) {
          if (!mine) markDelivered();
          loadChats();
          return;
        } else if (!mine) {
          markDelivered();
          setChats(prev => prev.map(c => c.id === m.chat_id ? { ...c, unread: c.unread + 1 } : c));
        }
        setChats(prev => prev
          .map(c => c.id === m.chat_id ? { ...c, updatedAt: m.created_at, time: formatTime(m.created_at) } : c)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload: any) => {
        const m = payload.new as Message;
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...m } : x));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---------- Load history of the active chat ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user || !activeId) { setMessages([]); return; }
    let alive = true;
    setMessages([]);
    sb.from("messages").select("*").eq("chat_id", activeId).is("deleted_at", null)
      .order("created_at", { ascending: true })
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) { setNotice(error.message); return; }
        if (data) {
          const rows = data as Message[];
          setMessages(prev => {
            const ids = new Set(rows.map(r => r.id));
            return [...rows, ...prev.filter(p => !ids.has(p.id))];
          });
          fetchNames(rows.map(r => r.sender_id));
        }
      });
    setChats(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c));
    markRead(activeId);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, user]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ---------- User search for new chat ----------
  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !user || !showNew) return;
    const q = userQuery.replace(/[,()%*]/g, "").trim();
    let alive = true;
    let req: any = sb.from("profiles").select("id, username, full_name, avatar_url").neq("id", user.id);
    if (q) req = req.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);
    req.limit(20).then(({ data }: any) => { if (alive) setResults((data as Profile[]) || []); });
    return () => { alive = false; };
  }, [showNew, userQuery, user]);

  function closeNew() {
    setShowNew(false); setNewMode("direct"); setUserQuery("");
    setResults([]); setGroupName(""); setPicked([]);
  }

  async function startDirect(otherId: string) {
    const sb: any = supabase;
    if (!sb) return;
    const { data, error } = await sb.rpc("create_direct_chat", { other_user: otherId });
    if (error) { setNotice(error.message); return; }
    closeNew();
    await loadChats(data as string);
  }

  async function createGroup() {
    const sb: any = supabase;
    if (!sb) return;
    if (!groupName.trim()) { setNotice("Please enter a group name."); return; }
    const { data, error } = await sb.rpc("create_group_chat", { group_name: groupName.trim(), member_ids: picked });
    if (error) { setNotice(error.message); return; }
    closeNew();
    await loadChats(data as string);
  }

  async function authenticate(e: React.FormEvent) {
    e.preventDefault(); setNotice("");
    const sb: any = supabase;
    if (!sb) { setNotice("Supabase is not configured."); return; }
    const result: any = authMode === "signup"
      ? await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (result.error) setNotice(result.error.message);
    else if (authMode === "signup" && !result.data?.session)
      setNotice("تم إنشاء الحساب. افحص بريدك لتأكيده ثم سجّل الدخول.");
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const sb: any = supabase;
    const content = draft.trim();
    if (!sb || !user || !activeId || !content) return;
    setNotice(""); setDraft(""); setShowEmoji(false);
    const { data, error } = await sb.from("messages")
      .insert({ chat_id: activeId, sender_id: user.id, content }).select().single();
    if (error) { setNotice(error.message); setDraft(content); return; }
    if (data) setMessages(prev => prev.some(x => x.id === (data as Message).id) ? prev : [...prev, data as Message]);
  }

  // ---------- Voice messages ----------
  async function sendVoice(blob: Blob, duration: number) {
    const sb: any = supabase;
    const chatId = activeIdRef.current;
    if (!sb || !user || !chatId) return;
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const path = `${chatId}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("voice").upload(path, blob, { contentType: blob.type });
    if (up.error) { setNotice(up.error.message); return; }
    const { data, error } = await sb.from("messages")
      .insert({
        chat_id: chatId, sender_id: user.id, content: "🎤 Voice message",
        type: "voice", audio_path: path, audio_duration: duration
      }).select().single();
    if (error) { setNotice(error.message); return; }
    if (data) setMessages(prev => prev.some(x => x.id === (data as Message).id) ? prev : [...prev, data as Message]);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Voice recording is not supported in this browser."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = []; cancelRef.current = false;
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        setRecording(false); setRecSecs(0);
        if (cancelRef.current) return;
        const type = (mr.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type });
        const duration = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        await sendVoice(blob, duration);
      };
      mr.start();
      mrRef.current = mr;
      recStartRef.current = Date.now();
      setShowEmoji(false); setRecording(true); setRecSecs(0);
      timerRef.current = setInterval(
        () => setRecSecs(Math.round((Date.now() - recStartRef.current) / 1000)), 500);
    } catch {
      setNotice("Microphone access was denied. Allow it in your browser settings.");
    }
  }

  function stopRecording(send: boolean) {
    cancelRef.current = !send;
    if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop();
  }

  // ---------- Emoji ----------
  function addEmoji(emoji: string) {
    const el = inputRef.current;
    if (el && el.selectionStart != null) {
      const s = el.selectionStart, e = el.selectionEnd ?? s;
      const next = draft.slice(0, s) + emoji + draft.slice(e);
      setDraft(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + emoji.length, s + emoji.length); });
    } else {
      setDraft(d => d + emoji);
    }
  }

  // ---------- Settings ----------
  function openSettings() {
    setNameDraft(profile?.full_name || "");
    setShowSettings(true);
  }

  async function saveSettings() {
    const sb: any = supabase;
    const name = nameDraft.trim();
    if (!sb || !user) return;
    if (!name) { setNotice("Name can't be empty."); return; }
    const { error } = await sb.from("profiles").update({ full_name: name }).eq("id", user.id);
    if (error) { setNotice(error.message); return; }
    setProfile(p => p ? { ...p, full_name: name } : p);
    setNames(prev => ({ ...prev, [user.id]: name }));
    setShowSettings(false);
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setShowSettings(false);
    setUser(null); setProfile(null); setChats([]); setActiveId(null); setMessages([]); setMobileChat(false);
  }

  const active = chats.find(c => c.id === activeId) || null;
  const filtered = useMemo(() => chats.filter(c =>
    c.title.toLowerCase().includes(query.toLowerCase()) &&
    (filter === "all" || (filter === "unread" && c.unread > 0) || (filter === "groups" && c.isGroup))
  ), [chats, query, filter]);

  if (!authReady) return null;

  if (!supabase) return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="brand-mark">w</div><h1>Whatsup</h1>
        <p>Backend is not configured. Please set the Supabase environment variables.</p>
      </div>
    </main>
  );

  if (!user) return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="brand-mark">w</div><h1>Welcome to Whatsup</h1>
        <p>Your conversations, all in one place.</p>
        <form onSubmit={authenticate}>
          {authMode === "signup" && <input placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} required />}
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password (min. 6 characters)" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
          <button className="primary" type="submit">{authMode === "login" ? "Log in" : "Create account"}</button>
        </form>
        {notice && <div className="notice">{notice}</div>}
        <button className="text-button" onClick={() => { setNotice(""); setAuthMode(authMode === "login" ? "signup" : "login"); }}>
          {authMode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </div>
    </main>
  );

  const hasText = draft.trim().length > 0;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileChat ? "hide-mobile" : ""}`}>
        <header className="sidebar-header">
          <div className="brand"><span className="brand-mark small">w</span><span>Whatsup</span></div>
          <div className="header-actions">
            <button title="New chat" onClick={() => setShowNew(true)}><MessageSquarePlus /></button>
            <button title="Settings" onClick={openSettings}><SettingsIcon /></button>
          </div>
        </header>
        <div className="search-wrap"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" /></div>
        <div className="filters">
          <button className={`filter ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All</button>
          <button className={`filter ${filter === "unread" ? "active" : ""}`} onClick={() => setFilter("unread")}>Unread</button>
          <button className={`filter ${filter === "groups" ? "active" : ""}`} onClick={() => setFilter("groups")}>Groups</button>
        </div>
        <div className="chat-list">
          {filtered.length === 0 && <div style={{ padding: 20, opacity: 0.7, textAlign: "center" }}>No conversations yet. Tap the + icon to start one.</div>}
          {filtered.map(chat => <button key={chat.id} className={`chat-row ${activeId === chat.id ? "selected" : ""}`} onClick={() => { setActiveId(chat.id); setMobileChat(true); }}>
            <div className="avatar">{chat.avatar}</div>
            <div className="chat-info"><div className="chat-top"><strong>{chat.title}</strong><time>{chat.time}</time></div><div className="chat-bottom"><span>{chat.subtitle}</span>{chat.unread > 0 && <b>{chat.unread}</b>}</div></div>
          </button>)}
        </div>
        <footer className="sidebar-footer"><div className="avatar self"><UserRound size={19} /></div><div><strong>{profile?.full_name || user.email}</strong><small>Online</small></div><button onClick={signOut} title="Sign out"><LogOut size={18} /></button></footer>
      </aside>

      <section className={`conversation ${!mobileChat ? "hide-mobile" : ""}`}>
        {!active ? (
          <div className="messages-area">
            <div className="empty-state"><div className="empty-icon">✉</div><h2>Welcome</h2><p>Select a chat or start a new one.</p></div>
          </div>
        ) : (<>
          <header className="conversation-header">
            <button className="back-button" onClick={() => setMobileChat(false)}><ArrowLeft /></button>
            <div className="avatar">{active.avatar}</div>
            <div className="contact"><strong>{active.title}</strong><small>{active.isGroup ? "Group chat" : "Direct message"}</small></div>
            <div className="header-actions"><button title="Video call"><Video /></button><button title="Voice call"><Phone /></button><button title="More"><MoreVertical /></button></div>
          </header>
          <div className="messages-area" onClick={() => showEmoji && setShowEmoji(false)}>
            <div className="encryption"><span>🔒</span> Messages are stored securely and visible only to chat members. Not end-to-end encrypted.</div>
            {messages.length === 0 && <div className="empty-state"><div className="empty-icon">✉</div><h2>Say hello!</h2><p>Your conversation starts here.</p></div>}
            {messages.map(m => {
              const out = m.sender_id === user.id;
              return (
                <div key={m.id} className={`message ${out ? "outgoing" : "incoming"}`}>
                  {active.isGroup && !out && <strong style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{names[m.sender_id] || ""}</strong>}
                  {m.type === "voice" && m.audio_path
                    ? <VoiceMessage path={m.audio_path} duration={m.audio_duration} />
                    : <div>{m.content}</div>}
                  <small style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {out ? <Ticks m={m} /> : null}
                  </small>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {showEmoji && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4, padding: 10,
              background: "#fff", color: "#111", borderTop: "1px solid #e5e5e5",
              maxHeight: 190, overflowY: "auto"
            }}>
              {EMOJIS.map(em => (
                <button key={em} type="button" onClick={() => addEmoji(em)}
                  style={{ fontSize: 24, background: "none", border: 0, cursor: "pointer", padding: 4, borderRadius: 8 }}>
                  {em}
                </button>
              ))}
            </div>
          )}

          {recording ? (
            <div className="composer" style={{ alignItems: "center", gap: 12 }}>
              <button type="button" title="Cancel" onClick={() => stopRecording(false)}><Trash2 /></button>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
                <span>Recording… {fmtSecs(recSecs)}</span>
              </div>
              <button className="send-button" type="button" title="Send voice message" onClick={() => stopRecording(true)}><Send size={19} /></button>
            </div>
          ) : (
            <form className="composer" onSubmit={sendMessage}>
              <button type="button" title="Emoji" onClick={() => setShowEmoji(v => !v)}><Smile /></button>
              <button type="button" title="Attach file"><Paperclip /></button>
              <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onFocus={() => setShowEmoji(false)} placeholder="Type a message" />
              {hasText
                ? <button className="send-button" type="submit" title="Send"><Send size={19} /></button>
                : <button className="send-button" type="button" title="Record voice message" onClick={startRecording}><Mic size={19} /></button>}
            </form>
          )}
        </>)}
        {notice && <div className="notice floating" onClick={() => setNotice("")}>{notice}</div>}
      </section>

      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setShowSettings(false)}>
          <div style={{ background: "#fff", color: "#111", borderRadius: 14, width: "100%", maxWidth: 420, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #e5e5e5" }}>
              <strong>Settings</strong>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: 0, cursor: "pointer", color: "#111" }}><X size={20} /></button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: 13, opacity: 0.7 }}>Display name</label>
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Your name"
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", color: "#111", background: "#fff" }} />
              <label style={{ fontSize: 13, opacity: 0.7 }}>Email</label>
              <div style={{ padding: 10, borderRadius: 8, background: "#f3f3f3" }}>{user.email}</div>
              <button onClick={saveSettings}
                style={{ padding: 10, borderRadius: 8, border: 0, background: "#25d366", color: "#fff", fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
                Save changes
              </button>
              <button onClick={signOut}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", background: "#fff", color: "#c0392b", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={closeNew}>
          <div style={{ background: "#fff", color: "#111", borderRadius: 14, width: "100%", maxWidth: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #e5e5e5" }}>
              <strong>{newMode === "direct" ? "New chat" : "New group"}</strong>
              <button onClick={closeNew} style={{ background: "none", border: 0, cursor: "pointer", color: "#111" }}><X size={20} /></button>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "10px 16px" }}>
              <button onClick={() => setNewMode("direct")} style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: newMode === "direct" ? "#d9fdd3" : "#fff", color: "#111" }}>Direct</button>
              <button onClick={() => setNewMode("group")} style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: newMode === "group" ? "#d9fdd3" : "#fff", color: "#111", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Users size={16} />Group</button>
            </div>
            {newMode === "group" && <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" style={{ margin: "0 16px 8px", padding: 10, borderRadius: 8, border: "1px solid #ccc", color: "#111", background: "#fff" }} />}
            <input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search by name or email" style={{ margin: "0 16px 8px", padding: 10, borderRadius: 8, border: "1px solid #ccc", color: "#111", background: "#fff" }} />
            <div style={{ overflowY: "auto", flex: 1, padding: "0 8px" }}>
              {results.length === 0 && <div style={{ padding: 16, opacity: 0.6, textAlign: "center" }}>No users found.</div>}
              {results.map(p => {
                const label = p.full_name || p.username || "User";
                const on = picked.includes(p.id);
                return (
                  <button key={p.id}
                    onClick={() => { if (newMode === "direct") startDirect(p.id); else setPicked(prev => on ? prev.filter(x => x !== p.id) : [...prev, p.id]); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: 0, background: on ? "#d9fdd3" : "transparent", cursor: "pointer", textAlign: "left", color: "#111", borderRadius: 8 }}>
                    <div className="avatar">{label[0].toUpperCase()}</div>
                    <span>{label}</span>
                    {newMode === "group" && on && <span style={{ marginLeft: "auto" }}>✓</span>}
                  </button>
                );
              })}
            </div>
            {newMode === "group" && (
              <div style={{ padding: 12, borderTop: "1px solid #e5e5e5" }}>
                <button onClick={createGroup} style={{ width: "100%", padding: 10, borderRadius: 8, border: 0, background: "#25d366", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Create group ({picked.length} selected)</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
  }
