import { useEffect, useState } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
  useRouteError,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase.js";
import { Login } from "./pages/Login.js";
import { Layout } from "./components/Layout.js";
import { Inbox } from "./pages/Inbox.js";
import { ThreadView } from "./pages/ThreadView.js";
import { Compose } from "./pages/Compose.js";
import { Accounts } from "./pages/Accounts.js";
import { Billing } from "./pages/Billing.js";

function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <p className="text-lg font-semibold">Something broke</p>
        <p className="mt-2 text-sm text-zinc-500">{message}</p>
        <button className="btn mt-4" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />} errorElement={<RouteError />}>
      <Route errorElement={<RouteError />}>
        <Route index element={<Inbox />} />
        <Route path="/archived" element={<Inbox archived />} />
        <Route path="/t/:threadId" element={<ThreadView />} />
        <Route path="/compose" element={<Compose />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>,
  ),
);

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="grid h-screen place-items-center text-zinc-400">Loading…</div>;
  }
  if (!session) return <Login />;
  return <RouterProvider router={router} />;
}
