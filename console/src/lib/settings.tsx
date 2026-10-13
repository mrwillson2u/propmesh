// Console settings, remembered per browser. Only one so far.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface Settings {
  // The design handoff's mock yard (lib/mesh.ts): eight fake nodes,
  // banners, cues. Useful to preview views not yet wired to real
  // boards; off by default so it is never mistaken for them.
  demo: boolean;
  setDemo: (on: boolean) => void;
}

const KEY = "propmesh.settings.demo";

function stored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

const Ctx = createContext<Settings>({ demo: false, setDemo: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [demo, set] = useState(stored);
  const value = useMemo<Settings>(() => ({
    demo,
    setDemo: (on) => {
      set(on);
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
    },
  }), [demo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
