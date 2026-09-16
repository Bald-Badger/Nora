"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Package,
  X,
  LogOut,
  Undo2,
  LoaderCircle,
  Check,
  Shield,
  AlertTriangle,
  Trash2,
} from "lucide-react";
type Item = {
  id: string;
  name: string;
  brand: string;
  quantity: number;
  unit: string;
  category: string;
  expiration: string;
  dateSource: string;
  datePrecision: string;
  dateKind: string;
  confidence: number;
  source: string;
  expired: boolean;
  status: string;
  notes: string;
  storage: string;
  leftover: boolean;
  createdAt: string;
  location: { name: string };
};
type Proposal = {
  id: string;
  result: {
    reply: string;
    assumptions: string[];
    actions: { operation: string; item?: Omit<Item, "id"> }[];
  };
};
export default function Home() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState("");
  const [items, setItems] = useState<Item[]>([]),
    [messages, setMessages] = useState<
      { id: string; role: string; content: string }[]
    >([]),
    [pending, setPending] = useState<Proposal[]>([]);
  const [text, setText] = useState(""),
    [image, setImage] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [showPast, setShowPast] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null),
    drawer = useRef<HTMLElement>(null),
    inventoryButton = useRef<HTMLButtonElement>(null);
  const pendingRequest = useRef<{
    id: string;
    message: string;
    image: File | null;
  } | null>(null);
  async function api(path: string, body?: BodyInit) {
    const r = await fetch(
      `/api/${path}`,
      body
        ? {
            method: "POST",
            body,
            headers:
              typeof body === "string"
                ? { "Content-Type": "application/json" }
                : undefined,
          }
        : {},
    );
    const d = await r.json();
    if (!r.ok) {
      if (r.status === 401) setAuth(false);
      throw Object.assign(new Error(d.error || "Request failed."), {
        status: r.status,
      });
    }
    return d;
  }
  async function refresh() {
    const d = await api("state");
    setItems(d.items);
    setMessages(d.messages);
    setPending(d.pending);
  }
  useEffect(() => {
    api("auth")
      .then((d) => {
        setAuth(d.authenticated);
        setConfigured(d.configured);
        if (d.authenticated) refresh().catch((e) => setError(e.message));
      })
      .catch(() => setError("Nora is unavailable. Refresh to retry."));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending.length, busy]);
  useEffect(() => {
    if (!auth) return;
    const update = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [auth]);
  useEffect(() => {
    if (!image) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => {
    if (!open) return;
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inventoryButton.current?.focus();
      }
      if (e.key === "Tab") {
        const nodes =
          drawer.current?.querySelectorAll<HTMLElement>("button,input");
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  async function action(path: string, data: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await api(path, JSON.stringify(data));
      if (path === "logout" || path === "revoke") {
        setAuth(false);
        setItems([]);
        setMessages([]);
        setPending([]);
      } else await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (!text.trim() && !image)) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("message", text);
      if (
        !pendingRequest.current ||
        pendingRequest.current.message !== text ||
        pendingRequest.current.image !== image
      ) {
        pendingRequest.current = {
          id: crypto.randomUUID(),
          message: text,
          image,
        };
      }
      form.set("requestId", pendingRequest.current.id);
      if (image) form.set("image", image);
      await api("chat", form);
      pendingRequest.current = null;
      setText("");
      setImage(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error & { status?: number }).status === 503)
        pendingRequest.current = null;
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (auth === null)
    return (
      <main className="login">
        <h1>Nora</h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <LoaderCircle className="spin" aria-label="Loading" />
        )}
      </main>
    );
  if (!auth)
    return (
      <main className="login">
        <div className="wordmark">
          <span className="brand-dot" /> Nora
        </div>
        <h1>Your fridge, remembered.</h1>
        {configured ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("login", JSON.stringify({ password }));
                setPassword("");
                setAuth(true);
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <p>Password setup is required on the server.</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  const visible = items.filter(
    (i) =>
      (showPast || !["consumed", "discarded", "empty"].includes(i.status)) &&
      `${i.name} ${i.brand}`.toLowerCase().includes(search.toLowerCase()),
  );
  const expiredItems = items.filter(
    (i) => i.expired && !["consumed", "discarded", "empty"].includes(i.status),
  );
  const categories = [...new Set(visible.map((i) => i.category))];
  return (
    <div className="app">
      <header>
        <div className="wordmark">
          <span className="brand-dot" />
          Nora <span className="section-label">/ Fridge</span>
        </div>
        <nav>
          <button
            ref={inventoryButton}
            onClick={() => setOpen(true)}
            title="Current inventory"
          >
            <Package size={18} />
            <span>Inventory</span>
            <span className="count">
              {
                items.filter(
                  (i) => !["consumed", "discarded", "empty"].includes(i.status),
                ).length
              }
            </span>
          </button>
          <button
            className="icon"
            title="Sign out all devices"
            aria-label="Sign out all devices"
            onClick={() => action("revoke")}
            disabled={busy}
          >
            <Shield size={18} />
          </button>
          <button
            className="icon"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => action("logout")}
            disabled={busy}
          >
            <LogOut size={18} />
          </button>
        </nav>
      </header>
      <main className="conversation">
        {!messages.length && (
          <div className="empty">
            <div className="fridge-mark">
              <Package size={32} strokeWidth={1.3} />
            </div>
            <h1>What’s in your fridge?</h1>
            <p>Milk, leftovers, and everything in between.</p>
          </div>
        )}
        {expiredItems.length > 0 && (
          <button className="expired-banner" onClick={() => setOpen(true)}>
            <AlertTriangle size={18} />
            {expiredItems.length} expired{" "}
            {expiredItems.length === 1 ? "item" : "items"} to review
          </button>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`message ${m.role}`}>
            <div className="sender">{m.role === "user" ? "You" : "Nora"}</div>
            <div className="message-body">{m.content}</div>
          </article>
        ))}
        {pending.map((p) => (
          <section className="proposal" key={p.id}>
            <h2>Review photo inventory</h2>
            <p>{p.result.reply}</p>
            {p.result.actions.map((a, i) => (
              <div className="proposal-row" key={i}>
                <strong>{a.item?.name || a.operation}</strong>
                <span>
                  {a.item?.quantity} {a.item?.unit}
                </span>
                <small>
                  {a.item?.expiration} ·{" "}
                  {a.item?.dateSource === "ai"
                    ? "AI estimated"
                    : a.item?.datePrecision}
                </small>
              </div>
            ))}
            {p.result.assumptions.map((a, i) => (
              <p className="muted" key={i}>
                {a}
              </p>
            ))}
            <div className="row">
              <button
                className="primary"
                disabled={busy}
                onClick={() => action("confirm", { id: p.id })}
              >
                <Check size={16} />
                Confirm
              </button>
              <button
                disabled={busy}
                onClick={() => action("cancel", { id: p.id })}
              >
                Cancel
              </button>
            </div>
          </section>
        ))}
        {busy && (
          <div className="thinking">
            <LoaderCircle size={16} className="spin" />
            Nora is working…
          </div>
        )}
        <div ref={end} />
      </main>
      <footer>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <form className="composer" onSubmit={send}>
          {preview && (
            <div className="attachment">
              <img src={preview} alt="Attached grocery photo" />
              <span>{image?.name}</span>
              <button
                type="button"
                className="icon"
                aria-label="Remove photo"
                onClick={() => setImage(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <textarea
            aria-label="Message Nora"
            placeholder="Message Nora…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={8000}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 8 * 1024 * 1024)
                  setError("Photos must be 8 MB or smaller.");
                else setImage(f || null);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon"
              title="Attach photo"
              aria-label="Attach photo"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={19} />
            </button>
            <button
              type="button"
              className="icon"
              title="Undo last inventory change"
              aria-label="Undo last inventory change"
              disabled={busy}
              onClick={() => action("undo")}
            >
              <Undo2 size={19} />
            </button>
            <button
              type="submit"
              className="send"
              aria-label="Send message"
              disabled={busy || (!text.trim() && !image)}
            >
              <ArrowUp size={20} />
            </button>
          </div>
        </form>
        <div className="footer-note">
          Nora ·{" "}
          {new Intl.DateTimeFormat("en", {
            month: "short",
            day: "numeric",
          }).format(new Date())}
        </div>
      </footer>
      {open && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <aside
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-title"
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">KITCHEN</span>
                <h2 id="inventory-title">Fridge inventory</h2>
              </div>
              <button
                className="icon"
                aria-label="Close inventory"
                onClick={() => {
                  setOpen(false);
                  inventoryButton.current?.focus();
                }}
              >
                <X />
              </button>
            </div>
            <input
              aria-label="Search inventory"
              placeholder="Search inventory"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={showPast}
                onChange={(e) => setShowPast(e.target.checked)}
              />
              Include consumed and discarded
            </label>
            {!visible.length && <p className="muted">No items yet.</p>}
            {categories.map((category) => (
              <section className="category" key={category}>
                <h3>
                  {category}
                  <span>
                    {visible.filter((i) => i.category === category).length}
                  </span>
                </h3>
                {visible
                  .filter((i) => i.category === category)
                  .map((i) => (
                    <article className="inventory-item" key={i.id}>
                      <div className="item-title">
                        <strong>{i.name}</strong>
                        <div className="item-actions">
                          <span>
                            {i.quantity} {i.unit}
                          </span>
                          {!["consumed", "discarded", "empty"].includes(
                            i.status,
                          ) && (
                            <button
                              className="icon trash"
                              title={`Discard ${i.name}`}
                              aria-label={`Discard ${i.name}`}
                              disabled={busy}
                              onClick={() => action("discard", { id: i.id })}
                            >
                              <Trash2 size={17} />
                            </button>
                          )}
                        </div>
                      </div>
                      {i.brand && <p className="muted">{i.brand}</p>}
                      <p className={i.expired ? "expired" : "muted"}>
                        {i.expired ? "Expired · " : ""}
                        {i.expiration} ·{" "}
                        {i.dateSource === "ai"
                          ? "AI estimated"
                          : i.datePrecision === "exact"
                            ? "Exact"
                            : "Approximate"}{" "}
                        · {i.dateKind}
                      </p>
                      <p className="muted">
                        {i.location.name}
                        {i.storage ? ` / ${i.storage}` : ""} · {i.status}
                        {i.leftover ? " · Leftover" : ""}
                      </p>
                      {i.notes && <p>{i.notes}</p>}
                      <small className="muted">
                        Added {i.createdAt.slice(0, 10)}
                        {i.source ? ` · From ${i.source}` : ""}
                        {Number.isFinite(i.confidence)
                          ? ` · ${Math.round(i.confidence * 100)}% confidence`
                          : ""}
                      </small>
                    </article>
                  ))}
              </section>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
