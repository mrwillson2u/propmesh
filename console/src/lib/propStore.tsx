// Which prop each node drives. Seeded from the node model (what the
// bridge reports) and editable at runtime from Nodes & Channels — it is
// node config, so it lives in one place both the yard and the fleet
// table read.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { NODES } from "./mesh";
import type { PropType } from "./propIcons";

interface Store {
  get: (nodeId: string) => PropType;
  set: (nodeId: string, type: PropType) => void;
}

const Ctx = createContext<Store>({ get: () => "generic", set: () => {} });

export function PropStore({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, PropType>>(() =>
    Object.fromEntries(NODES.map((n) => [n.id, n.prop])),
  );
  const value = useMemo<Store>(
    () => ({
      get: (id) => map[id] ?? "generic",
      set: (id, type) => setMap((m) => ({ ...m, [id]: type })),
    }),
    [map],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProps = () => useContext(Ctx);
