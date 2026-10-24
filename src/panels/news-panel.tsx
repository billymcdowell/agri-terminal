import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getNewsForCommodity, refreshNews } from "@/lib/ipc";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader, usePanelCommodity } from "./panel-header";

const REFRESH_MS = 30 * 60_000;

/** Headlines and links only. Cached headlines show immediately while feeds refresh in the background. */
export function NewsPanel({ api, params }: PanelComponentProps) {
  const { commodity, change } = usePanelCommodity(params, api);
  const queryClient = useQueryClient();
  const news = useQuery({ queryKey: ["news", commodity], queryFn: () => getNewsForCommodity(commodity) });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => refreshNews(commodity)
      .then(() => !cancelled && setRefreshError(null))
      .catch((error) => !cancelled && setRefreshError(String(error)))
      .finally(() => !cancelled && void queryClient.invalidateQueries({ queryKey: ["news", commodity] }));
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [commodity, queryClient]);

  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="MARKET NEWS" title={`${commodity} headlines`} api={api} params={params} commodity={commodity} onCommodityChange={change} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Recent headlines · headlines and links only</CardTitle></CardHeader>
        <CardContent>
          <div className="news-list">
            {news.data?.map((item) => (
              <article className="news-item" key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                <div className="news-meta">{item.source} · {new Date(item.publishedAt).toLocaleString()}</div>
              </article>
            ))}
            {news.data?.length === 0 && <p className="panel-freshness">No headlines cached yet.</p>}
          </div>
          <p className="panel-freshness" data-status={refreshError ? "error" : "ok"}>
            {refreshError ? `ERROR · showing cached headlines · ${refreshError}` : "Headlines from GDELT and USDA NASS RSS feeds. Open the source to read the full article."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
