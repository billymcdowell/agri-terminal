import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSeries, listSources, subscribeToDataUpdates } from "@/lib/ipc";

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
  return useQuery({ queryKey: ["sources"], queryFn: listSources });
}
