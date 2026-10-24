import { emit, listen } from "@tauri-apps/api/event";
import { useLinkGroups } from "./link-groups";

type LinkEvent = { group: string; commodity: string };
const EVENT = "link-group-changed";

/** Mirrors link-group changes across windows so a pop-out follows the main workspace and vice versa. */
export function startLinkGroupSync(): () => void {
  let applyingRemote = false;
  let stopListening: (() => void) | undefined;
  let stopped = false;
  listen<LinkEvent>(EVENT, ({ payload }) => {
    applyingRemote = true;
    useLinkGroups.getState().setCommodity(payload.group, payload.commodity);
    applyingRemote = false;
  }).then((unlisten) => { if (stopped) unlisten(); else stopListening = unlisten; }).catch(() => undefined);
  const unsubscribe = useLinkGroups.subscribe((state, previous) => {
    if (applyingRemote) return;
    for (const [group, value] of Object.entries(state.groups)) {
      if (previous.groups[group]?.commodity !== value.commodity) void emit(EVENT, { group, commodity: value.commodity } satisfies LinkEvent).catch(() => undefined);
    }
  });
  return () => { stopped = true; unsubscribe(); stopListening?.(); };
}
