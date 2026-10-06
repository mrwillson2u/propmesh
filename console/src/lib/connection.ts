// The open USB link lives here, not in a component: switching views
// (Nodes → Yard → Nodes) or a dev hot reload unmounts and remounts the
// panel, and neither may close the port. Only Disconnect, an unplug, or
// leaving the page ends it (the browser closes ports on unload).
// Kept in its own module so editing transport.ts or the panels in dev
// doesn't reset it. The sidebar and STOP ALL read it too.
import { useSyncExternalStore } from "react";
import { target, type NodeHello, type NodeLink } from "./transport";

export interface Connection {
  link: NodeLink;
  hello: NodeHello; // the USB node's, at connect time
  // The panel's node list and selection, so coming back to the view
  // shows the boards already found instead of rediscovering them.
  roster?: unknown;
  selected?: string | null;
  // For the sidebar: nodes heard, and how many are currently missing.
  nodeCount?: number;
  missingCount?: number;
}

let current: Connection | null = null;
let version = 0;
const listeners = new Set<() => void>();

export const getConnection = () => current;

export function setConnection(c: Connection | null) {
  current = c;
  changed();
}

// Call after mutating fields of the current connection.
export function changed() {
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// Re-renders when the connection or its summary changes.
export function useConnection(): Connection | null {
  useSyncExternalStore(subscribe, () => version);
  return current;
}

// STOP ALL: every output off on every node the console knows about,
// the USB node first. Each node is asked independently so one that
// doesn't answer can't hold up the rest. Resolves with the ids that
// did not confirm.
export async function stopAll(): Promise<string[]> {
  const c = current;
  if (!c) return [];
  const roster = (c.roster ?? {}) as Record<string, { node: string; usb: boolean }>;
  const nodes = Object.values(roster);
  if (!nodes.length) nodes.push({ node: c.hello.node, usb: true });
  const results = await Promise.all(nodes.map((n) =>
    target(c.link, n.usb ? null : n.node).request("all_off")
      .then((r) => (r.ok ? null : n.node))
      .catch(() => n.node)));
  return results.filter((x): x is string => !!x);
}
