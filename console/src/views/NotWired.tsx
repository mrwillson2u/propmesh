// Shown in place of a view that has no real data source yet, when demo
// data is off — instead of an empty canvas that looks broken.
import { C } from "../lib/tokens";
import { useSettings } from "../lib/settings";
import { sys } from "../ui";

export default function NotWired({ title, children }: { title: string; children: React.ReactNode }) {
  const { setDemo } = useSettings();
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={sys(700, 15, C.t1)}>{title}</div>
        <div style={{ ...sys(400, 12.5, C.t3), marginTop: 8, lineHeight: 1.55 }}>{children}</div>
        <button onClick={() => setDemo(true)}
          style={{ marginTop: 16, height: 32, padding: "0 14px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>
          Preview with demo data
        </button>
        <div style={{ ...sys(400, 11, C.t5), marginTop: 8 }}>Turn it off again in Settings.</div>
      </div>
    </div>
  );
}
