import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSeries,
  getMetricSeries,
  listSources,
  subscribeToDataUpdates,
  subscribeToSourceStatus,
} from "@/lib/ipc";

export function useSeries(seriesId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => getSeries(seriesId),
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToDataUpdates((seriesIds) => {
      if (seriesIds.includes(seriesId)) {
        void queryClient.invalidateQueries({ queryKey: ["series", seriesId] });
      }
    })
      .then((stopListening) => {
        if (cancelled) stopListening();
        else unlisten = stopListening;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient, seriesId]);

  return query;
}

export function useSources() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["sources"], queryFn: listSources });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToSourceStatus(() => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    })
      .then((stopListening) => {
        if (cancelled) stopListening();
        else unlisten = stopListening;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return query;
}

/** Refetches river panels when any river series or price changes. */
export function useRiverUpdates() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToDataUpdates((seriesIds) => {
      if (seriesIds.some((id) => id.startsWith("river.") || id.startsWith("price."))) {
        void queryClient.invalidateQueries({ queryKey: ["river-status"] });
        void queryClient.invalidateQueries({ queryKey: ["river-timeline"] });
      }
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); };
  }, [queryClient]);
}

export function useMetricSeries(seriesId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["metric-series", seriesId],
    queryFn: () => getMetricSeries(seriesId),
    staleTime: 60_000,
  });
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToDataUpdates((seriesIds) => {
      if (seriesIds.includes(seriesId)) void queryClient.invalidateQueries({ queryKey: ["metric-series", seriesId] });
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); };
  }, [queryClient, seriesId]);
  return query;
}
