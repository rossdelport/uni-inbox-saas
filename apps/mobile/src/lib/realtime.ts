import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

// Live inbox, same mechanism as the web dashboard: the worker writes a thread
// row the moment mail is ingested, Supabase pushes that over a websocket, and
// we refetch. Authorised by the same owner-read RLS policy as the REST API.
// On a phone this matters even more than in a browser tab: the poll interval
// is the only other freshness signal and cellular connections drop often.

/** Events are coalesced over this window before one refetch goes out. A
 *  single conversation can touch the row several times as it lands (insert,
 *  then the rollup update), and a first sync lands in bursts. */
const COALESCE_MS = 150;

// Whether the postgres_changes channel is currently delivering. The polls in
// queries.ts read this each interval: 60s while realtime carries the load,
// 15s the moment it does not, so a broken socket degrades to "slightly
// slower" instead of "minutes stale".
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
        // A dropped socket is normal on mobile: the OS suspends the app, the
        // phone changes networks. Anything that arrived while we were away
        // was missed, so treat every (re)connect as a reason to catch up.
        if (status === "SUBSCRIBED") {
          setRealtimeHealthy(true);
          console.info("[oneinbox] realtime subscribed: live inbox updates on");
          refresh();
        } else {
          // Say so out loud instead of degrading silently; this channel has
          // failed silently before (a missing SELECT grant). Any
          // non-subscribed state flips the polls to their fast fallback.
          setRealtimeHealthy(false);
          console.warn(
            `[oneinbox] realtime ${status}${err ? `: ${err.message}` : ""}. ` +
              "Falling back to 15s polling until it recovers.",
          );
        }
      });

    return () => {
      clearTimeout(timer);
      setRealtimeHealthy(false);
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
