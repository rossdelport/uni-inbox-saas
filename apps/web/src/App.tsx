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
import { claimPendingCheckout } from "./lib/checkout.js";
import { Login } from "./pages/Login.js";
import { Layout } from "./components/Layout.js";
import { Inbox } from "./pages/Inbox.js";
import { Compose } from "./pages/Compose.js";
import { Accounts } from "./pages/Accounts.js";
import { Billing } from "./pages/Billing.js";
import { Settings } from "./pages/Settings.js";
import { ResetPassword } from "./pages/ResetPassword.js";
import { Users } from "./pages/Users.js";

function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>Something broke</p>
        <p style={{ marginTop: 8, fontSize: 13.5 }}>{message}</p>
        <button
          className="btn-black btn-auto"
          style={{ margin: "16px auto 0" }}
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
    <Route errorElement={<RouteError />}>
      {/* Outside the dashboard shell on purpose: this is reached from a
          recovery email, before the user has chosen to be in the app, so it
          gets the standalone auth layout the login page uses. */}
      <Route path="/reset" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Inbox />} />
        <Route path="/starred" element={<Inbox view="starred" />} />
        <Route path="/later" element={<Inbox view="later" />} />
        <Route path="/sent" element={<Inbox view="sent" />} />
        <Route path="/archived" element={<Inbox view="archived" />} />
        <Route path="/deleted" element={<Inbox view="deleted" />} />
        <Route path="/users" element={<Users />} />
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

// Attaches a paid checkout to the account on the first authenticated load.
// Needed because email confirmation can put minutes between paying and having
// a usable session, so the claim cannot always finish on the signup screen.
// A no-op when nothing is queued, which is every load after the first.
function ClaimCheckout() {
  useEffect(() => {
    void claimPendingCheckout();
  }, []);
  return null;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // A recovery link can land on ANY allowed URL (or the Site URL
      // fallback); always steer it to the set-new-password page.
      if (event === "PASSWORD_RECOVERY" && !window.location.pathname.endsWith("/reset")) {
        window.location.assign("/app/reset");
      }
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
  return (
    <>
      <ClaimCheckout />
      <RouterProvider router={router} />
    </>
  );
}
