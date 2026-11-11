import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNewsForCommodity, refreshNews } from "@/lib/ipc";
import { useCrop } from "@/shell/crop";
import { PanelHeader } from "./panel-header";
import { ShowAll, useShowAll } from "./show-all";

const REFRESH_MS = 30 * 60_000;
/** Headlines listed before "Show all". */
const LISTED = 5;

/** Headlines and links only. Cached headlines show immediately while feeds refresh in the background. */
export function NewsPanel() {
  const commodity = useCrop((state) => state.crop);
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
  const { shown, all, toggle } = useShowAll(news.data ?? [], LISTED);

  return (
    <div className="workspace-panel">
      <PanelHeader title="Headlines" kind="news" />
      <ul className="compact-list">
        {shown.map((item) => (
          <li key={item.url} className="compact-row">
            <a className="compact-main" title={item.title} href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            <span className="compact-meta">{item.source} · {new Date(item.publishedAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {news.data?.length === 0 && <p className="panel-freshness">No headlines cached yet.</p>}
      <ShowAll total={news.data?.length ?? 0} limit={LISTED} all={all} onToggle={toggle} noun="headlines" />
      {refreshError && <p className="panel-freshness" data-status="error">ERROR · showing cached headlines · {refreshError}</p>}
    </div>
  );
}
