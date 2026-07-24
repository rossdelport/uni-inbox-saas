import { useEffect, useState } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
  useParams,
  useRouteError,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase.js";
import { Login } from "./pages/Login.js";
import { Layout } from "./components/Layout.js";
import { Inbox } from "./pages/Inbox.js";
import { Compose } from "./pages/Compose.js";
import { Accounts } from "./pages/Accounts.js";
import { Billing } from "./pages/Billing.js";
import { Settings } from "./pages/Settings.js";

function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>Something broke</p>
        <p style={{ marginTop: 8, fontSize: 13.5 }}>{message}</p>
        <button
          className="btn-black"
          style={{ width: "auto", padding: "0 26px", height: 42, fontSize: 14, margin: "16px auto 0" }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

// Old /t/:threadId links resolve to the query-param form.
function ThreadRedirect() {
  const { threadId } = useParams();
  return <Navigate to={`/?t=${threadId}`} replace />;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />} errorElement={<RouteError />}>
      <Route errorElement={<RouteError />}>
        <Route index element={<Inbox />} />
        <Route path="/starred" element={<Inbox view="starred" />} />
        <Route path="/later" element={<Inbox view="later" />} />
        <Route path="/archived" element={<Inbox view="archived" />} />
        <Route path="/deleted" element={<Inbox view="deleted" />} />
        <Route path="/t/:threadId" element={<ThreadRedirect />} />
        <Route path="/compose" element={<Compose />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>,
  ),
  { basename: "/app" },
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
    return (
      <div className="empty-state" style={{ height: "100vh" }}>
        <div>Loading…</div>
      </div>
    );
  }
  if (!session) return <Login />;
  return <RouterProvider router={router} />;
}
