// Helpers for uploading images, videos and documents.
// Limits are enforced twice: here (friendly messages, image compression) and by
// the Supabase storage buckets (see supabase/migrations/2026-11-14_*.sql).

export type MediaKind = "image" | "video" | "file";

export const MB = 1024 * 1024;

// Maximum size of what the user picks. Photos are shrunk before upload, so what is
// actually stored is usually well under 1 MB.
export const MAX_BYTES: Record<MediaKind, number> = {
  image: 10 * MB,
  video: 16 * MB,
  file: 10 * MB,
};
export const MAX_GIF_BYTES = 6 * MB;

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ACCEPT_MEDIA =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
export const ACCEPT_FILES =
  ".pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

export type FileInfo = { mime: string; ext: string; kind: MediaKind };

// Works out the real type from the file extension, because browsers report odd types
// for some files (for example .csv or .zip on Windows).
export function describeFile(file: File): FileInfo | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const mime = EXT_MIME[ext];
  if (!mime) return null;
  const kind: MediaKind = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : "file";
  return { mime, ext, kind };
}

// Returns an error message, or null when the file is fine to send.
export function validateMedia(file: File): string | null {
  const d = describeFile(file);
  if (!d) return "This file type isn't supported.";
  if (file.size === 0) return "This file is empty.";
  const limit = d.mime === "image/gif" ? MAX_GIF_BYTES : MAX_BYTES[d.kind];
  if (file.size > limit) {
    return `This ${d.kind === "file" ? "file" : d.kind} is too big (${formatBytes(file.size)}). The limit is ${formatBytes(limit)}.`;
  }
  return null;
}

export type CompressedImage = { blob: Blob; mime: string; ext: string };

// Shrinks an image to at most maxSide pixels on its longest side and re-encodes it as JPEG.
export async function compressImage(
  file: File,
  maxSide: number,
  quality: number
): Promise<CompressedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read this image. Please try a JPG, PNG or WebP file.");
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Image processing isn't supported in this browser.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) throw new Error("Could not process this image.");

  return { blob, mime: "image/jpeg", ext: "jpg" };
}

// Uploads a profile picture or wallpaper to the public "avatars" bucket and returns its URL.
// The path must start with the user's own id (the storage policy enforces it).
export async function uploadPublicImage(
  sb: any,
  path: string,
  file: File,
  maxSide: number
): Promise<string> {
  const d = describeFile(file);
  if (!d || d.kind !== "image" || d.mime === "image/gif") {
    throw new Error("Please choose a JPG, PNG or WebP image.");
  }
  if (file.size > MAX_BYTES.image) {
    throw new Error(
      `This image is too big (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_BYTES.image)}.`
    );
  }

  const out = await compressImage(file, maxSide, 0.85);
  if (out.blob.size > 2.5 * MB) {
    throw new Error("This image is still too large after compression. Please pick a smaller one.");
  }

  const up = await sb.storage
    .from("avatars")
    .upload(path, out.blob, { contentType: out.mime, upsert: true, cacheControl: "3600" });
  if (up.error) throw new Error(up.error.message);

  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Signed URLs for private files, cached so scrolling does not request them again and again.
const urlCache = new Map<string, { url: string; exp: number }>();

export async function signedMediaUrl(
  sb: any,
  bucket: string,
  path: string
): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now() + 60000) return hit.url;

  const { data } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (!data || !data.signedUrl) return null;

  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 3600 * 1000 });
  return data.signedUrl as string;
}
