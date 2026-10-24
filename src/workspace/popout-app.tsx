import { useEffect, useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerBuiltInPanels, type MarketComponent } from "@/panels/register";
import { queryClient } from "@/state/query-client";
import { startLinkGroupSync } from "./link-sync";
import { getPanel } from "./registry";
import type { PanelApiLike, PanelParams } from "./types";
import { useDataUpdateInvalidation } from "./use-workspace-effects";

/** A single panel in its own window. It reads the same local database and shares link groups through events. */
export function PopoutApp({ initial, Market }: { initial: PanelParams; Market: MarketComponent }) {
  registerBuiltInPanels(Market);
  useDataUpdateInvalidation();
  const [params, setParams] = useState(initial);
  useEffect(() => startLinkGroupSync(), []);
  const api = useMemo<PanelApiLike>(() => ({
    setTitle: (title) => { document.title = title; },
    updateParameters: (next) => setParams((current) => ({ ...current, ...next }) as PanelParams),
  }), []);
  const definition = getPanel(params.kind);
  useEffect(() => { document.title = definition?.title ?? "AgriTerminal"; }, [definition]);
  if (!definition) return <p>Unknown panel type “{params.kind}”.</p>;
  const Component = definition.component;
  return (
    <div className="workspace-shell dark" style={{ display: "block" }}>
      <Component api={api} params={params} />
    </div>
  );
}

export function PopoutRoot(props: { initial: PanelParams; Market: MarketComponent }) {
  return <QueryClientProvider client={queryClient}><PopoutApp {...props} /></QueryClientProvider>;
}
