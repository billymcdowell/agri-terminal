import { useState } from "react";
import { Button } from "@/components/ui/button";

/** The first `limit` items, or all of them once the user asks. */
export function useShowAll<T>(items: T[], limit: number) {
  const [all, setAll] = useState(false);
  return { shown: all ? items : items.slice(0, limit), all, toggle: () => setAll((value) => !value) };
}

/** "Show all 12 moves" under a shortened list, and "Show fewer" once expanded. Nothing when the list is short. */
export function ShowAll({ total, limit, all, onToggle, noun }: { total: number; limit: number; all: boolean; onToggle: () => void; noun: string }) {
  if (total <= limit) return null;
  return <Button size="xs" variant="ghost" className="show-all" aria-expanded={all} onClick={onToggle}>{all ? "Show fewer" : `Show all ${total} ${noun}`}</Button>;
}
