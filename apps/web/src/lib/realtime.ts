import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase.js";

// Live inbox. The worker writes a thread row the moment mail is ingested;
// Supabase pushes that straight to the browser over a websocket, and we
// refetch. The subscription is authorised by the same owner-read RLS policy
// the REST API relies on, so a user can only ever be woken by their own mail.
//
// Why this matters more than shaving the poll interval: React Query skips a
// refetchInterval tick while the tab is unfocused (queryObserver only fetches
// when focused, unless refetchIntervalInBackground is set). So on a background
// tab the inbox went completely quiet, and with it the "(3) OneInbox" tab
// badge, which is precisely when that badge is the only thing a user can see.
// A websocket keeps delivering while the tab is in the background, so the
// count moves without them switching to look.

/** Events are coalesced over this window before one refetch goes out. A
 *  single conversation can touch the row several times as it lands (insert,
 *  then the rollup update), and a first sync lands in bursts. */
const COALESCE_MS = 150;

// Whether the postgres_changes channel is currently delivering. The polls in
// queries.ts read this each interval: 60s while realtime carries the load,
// 15s the moment it does not, so a broken socket degrades to "slightly slower"
// instead of "minutes stale", visibly logged either way.
let healthy = false;
function setRealtimeHealthy(v: boolean): void {
  healthy = v;
}
export function realtimeHealthy(): boolean {
  return healthy;
}

export function useRealtimeInbox(userId: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Invalidate rather than patch the cache by hand: the server owns
        // sorting, unread rollups and pagination, and duplicating that here
        // is how the two drift apart. This is a nudge, not a data channel.
        void qc.invalidateQueries({ queryKey: ["inbox"] });
        void qc.invalidateQueries({ queryKey: ["accounts"] });
        void qc.invalidateQueries({ queryKey: ["unread-counts"] });
      }, COALESCE_MS);
    };

    const channel = supabase
      .channel(`inbox:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "uni_inbox",
          table: "threads",
          filter: `owner_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe((status, err) => {
        // A dropped socket is normal: browsers freeze long-backgrounded tabs
        // and laptops sleep. Anything that arrived while we were away was
        // missed, so treat every (re)connect as a reason to catch up.
        if (status === "SUBSCRIBED") {
          setRealtimeHealthy(true);
          console.info("[oneinbox] realtime subscribed: live inbox updates on");
          refresh();
        } else {
          // Say so out loud instead of degrading silently. This channel
          // already failed silently once (a missing SELECT grant: the socket
          // connected, subscribed, and delivered nothing), and it was only
          // found by auditing the database. Never again: any non-subscribed
          // state is logged and flips the polls to their fast fallback.
          setRealtimeHealthy(false);
          console.warn(
            `[oneinbox] realtime ${status}${err ? `: ${err.message}` : ""}. ` +
              "Falling back to 15s polling until it recovers.",
          );
        }
      });

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
