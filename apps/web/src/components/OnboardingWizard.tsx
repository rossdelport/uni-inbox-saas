import { useEffect, useState } from "react";
import { useAccounts } from "../lib/queries.js";
import { LOGO_SRC, MAIL_SRC, PROVIDER_COLORS } from "../lib/assets.js";
import { ConnectForm } from "./ConnectAccountModal.js";

const DONE_KEY = "oneinbox-onboarding-done";

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true;
  }
}
export function markOnboardingSeen() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* private mode */
  }
}

type Step = "welcome" | "connect" | "done";

// First-run wizard: welcome -> connect (shared ConnectForm) -> success with
// an immediate "add the rest" loop. The whole product clicks at inbox #2.
export function OnboardingWizard({
  onClose,
  startAt = "welcome",
}: {
  onClose: () => void;
  startAt?: Step;
}) {
  const [step, setStep] = useState<Step>(startAt);
  const [open, setOpen] = useState(false);
  const [lastConnected, setLastConnected] = useState<{ label: string; email: string } | null>(null);
  const { data: accounts } = useAccounts();

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function finish() {
    markOnboardingSeen();
    onClose();
  }

  return (
    <div className={`uni-modal-bg ${open ? "open" : ""}`}>
      <div className="uni-modal" role="dialog" aria-modal="true" style={{ width: 600 }}>
        {step === "welcome" && (
          <div style={{ textAlign: "center", padding: "10px 4px 4px" }}>
            <img src={LOGO_SRC} alt="" style={{ width: 56, height: 56, margin: "0 auto 18px", borderRadius: 14 }} />
            <h3 style={{ fontSize: 26 }}>Welcome to OneInbox</h3>
            <p className="m-sub" style={{ maxWidth: 420, margin: "10px auto 0" }}>
              Every project you run has its own email address. Let's plug them all into one clean
              feed, starting with your first inbox. It takes about a minute.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
              {(["gmail", "icloud", "porkbun", "custom"] as const).map((k) => (
                <span key={k} className="chip">
                  <i style={{ background: PROVIDER_COLORS[k] }} />
                  {k === "custom" ? "Any IMAP" : k === "gmail" ? "Gmail" : k === "icloud" ? "iCloud" : "Porkbun"}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 26 }}>
              <button className="btn-black" style={{ width: "100%", height: 50 }} onClick={() => setStep("connect")}>
                Connect my first inbox
              </button>
              <button
                className="btn-ghost"
                style={{ width: "100%", marginTop: 10 }}
                onClick={finish}
              >
                Skip for now
              </button>
            </div>
            <p style={{ marginTop: 16, fontSize: 12, color: "var(--ink3)" }}>
              Passwords are stored encrypted. Only you ever see your messages.
            </p>
          </div>
        )}

        {step === "connect" && (
          <div>
            <h3>Connect an inbox</h3>
            <p className="m-sub">
              Pick a provider and sign in. Mail starts flowing in about a minute.
            </p>
            <div style={{ marginTop: 6 }}>
              <ConnectForm
                onConnected={(label, email) => {
                  setLastConnected({ label, email });
                  setStep("done");
                }}
              />
            </div>
            <button
              className="btn-ghost"
              style={{ width: "100%", marginTop: 12 }}
              onClick={(accounts?.length ?? 0) > 0 ? () => setStep("done") : finish}
            >
              {(accounts?.length ?? 0) > 0 ? "Back" : "Skip for now"}
            </button>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "6px 4px 4px" }}>
            <img src={MAIL_SRC} alt="" style={{ width: 110, margin: "0 auto 14px" }} />
            <h3 style={{ fontSize: 24 }}>
              {lastConnected ? `${lastConnected.label} is syncing` : "You're connected"}
            </h3>
            <p className="m-sub" style={{ maxWidth: 420, margin: "10px auto 0" }}>
              Your first messages usually land within a minute. One clean feed is the whole point,
              so add the rest of your project inboxes while this one syncs.
            </p>

            {(accounts?.length ?? 0) > 0 && (
              <div style={{ margin: "18px auto 0", maxWidth: 380, textAlign: "left" }}>
                {(accounts ?? []).map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 14 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: a.color, flex: "none" }} />
                    <b>{a.label}</b>
                    <span style={{ color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.email_address}
                    </span>
                    <span style={{ marginLeft: "auto", color: "var(--other)", fontWeight: 700, flex: "none" }}>✓</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 22 }}>
              <button className="btn-black" style={{ width: "100%", height: 50 }} onClick={() => setStep("connect")}>
                Add another inbox
              </button>
              <button className="btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={finish}>
                Take me to my inbox
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
