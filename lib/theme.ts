// Theme (light / dark / system) and chat wallpapers.

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "whatsup-theme";

export function loadTheme(): ThemeMode {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage blocked: fall back to the system theme
  }
  return "system";
}

export function saveTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    // ignore
  }
}

export function isDarkFor(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// Applies the theme to the page and returns whether it is dark.
export function applyTheme(mode: ThemeMode): boolean {
  const dark = isDarkFor(mode);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  return dark;
}

export type WallpaperStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
};

export type Wallpaper = {
  id: string;
  label: string;
  light: Partial<WallpaperStyle>;
  dark: Partial<WallpaperStyle>;
};

const DOTS: Partial<WallpaperStyle> = {
  backgroundColor: "var(--chat-bg)",
  backgroundImage: "radial-gradient(var(--chat-dot) 0.7px, transparent 0.7px)",
  backgroundSize: "18px 18px",
};

const PLAIN: Partial<WallpaperStyle> = { backgroundColor: "var(--chat-bg)" };

function solid(light: string, dark: string): Pick<Wallpaper, "light" | "dark"> {
  return { light: { backgroundColor: light }, dark: { backgroundColor: dark } };
}

function gradient(light: string, dark: string): Pick<Wallpaper, "light" | "dark"> {
  return { light: { backgroundImage: light }, dark: { backgroundImage: dark } };
}

export const WALLPAPERS: Wallpaper[] = [
  { id: "default", label: "Classic", light: DOTS, dark: DOTS },
  { id: "plain", label: "Plain", light: PLAIN, dark: PLAIN },
  { id: "mint", label: "Mint", ...solid("#dcf1e8", "#10302a") },
  { id: "sky", label: "Sky", ...solid("#dbeaf5", "#0f2535") },
  { id: "sand", label: "Sand", ...solid("#f1e6d3", "#2b241a") },
  { id: "rose", label: "Rose", ...solid("#f6dde3", "#33191f") },
  { id: "lavender", label: "Lavender", ...solid("#e4def5", "#221b38") },
  {
    id: "sunset",
    label: "Sunset",
    ...gradient(
      "linear-gradient(135deg,#ffd9b8,#f7b2c4)",
      "linear-gradient(135deg,#3b2433,#1e2b4a)"
    ),
  },
  {
    id: "ocean",
    label: "Ocean",
    ...gradient(
      "linear-gradient(135deg,#b8e6f2,#b6c9f5)",
      "linear-gradient(135deg,#0f2f3a,#1b2450)"
    ),
  },
  {
    id: "forest",
    label: "Forest",
    ...gradient(
      "linear-gradient(160deg,#cfe8c9,#9ccfb4)",
      "linear-gradient(160deg,#10281a,#0d3a30)"
    ),
  },
  { id: "midnight", label: "Midnight", ...solid("#1f2c33", "#05090c") },
];

const BASE: WallpaperStyle = {
  backgroundColor: "var(--chat-bg)",
  backgroundImage: "none",
  backgroundSize: "auto",
  backgroundPosition: "center",
};

// Turns a stored wallpaper value (a preset id, or "url:https://...") into CSS properties.
export function wallpaperStyle(
  value: string | null | undefined,
  dark: boolean
): WallpaperStyle {
  if (value && value.startsWith("url:")) {
    const url = value.slice(4);
    // Only plain https URLs are allowed, so a stored value can never inject other CSS.
    if (/^https:\/\/[^\s"'()\\]+$/.test(url)) {
      return {
        backgroundColor: "var(--chat-bg)",
        backgroundImage: `url("${url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
  }

  const preset = WALLPAPERS.find(w => w.id === value) || WALLPAPERS[0];
  return { ...BASE, ...(dark ? preset.dark : preset.light) };
}
