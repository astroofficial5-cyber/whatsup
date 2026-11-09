 "use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, MessageSquarePlus, MoreVertical, Paperclip, Smile, Send,
  CheckCheck, Phone, Video, Menu, ArrowLeft, LogOut, UserRound, Image as ImageIcon
} from "lucide-react";

type Profile = { id: string; username: string; full_name: string | null; avatar_url: string | null; };
type Chat = { id: string; title: string; subtitle: string; avatar: string; time: string; unread: number; online?: boolean; };
type Message = { id: string; chat_id: string; sender_id: string; content: string; created_at: string; };

const demoChats: Chat[] = [
  { id: "demo-1", title: "Mariam", subtitle: "وصلت البيت؟", avatar: "M", time: "10:42", unread: 2, online: true },
  { id: "demo-2", title: "Ahmed", subtitle: "تمام يا صاحبي 👌", avatar: "A", time: "09:18", unread: 0 },
  { id: "demo-3", title: "Family Group", subtitle: "أمي: ربنا يحفظكم ❤️", avatar: "F", time: "أمس", unread: 0 },
  { id: "demo-4", title: "Work Team", subtitle: "You: تم، شكرًا", avatar: "W", time: "أمس", unread: 0 },
  { id: "demo-5", title: "Omar", subtitle: "صورة", avatar: "O", time: "الثلاثاء", unread: 0 },
];

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>(demoChats);
  const [active, setActive] = useState<Chat>(demoChats[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }) => { if (data) setProfile(data); });
    loadChats();
  }, [user]);

  async function loadChats() {
    if (!supabase || !user) return;
    const { data } = await supabase.from("chat_members").select("chat_id, chats(id, name, is_group)").eq("user_id", user.id);
    if (data?.length) {
      const mapped = data.map((row: any, i: number) => ({
        id: row.chat_id, title: row.chats?.name || `Conversation ${i + 1}`,
        subtitle: "ابدأ المحادثة", avatar: (row.chats?.name || "W")[0].toUpperCase(),
        time: "", unread: 0
      }));
      setChats(mapped); setActive(mapped[0]);
    }
  }

  useEffect(() => {
    if (!supabase || !user || active.id.startsWith("demo-")) {
      setMessages([]);
      return;
    }
    let alive = true;
    supabase.from("messages").select("*").eq("chat_id", active.id).order("created_at", { ascending: true })
      .then(({ data }) => { if (alive && data) setMessages(data); });
    const channel = supabase.channel(`messages-${active.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${active.id}` },
        (payload) => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe();
    return () => { alive = false; supabase?.removeChannel(channel); };
  }, [active.id, user]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function authenticate(e: React.FormEvent) {
    e.preventDefault(); setNotice("");
    if (!supabase) { setNotice("اربط المشروع بـ Supabase أولًا من ملف .env.local."); return; }
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setNotice(result.error.message);
    else if (authMode === "signup") setNotice("تم إنشاء الحساب. افحص بريدك لتأكيده إذا كان تأكيد البريد مفعّلًا.");
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (!supabase || !user || active.id.startsWith("demo-")) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), chat_id: active.id, sender_id: "me", content, created_at: new Date().toISOString() }]);
      setDraft(""); return;
    }
    const { error } = await supabase.from("messages").insert({ chat_id: active.id, sender_id: user.id, content });
    if (error) setNotice(error.message);
    else setDraft("");
  }

  async function signOut() { await supabase?.auth.signOut(); setUser(null); setProfile(null); }

  const filtered = useMemo(() => chats.filter(c => c.title.toLowerCase().includes(query.toLowerCase())), [chats, query]);
  const connected = Boolean(supabase);

  if (!user && connected) return (
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
        <button className="text-button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
          {authMode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </div>
    </main>
  );

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileChat ? "hide-mobile" : ""}`}>
        <header className="sidebar-header">
          <div className="brand"><span className="brand-mark small">w</span><span>Whatsup</span></div>
          <div className="header-actions">
            <button title="New chat"><MessageSquarePlus /></button>
            <button title="Menu" onClick={signOut}><LogOut /></button>
          </div>
        </header>
        <div className="search-wrap"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search or start a new chat"/></div>
        <div className="filters"><button className="filter active">All</button><button className="filter">Unread</button><button className="filter">Favorites</button><button className="filter">Groups</button></div>
        <div className="chat-list">
          {filtered.map(chat => <button key={chat.id} className={`chat-row ${active.id === chat.id ? "selected" : ""}`} onClick={() => {setActive(chat);setMobileChat(true);}}>
            <div className="avatar">{chat.avatar}{chat.online && <i/>}</div>
            <div className="chat-info"><div className="chat-top"><strong>{chat.title}</strong><time>{chat.time}</time></div><div className="chat-bottom"><span>{chat.subtitle}</span>{chat.unread > 0 && <b>{chat.unread}</b>}</div></div>
          </button>)}
        </div>
        <footer className="sidebar-footer"><div className="avatar self"><UserRound size={19}/></div><div><strong>{profile?.full_name || user?.email || "Guest"}</strong><small>{user ? "Online" : "Preview mode"}</small></div><button onClick={signOut} title="Sign out"><LogOut size={18}/></button></footer>
      </aside>

      <section className={`conversation ${!mobileChat ? "hide-mobile" : ""}`}>
        <header className="conversation-header">
          <button className="back-button" onClick={() => setMobileChat(false)}><ArrowLeft/></button>
          <div className="avatar">{active.avatar}</div>
          <div className="contact"><strong>{active.title}</strong><small>{active.online ? "online" : "tap here for contact info"}</small></div>
          <div className="header-actions"><button title="Video call"><Video/></button><button title="Voice call"><Phone/></button><button title="More"><MoreVertical/></button></div>
        </header>
        <div className="messages-area">
          <div className="encryption"><span>🔒</span> Messages are private and secure. This demo is not end-to-end encrypted.</div>
          {messages.length === 0 && <div className="empty-state"><div className="empty-icon">✉</div><h2>Say hello!</h2><p>Your conversation starts here.</p></div>}
          {messages.map(message => <div key={message.id} className={`message ${message.sender_id === "me" || message.sender_id === user?.id ? "outgoing" : "incoming"}`}>
            <div>{message.content}</div><small>{new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} {message.sender_id === "me" || message.sender_id === user?.id ? <CheckCheck size={14}/> : null}</small>
          </div>)}
          <div ref={bottomRef}/>
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <button type="button" title="Emoji"><Smile/></button><button type="button" title="Attach file"><Paperclip/></button>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Type a message" />
          <button className="send-button" type="submit" title="Send"><Send size={19}/></button>
        </form>
        {notice && <div className="notice floating">{notice}</div>}
      </section>
    </main>
  );
}
