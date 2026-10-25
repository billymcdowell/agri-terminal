import { create } from "zustand";

export const LINK_GROUPS = ["A", "B", "C"] as const;

/** The next group in the cycle A, B, C, off, A... */
export function nextLinkGroup(current: string | undefined): string | undefined {
  if (!current) return LINK_GROUPS[0];
  const index = LINK_GROUPS.indexOf(current as (typeof LINK_GROUPS)[number]);
  return LINK_GROUPS[index + 1];
}

type LinkGroups = { groups: Record<string, { commodity: string }>; setCommodity: (group: string, commodity: string) => void };
export const useLinkGroups = create<LinkGroups>((set) => ({
  groups: { A: { commodity: "ZC" }, B: { commodity: "ZS" }, C: { commodity: "ZW" } },
  setCommodity: (group, commodity) => set((state) => ({ groups: { ...state.groups, [group]: { commodity } } })),
}));
