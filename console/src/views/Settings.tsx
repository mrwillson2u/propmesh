// Console settings. Kept to what a user actually needs to change.
import { C } from "../lib/tokens";
import { useSettings } from "../lib/settings";
import { Toggle, mono, sys } from "../ui";

export default function Settings() {
  const { demo, setDemo } = useSettings();
  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", background: C.bg, padding: "20px 24px" }}>
      <div style={{ ...sys(700, 16, C.t1), marginBottom: 16 }}>Settings</div>
      <div style={{ maxWidth: 640, display: "flex", alignItems: "flex-start", gap: 14, padding: 14, background: C.panel, border: `1px solid ${C.b1}`, borderRadius: 8 }}>
        <div style={{ paddingTop: 2 }}><Toggle on={demo} onClick={() => setDemo(!demo)} /></div>
        <div>
          <div style={sys(700, 13, C.t1)}>Show demo data</div>
          <div style={{ ...sys(400, 12, C.t3), marginTop: 4, lineHeight: 1.5 }}>
            Fills the Yard, Cues and Show Graph views, and the fleet table in Nodes &amp; Channels, with
            an imaginary eight-node yard from the original design. Useful for previewing views that
            aren't connected to real boards yet. Your real boards are never mixed into it, and it
            never sends anything to them.
          </div>
          <div style={{ ...mono(500, 11, C.t5), marginTop: 8 }}>Remembered in this browser.</div>
        </div>
      </div>
    </div>
  );
}
