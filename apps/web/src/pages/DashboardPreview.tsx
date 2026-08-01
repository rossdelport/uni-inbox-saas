import { useMemo, useState } from "react";
import { LOGO_SRC } from "../lib/assets.js";

type PreviewMessage = {
  id: string;
  sender: string;
  initials: string;
  subject: string;
  preview: string;
  time: string;
  account: string;
  accountEmail: string;
  color: string;
  unread?: boolean;
  starred?: boolean;
  body: string[];
};

const MESSAGES: PreviewMessage[] = [
  {
    id: "northwind",
    sender: "Maya Chen",
    initials: "MC",
    subject: "Final homepage copy is ready",
    preview: "I worked through the last round of notes and tightened the hero section…",
    time: "10:42",
    account: "OneInbox",
    accountEmail: "ross@tryoneinbox.co",
    color: "#2477f3",
    unread: true,
    starred: true,
    body: [
      "Hey Ross,",
      "I worked through the last round of notes and tightened the hero section. The new version leads with the unified-inbox promise and gets to the privacy story much faster.",
      "Everything is ready for your review. If the direction feels right, I can package the remaining launch copy tomorrow morning.",
      "Maya",
    ],
  },
  {
    id: "stripe",
    sender: "Stripe",
    initials: "S",
    subject: "Your payout is on the way",
    preview: "$2,840.00 is expected to arrive in your account on Monday.",
    time: "09:18",
    account: "Finance",
    accountEmail: "billing@tryoneinbox.co",
    color: "#635bff",
    unread: true,
    body: [
      "Your payout of $2,840.00 is now in transit and is expected to arrive in your bank account on Monday.",
      "You can view the full payout breakdown in your Stripe dashboard.",
    ],
  },
  {
    id: "ana",
    sender: "Ana Torres",
    initials: "AT",
    subject: "Re: Onboarding walkthrough",
    preview: "Thursday works perfectly. I’ve added the three Gmail accounts we discussed…",
    time: "Yesterday",
    account: "Consulting",
    accountEmail: "ross@northstudio.co",
    color: "#f06a55",
    body: [
      "Hi Ross,",
      "Thursday works perfectly. I’ve added the three Gmail accounts we discussed and invited the rest of the team.",
      "Could we spend a few minutes on saved searches as well? That is the feature everyone is most excited to try.",
      "Thanks, Ana",
    ],
  },
  {
    id: "linear",
    sender: "Linear",
    initials: "L",
    subject: "5 updates in OneInbox",
    preview: "Daniel completed OI-184 and left a comment on the mobile navigation…",
    time: "Yesterday",
    account: "OneInbox",
    accountEmail: "ross@tryoneinbox.co",
    color: "#2477f3",
    starred: true,
    body: [
      "Here is your daily activity summary for OneInbox.",
      "Daniel completed OI-184 and left a comment on the mobile navigation. Two new issues were added to the launch cycle.",
    ],
  },
  {
    id: "porkbun",
    sender: "Porkbun",
    initials: "P",
    subject: "Domain renewal reminder",
    preview: "tryoneinbox.co renews in 14 days. No action is required.",
    time: "Mon",
    account: "OneInbox",
    accountEmail: "ross@tryoneinbox.co",
    color: "#22a06b",
    body: [
      "Hello,",
      "tryoneinbox.co is scheduled to renew automatically in 14 days. No action is required if you would like to keep the domain.",
      "Thanks for flying with Porkbun.",
    ],
  },
  {
    id: "figma",
    sender: "Figma",
    initials: "F",
    subject: "Ross mentioned you in Dashboard v3",
    preview: "The new reading pane feels much calmer. I left two small spacing notes…",
    time: "Sun",
    account: "Consulting",
    accountEmail: "ross@northstudio.co",
    color: "#f06a55",
    body: [
      "Ross mentioned you in Dashboard v3:",
      "“The new reading pane feels much calmer. I left two small spacing notes before we call this final.”",
    ],
  },
];

function Icon({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export function DashboardPreview() {
  const [selectedId, setSelectedId] = useState(MESSAGES[0]!.id);
  const [filter, setFilter] = useState<"all" | "starred">("all");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const selected = MESSAGES.find((message) => message.id === selectedId) ?? MESSAGES[0]!;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MESSAGES.filter((message) => {
      // Search is global across connected inboxes, matching the real app.
      // A selected folder must never silently hide a valid search result.
      if (!needle && filter === "starred" && !message.starred) return false;
      if (!needle) return true;
      return `${message.sender} ${message.subject} ${message.preview}`.toLowerCase().includes(needle);
    });
  }, [filter, query]);

  return (
    <div className="dash dashboard-preview">
      <header className="dash-top">
        <a className="logo-lock" href="/" onClick={(event) => event.preventDefault()}>
          <img src={LOGO_SRC} alt="OneInbox logo" />
          <span>oneinbox</span>
        </a>
        <label className="dash-search" aria-label="Search every inbox">
          <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every inbox…" />
          <kbd>/</kbd>
        </label>
        <div className="dash-top-actions">
          <button
            className="sync-now-btn"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              setTimeout(() => setSyncing(false), 1_200);
            }}
          >
            <svg className={syncing ? "is-spinning" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18.5 6.5L20 8" /><path d="M17.9 15A7 7 0 0 1 5.5 17.5L4 16" />
            </svg>
            <span>{syncing ? "Syncing…" : "Sync now"}</span>
          </button>
          <button className="top-icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
            ?
          </button>
          <button className="dash-avatar" aria-label="Open account menu">R</button>
        </div>
      </header>

      <div className="dash-main">
        <aside className={`dash-side ${sidebarCollapsed ? "collapsed" : ""}`}>
          <button className="side-compose" aria-label="Compose" title="Compose">
            <Icon><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
            <span className="side-text">Compose</span>
          </button>

          <div className="preview-nav-group">
            <button className={`side-item ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
              <Icon><path d="M4 4h16v13H4z" /><path d="m4 13 4 4h8l4-4" /></Icon>
              <span>Inbox</span><span className="cnt">2</span>
            </button>
            <button className={`side-item ${filter === "starred" ? "active" : ""}`} onClick={() => setFilter("starred")}>
              <Icon><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" /></Icon>
              <span>Starred</span>
            </button>
            <button className="side-item"><Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon><span>Snoozed</span></button>
            <button className="side-item"><Icon><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon><span>Sent</span></button>
            <button className="side-item"><Icon><path d="M3 5h18v4H3z" /><path d="M5 9v11h14V9M10 13h4" /></Icon><span>Archive</span></button>
          </div>

          <div className="side-head">Connected inboxes</div>
          <button className="side-item preview-account"><i className="side-dot" style={{ background: "#2477f3" }} /><span>OneInbox<span className="email">ross@tryoneinbox.co</span></span><span className="cnt">1</span></button>
          <button className="side-item preview-account"><i className="side-dot" style={{ background: "#f06a55" }} /><span>Consulting<span className="email">ross@northstudio.co</span></span><span className="cnt">1</span></button>
          <button className="side-item preview-account"><i className="side-dot" style={{ background: "#635bff" }} /><span>Finance<span className="email">billing@tryoneinbox.co</span></span></button>
          <button className="side-item side-add" aria-label="Add inbox" title="Add inbox"><Icon><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Icon><span className="side-text">Add inbox</span></button>

          <div className="preview-sidebar-foot">
            <button className="side-item"><Icon><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></Icon><span>Settings</span></button>
            <div className="side-bottom-row">
              <div className="side-secure">
                <button className="secure-chip" aria-label="Encrypted" title="Encrypted">
                  <Icon><path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z" /><path d="m9 12.2 2.1 2.1 4.1-4.3" /></Icon>
                  <span className="secure-label">Encrypted</span>
                </button>
              </div>
              <button
                className="sidebar-collapse-btn"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                <Icon><path d={sidebarCollapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></Icon>
              </button>
            </div>
          </div>
        </aside>

        <section className="dash-list">
          <div className="list-head preview-list-head">
            <div className="list-head-top"><div><span className="preview-eyebrow">Workspace</span><h2>{query.trim() ? "Search results" : filter === "starred" ? "Starred" : "Inbox"}</h2></div><button className="preview-more" aria-label="More inbox actions">•••</button></div>
            <div className="preview-filter-row">
              <button className="on">All mail</button><button>Important</button><button>Newsletters</button>
            </div>
          </div>
          <div className="preview-list-summary"><span>{visible.length} conversations</span><button>Mark all read</button></div>
          <div className="list-rows">
            {visible.map((message) => (
              <button key={message.id} className={`mrow ${message.unread ? "unread" : ""} ${selected.id === message.id ? "sel" : ""}`} style={{ "--acc": message.color } as React.CSSProperties} onClick={() => setSelectedId(message.id)}>
                {message.unread && <span className="unread-dot" style={{ background: message.color }} />}
                <span className="ava" style={{ background: `color-mix(in srgb, ${message.color} 14%, white)`, color: message.color }}>{message.initials}</span>
                <span className="body"><span className="r1"><span className="who">{message.sender}</span><span className="when">{message.time}</span></span><span className="subj">{message.subject}</span><span className="prev">{message.preview}</span><span className="via"><i style={{ background: message.color }} />{message.account}</span></span>
                {message.starred && <span className="preview-row-star">★</span>}
              </button>
            ))}
            {visible.length === 0 && <div className="preview-no-results">No conversations match “{query}”.</div>}
          </div>
        </section>

        <main className="dash-read thread-selected" style={{ "--thread-accent": selected.color } as React.CSSProperties}>
          <div className="preview-reader-toolbar">
            <div><button aria-label="Archive"><Icon><path d="M3 5h18v4H3z" /><path d="M5 9v11h14V9M10 13h4" /></Icon></button><button aria-label="Snooze"><Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon></button><button aria-label="Delete"><Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon></button></div>
            <div><span>1 of {MESSAGES.length}</span><button aria-label="Previous"><Icon><path d="m15 18-6-6 6-6" /></Icon></button><button aria-label="Next"><Icon><path d="m9 18 6-6-6-6" /></Icon></button></div>
          </div>
          <article className="preview-reader">
            <div className="preview-reader-label"><i style={{ background: selected.color }} />{selected.account}<span>to {selected.accountEmail}</span></div>
            <div className="preview-subject-row"><h1>{selected.subject}</h1><button className={selected.starred ? "on" : ""}>★</button></div>
            <div className="preview-sender">
              <span className="ava" style={{ background: `color-mix(in srgb, ${selected.color} 14%, white)`, color: selected.color }}>{selected.initials}</span>
              <div><b>{selected.sender}</b><span>to me · {selected.accountEmail}</span></div>
              <time>{selected.time}</time>
              <button aria-label="Reply"><Icon><path d="m9 17-5-5 5-5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></Icon></button>
              <button aria-label="More"><Icon><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></Icon></button>
            </div>
            <div className="preview-message-body">{selected.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            <div className="preview-smart-summary"><span>✦</span><div><b>Quick summary</b><p>{selected.sender} is sharing an update and may need your review or response.</p></div></div>
            <div className="preview-reply-box">
              <div><span className="ava">R</span><span>Reply to {selected.sender}…</span></div>
              <div className="preview-reply-actions"><span><button><b>B</b></button><button>⌘</button><button>📎</button></span><button className="preview-send">Send <kbd>⌘↵</kbd></button></div>
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}
