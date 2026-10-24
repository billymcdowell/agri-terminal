import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetting, setSetting } from "@/lib/ipc";

/** A JSON value kept in the local settings table, with optimistic updates. The third value is true once the stored value has been read. */
export function usePersistedValue<T>(key: string, fallback: T) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["setting", key],
    queryFn: async () => {
      const raw = await getSetting(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    },
    staleTime: Infinity,
  });
  const update = useCallback((next: T) => {
    queryClient.setQueryData(["setting", key], next);
    void setSetting(key, JSON.stringify(next)).catch(() => queryClient.invalidateQueries({ queryKey: ["setting", key] }));
  }, [key, queryClient]);
  return [query.data ?? fallback, update, query.isSuccess] as const;
}
