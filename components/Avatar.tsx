"use client";

export default function Avatar({
  label,
  url,
  className = "avatar",
  online,
}: {
  label: string;
  url?: string | null;
  className?: string;
  online?: boolean;
}) {
  return (
    <div className={className}>
      {url ? <img src={url} alt={label} loading="lazy" /> : (label[0] || "W").toUpperCase()}
      {online ? <i /> : null}
    </div>
  );
}
