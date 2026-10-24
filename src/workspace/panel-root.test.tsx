import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { panelRootContent } from "./panel-root";

function QueryClientProbe() {
  const client = useQueryClient();
  return <span>{client.getQueryCache() ? "query provider ready" : "missing"}</span>;
}

describe("dockview panel root", () => {
  it("provides the shared query client to content mounted in an independent root", () => {
    const client = new QueryClient();
    const markup = renderToStaticMarkup(panelRootContent(client, <QueryClientProbe />));
    expect(markup).toContain("query provider ready");
    client.clear();
  });
});
