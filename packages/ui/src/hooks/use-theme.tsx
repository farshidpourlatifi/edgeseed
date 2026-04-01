import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Mode = "dark" | "light" | "system";

type ThemeProviderState = {
  mode: Mode;
  resolvedMode: "dark" | "light";
  setMode: (mode: Mode) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState>({
  mode: "system",
  resolvedMode: "light",
  setMode: () => null,
});

export function useTheme() {
  return useContext(ThemeProviderContext);
}

function setCookie(key: string, value: string) {
  document.cookie = `${key}=${value}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
}

function getCookie(key: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(new RegExp(`${key}=([^;]+)`))?.[1];
}

function getResolvedMode(mode: Mode): "dark" | "light" {
  if (mode === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

function applyMode(mode: Mode) {
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(getResolvedMode(mode));
}

export function ThemeProvider({
  children,
  defaultMode = "system",
}: {
  children: ReactNode;
  defaultMode?: Mode;
}) {
  const [mode, setModeState] = useState<Mode>(defaultMode);
  const [resolvedMode, setResolvedMode] = useState<"dark" | "light">(
    getResolvedMode(defaultMode),
  );

  // Read from cookie on mount
  useEffect(() => {
    const savedMode = getCookie("theme") as Mode | undefined;
    if (savedMode) {
      setModeState(savedMode);
      applyMode(savedMode);
      setResolvedMode(getResolvedMode(savedMode));
    } else {
      applyMode(defaultMode);
    }
  }, []);

  // React to mode changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    applyMode(mode);
    setResolvedMode(getResolvedMode(mode));
  }, [mode]);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") {
        applyMode("system");
        setResolvedMode(getResolvedMode("system"));
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  // Keyboard shortcut: press 'd' to toggle dark/light
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "d") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      const newMode = resolvedMode === "dark" ? "light" : "dark";
      setCookie("theme", newMode);
      setModeState(newMode);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resolvedMode]);

  const value: ThemeProviderState = {
    mode,
    resolvedMode,
    setMode: (newMode: Mode) => {
      setCookie("theme", newMode);
      setModeState(newMode);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
  );
}
