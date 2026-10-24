import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

export function panelRootContent(client: QueryClient, content: ReactNode) {
  return <QueryClientProvider client={client}>{content}</QueryClientProvider>;
}
