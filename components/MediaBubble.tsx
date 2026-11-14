"use client";

import { useEffect, useState } from "react";
import { FileText, Film } from "lucide-react";
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

  const waiting = (label: string) => (
    <div className="media-loading">{failed ? "Couldn't load this file" : label}</div>
  );

  if (isVoice) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220 }}>
        {url ? (
          <audio controls preload="metadata" src={url} style={{ height: 36, maxWidth: 240 }} />
        ) : (
          <span style={{ opacity: 0.7, fontSize: 13 }}>
            {failed ? "Couldn't load voice message" : "Loading voice message…"}
          </span>
        )}
        {m.audio_duration ? <small>{fmtSecs(m.audio_duration)}</small> : null}
      </div>
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
