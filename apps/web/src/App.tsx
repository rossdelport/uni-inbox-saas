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
import { pendingPlanIntent, resumePendingCheckout } from "./lib/checkout.js";
import { Login } from "./pages/Login.js";
import { Layout } from "./components/Layout.js";
import { Inbox } from "./pages/Inbox.js";
import { Compose } from "./pages/Compose.js";
import { Accounts } from "./pages/Accounts.js";
import { Billing } from "./pages/Billing.js";
import { Settings } from "./pages/Settings.js";
import { ResetPassword } from "./pages/ResetPassword.js";
import { Users } from "./pages/Users.js";
import { Waitlist } from "./pages/Waitlist.js";
import { DashboardPreview } from "./pages/DashboardPreview.js";

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
        <Route path="/snoozed" element={<Inbox view="later" />} />
        <Route path="/sent" element={<Inbox view="sent" />} />
        {/* Keep old bookmarks useful after Archived was replaced by Snoozed. */}
        <Route path="/archived" element={<Navigate to="/snoozed" replace />} />
        <Route path="/deleted" element={<Inbox view="deleted" />} />
        <Route path="/users" element={<Users />} />
        <Route path="/waitlist" element={<Waitlist />} />
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

// Shown instead of the dashboard while the app is redirecting to Stripe.
// Signup used to paint the inbox for a beat before the checkout URL came
// back, which read as "I'm in!" followed by being yanked away. Now the
// dashboard is withheld until the hand-off resolves.
function CheckoutSplash() {
  return (
    <div className="empty-state" style={{ height: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
          Taking you to secure checkout…
        </p>
        <p style={{ marginTop: 7, fontSize: 13, color: "var(--ink3)" }}>
          Card details are handled by Stripe. You'll be back here right after.
        </p>
      </div>
    </div>
  );
}

export function App() {
  // A realistic, local-only dashboard for visual review. It deliberately
  // bypasses auth and APIs in development, and cannot exist in production.
  if (import.meta.env.DEV && window.location.pathname === "/app/design-preview") {
    return <DashboardPreview />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [, bump] = useState(0);

  // A stored plan intent means this session exists to be sent to Stripe:
  // signup stores it before creating the account, and the confirm-email path
  // preserves it across the round trip. Derived at render time so the very
  // first paint after sign-in is already the splash, never the dashboard.
  const handingOff = Boolean(session) && pendingPlanIntent() !== null;

  useEffect(() => {
    if (!session || !pendingPlanIntent()) return;
    void resumePendingCheckout().then((sent) => {
      // false = checkout could not start (already subscribed, network...).
      // The intent has been cleared; re-render so the dashboard appears
      // rather than leaving the splash up forever.
      if (!sent) bump((n) => n + 1);
    });
  }, [session]);

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
  if (handingOff) return <CheckoutSplash />;
  return <RouterProvider router={router} />;
}
