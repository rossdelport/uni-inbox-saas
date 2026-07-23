import { Navigate } from "react-router-dom";

// Account management lives in Settings now; keep the old route working.
export function Accounts() {
  return <Navigate to="/settings?pane=accounts" replace />;
}
