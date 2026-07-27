import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Session state for the whole app. AsyncStorage restore is async, so there is
// a real "still checking" window on cold start; `loading` covers it so the
// router does not flash the sign-in screen at someone who is signed in.

interface SessionState {
  session: Session | null;
  loading: boolean;
}

const Ctx = createContext<SessionState>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  return useContext(Ctx);
}
