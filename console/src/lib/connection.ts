// The open USB link lives here, not in a component: switching views
// (Nodes → Yard → Nodes) or a dev hot reload unmounts and remounts the
// panel, and neither may close the port. Only Disconnect, an unplug, or
// leaving the page ends it (the browser closes ports on unload).
// Kept in its own module so editing transport.ts or the panels in dev
// doesn't reset it.
import type { NodeHello, NodeLink } from "./transport";

export interface Connection {
  link: NodeLink;
  hello: NodeHello; // the USB node's, at connect time
  // The panel's node list and selection, so coming back to the view
  // shows the boards already found instead of rediscovering them.
  roster?: unknown;
  selected?: string | null;
}

let current: Connection | null = null;

export const getConnection = () => current;
export const setConnection = (c: Connection | null) => { current = c; };
