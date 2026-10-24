import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App, { MarketOverview } from "./App";
import { queryClient } from "@/state/query-client";
import { startLinkGroupSync } from "@/workspace/link-sync";
import { PopoutRoot } from "@/workspace/popout-app";
import { readPopout } from "@/workspace/popout";
import "./App.css";
import "./terminal.css";

const popout = readPopout(window.location.search);
if (!popout) startLinkGroupSync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {popout ? (
      <PopoutRoot initial={popout} Market={MarketOverview} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
