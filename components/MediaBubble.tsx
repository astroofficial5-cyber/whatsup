"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Film, Pause, Play } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatBytes, signedMediaUrl } from "@/lib/media";
import type { Message } from "@/lib/types";

function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function useSignedUrl(bucket: string, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sb: any = supabase;
    if (!sb || !path) return;

    let alive = true;
    setUrl(null);
    setFailed(false);

    signedMediaUrl(sb, bucket, path).then((u: string | null) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });

    return () => {
      alive = false;
    };
  }, [bucket, path]);

  return { url, failed };
}

const BARS = 36;

// Stable pseudo-random bar heights so each voice note keeps its own "waveform".
function barsFor(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) + i;
    const r = ((h >>> 0) % 1000) / 1000;
    out.push(0.25 + r * 0.75);
  }
  return out;
}

const SPEEDS = [1, 1.5, 2];

function VoicePlayer({
  url,
  failed,
  seed,
  duration,
}: {
  url: string | null;
  failed: boolean;
  seed: string;
  duration?: number | null;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(duration || 0);
  const [speed, setSpeed] = useState(1);
  const bars = useMemo(() => barsFor(seed), [seed]);

  const progress = total > 0 ? Math.min(1, time / total) : 0;

  function toggle() {
    const a = ref.current;
    if (!a || !url) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = ref.current;
    if (!a || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let x = (e.clientX - rect.left) / rect.width;
    if (rtl) x = 1 - x;
    a.currentTime = Math.max(0, Math.min(1, x)) * total;
    setTime(a.currentTime);
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  }

  return (
    <div className="voice" dir="ltr">
      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>

      <div className="voice-main">
        <div className="voice-wave" onClick={seek}>
          {bars.map((b, i) => (
            <span
              key={i}
              className={i / BARS < progress ? "on" : ""}
              style={{ height: `${Math.round(b * 100)}%` }}
            />
          ))}
        </div>
        <div className="voice-meta">
          <span>
            {failed
              ? "Couldn't load"
              : !url
                ? "Loading…"
                : fmtSecs(Math.floor(playing || time > 0 ? time : total))}
          </span>
        </div>
      </div>

      <button type="button" className="voice-speed" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>

      {url && (
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={e => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setTotal(d);
          }}
        />
      )}
    </div>
  );
}

// Renders the attachment of a message: voice note, photo, video or document.
export default function MediaBubble({
  m,
  onOpenImage,
}: {
  m: Message;
  onOpenImage: (url: string) => void;
}) {
  const isVoice = m.type === "voice" && !!m.audio_path;
  const bucket = isVoice ? "voice" : "media";
  const path = isVoice ? m.audio_path : m.media_path;
  const { url, failed } = useSignedUrl(bucket, path);

  if (!isVoice && !path && (m.type === "image" || m.type === "video" || m.type === "file")) {
    return <div className="media-loading">🕒 This file was removed to save space</div>;
  }

  const waiting = (label: string) => (
    <div className="media-loading">{failed ? "Couldn't load this file" : label}</div>
  );

  if (isVoice) {
    return (
      <VoicePlayer
        url={url}
        failed={failed}
        seed={m.audio_path || m.id}
        duration={m.audio_duration}
      />
    );
  }

  if (m.type === "image") {
    if (!url) return waiting("Loading photo…");
    return (
      <img
        className="media-img"
        src={url}
        alt={m.media_name || "Photo"}
        onClick={() => onOpenImage(url)}
      />
    );
  }

  if (m.type === "video") {
    if (!url) {
      return (
        <div className="media-loading">
          <Film size={22} />
          {failed ? "Couldn't load this video" : "Loading video…"}
        </div>
      );
    }
    return <video className="media-video" src={url} controls preload="metadata" playsInline />;
  }

  // Document
  return (
    <a
      className="file-card"
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      download={m.media_name || undefined}
      onClick={e => {
        if (!url) e.preventDefault();
      }}
    >
      <span className="file-icon">
        <FileText size={20} />
      </span>
      <span className="file-meta">
        <span className="file-name">{m.media_name || "File"}</span>
        <span className="file-size">
          {m.media_size ? formatBytes(m.media_size) : ""}
          {failed ? " · unavailable" : ""}
        </span>
      </span>
    </a>
  );
}
