import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App, { MarketOverview } from "./App";
import { queryClient } from "@/state/query-client";
import { startCropSync } from "@/workspace/crop";
import { PopoutRoot } from "@/workspace/popout-app";
import { readPopout } from "@/workspace/popout";
import { initTheme } from "@/lib/theme";
import "./App.css";
import "./theme.css";
import "./terminal.css";

initTheme();
const popout = readPopout(window.location.search);
if (!popout) startCropSync();

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
