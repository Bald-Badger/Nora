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
  Minus,
  Plus,
  Download,
  Wifi,
  WifiOff,
  Bell,
  ScanBarcode,
  ReceiptText,
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
    [imageMode, setImageMode] = useState<"photo" | "receipt" | "barcode">(
      "photo",
    ),
    [open, setOpen] = useState(false),
    [remindersOpen, setRemindersOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [showPast, setShowPast] = useState(false),
    [householdToday, setHouseholdToday] = useState(""),
    [providerOnline, setProviderOnline] = useState<boolean | null>(null),
    [exportFormat, setExportFormat] = useState("csv");
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
    setHouseholdToday(d.today || new Date().toISOString().slice(0, 10));
  }
  async function checkProvider() {
    try {
      const d = await api("provider-status");
      setProviderOnline(d.available);
    } catch {
      setProviderOnline(false);
    }
  }
  useEffect(() => {
    api("auth")
      .then((d) => {
        setAuth(d.authenticated);
        setConfigured(d.configured);
        if (d.authenticated) {
          refresh().catch((e) => setError(e.message));
          checkProvider();
        }
      })
      .catch(() => setError("Nora is unavailable. Refresh to retry."));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending.length, busy]);
  useEffect(() => {
    if (!auth) return;
    const update = () => {
      if (document.visibilityState === "visible") {
        refresh().catch(() => {});
        checkProvider();
      }
    };
    window.addEventListener("focus", update);
    const providerTimer = window.setInterval(checkProvider, 60_000);
    return () => {
      window.removeEventListener("focus", update);
      window.clearInterval(providerTimer);
    };
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
        setProviderOnline(null);
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
      if (image) {
        form.set("image", image);
        form.set("imageMode", imageMode);
      }
      await api("chat", form);
      pendingRequest.current = null;
      setText("");
      setImage(null);
      setImageMode("photo");
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
                checkProvider();
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
  const visible = items
    .filter(
      (i) =>
        (showPast ||
          !["consumed", "discarded", "empty"].includes(i.status)) &&
        `${i.name} ${i.brand}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.expiration.localeCompare(b.expiration) || a.name.localeCompare(b.name),
    );
  const expiredItems = items.filter(
    (i) => i.expired && !["consumed", "discarded", "empty"].includes(i.status),
  );
  const categories = [...new Set(visible.map((i) => i.category))].sort();
  const freshness = (item: Item) => {
    const current = householdToday || new Date().toISOString().slice(0, 10);
    const remaining = Math.round(
      (Date.parse(`${item.expiration}T00:00:00Z`) -
        Date.parse(`${current}T00:00:00Z`)) /
        86_400_000,
    );
    if (remaining < 0) return { className: "expired", label: "Expired" };
    if (remaining === 0) return { className: "soon", label: "Expires today" };
    if (remaining <= 7)
      return {
        className: "soon",
        label: `Expires in ${remaining} ${remaining === 1 ? "day" : "days"}`,
      };
    return null;
  };
  const reminderItems = items
    .filter(
      (item) =>
        !["consumed", "discarded", "empty"].includes(item.status) &&
        (item.expired ||
          (!item.expired &&
            Date.parse(`${item.expiration}T00:00:00Z`) -
              Date.parse(
                `${householdToday || new Date().toISOString().slice(0, 10)}T00:00:00Z`,
              ) <=
              7 * 86_400_000)),
    )
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
  return (
    <div className="app">
      <header>
        <div className="wordmark">
          <span className="brand-dot" />
          Nora <span className="section-label">/ Fridge</span>
        </div>
        <nav>
          <button
            className={`icon reminder-button ${reminderItems.length ? "has-reminders" : ""}`}
            title="Expiration reminders"
            aria-label={`Expiration reminders${reminderItems.length ? `, ${reminderItems.length} items` : ""}`}
            onClick={() => setRemindersOpen(true)}
          >
            <Bell size={18} />
            {reminderItems.length > 0 && (
              <span className="reminder-count">{reminderItems.length}</span>
            )}
          </button>
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
            <h2>Review inventory changes</h2>
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
              <span>
                {imageMode === "receipt"
                  ? "Receipt"
                  : imageMode === "barcode"
                    ? "Barcode"
                    : "Photo"}
                {image?.name ? ` · ${image.name}` : ""}
              </span>
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
              capture="environment"
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
              onClick={() => {
                setImageMode("photo");
                fileRef.current?.click();
              }}
            >
              <Paperclip size={19} />
            </button>
            <button
              type="button"
              className="icon"
              title="Scan receipt"
              aria-label="Scan receipt"
              disabled={busy}
              onClick={() => {
                setImageMode("receipt");
                fileRef.current?.click();
              }}
            >
              <ReceiptText size={19} />
            </button>
            <button
              type="button"
              className="icon"
              title="Scan product barcode"
              aria-label="Scan product barcode"
              disabled={busy}
              onClick={() => {
                setImageMode("barcode");
                fileRef.current?.click();
              }}
            >
              <ScanBarcode size={19} />
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
          <span
            className={`provider-status ${providerOnline === false ? "unavailable" : ""}`}
            title={
              providerOnline === false
                ? "AI provider unavailable"
                : providerOnline === true
                  ? "AI provider available"
                  : "Checking AI provider"
            }
          >
            {providerOnline === false ? (
              <WifiOff size={12} />
            ) : (
              <Wifi size={12} />
            )}
            {providerOnline === null
              ? "AI checking"
              : providerOnline
                ? "AI ready"
                : "AI unavailable"}
          </span>
          <span>·</span>
          {new Intl.DateTimeFormat("en", {
            month: "short",
            day: "numeric",
          }).format(new Date())}
        </div>
      </footer>
      {remindersOpen && (
        <div
          className="overlay reminder-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRemindersOpen(false);
          }}
        >
          <section
            className="reminder-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-title"
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">ATTENTION</span>
                <h2 id="reminder-title">Expiration reminders</h2>
              </div>
              <button
                className="icon"
                aria-label="Close reminders"
                onClick={() => setRemindersOpen(false)}
              >
                <X />
              </button>
            </div>
            {!reminderItems.length && (
              <p className="muted">Nothing needs attention right now.</p>
            )}
            {reminderItems.map((item) => (
              <article className="reminder-item" key={item.id}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.leftover && item.expired
                      ? "Throw away this expired leftover"
                      : item.expired
                        ? "Expired · review or discard"
                      : freshness(item)?.label || "Expiring soon"}
                  </p>
                  <small>
                    {item.quantity} {item.unit} · {item.expiration}
                  </small>
                </div>
              </article>
            ))}
          </section>
        </div>
      )}
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
            <div className="inventory-tools">
              <label className="check">
                <input
                  type="checkbox"
                  checked={showPast}
                  onChange={(e) => setShowPast(e.target.checked)}
                />
                Include past
              </label>
              <div className="export-tools">
                <select
                  aria-label="Export format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <a
                  className="icon-button"
                  href={`/api/export?format=${exportFormat}`}
                  title={`Download inventory as ${exportFormat.toUpperCase()}`}
                  aria-label={`Download inventory as ${exportFormat.toUpperCase()}`}
                >
                  <Download size={17} />
                </a>
              </div>
            </div>
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
                  .map((i) => {
                    const fresh = freshness(i);
                    const active = ![
                      "consumed",
                      "discarded",
                      "empty",
                    ].includes(i.status);
                    const brand = i.brand.trim();
                    const showBrand =
                      brand &&
                      !["unknown", "none", "n/a"].includes(
                        brand.toLowerCase(),
                      );
                    const storage = i.storage.trim();
                    const showStorage =
                      storage &&
                      !["fridge", i.location.name.toLowerCase()].includes(
                        storage.toLowerCase(),
                      );
                    const details = [
                      showStorage ? storage : "",
                      !active ? i.status : "",
                      i.leftover ? "Leftover" : "",
                    ].filter(Boolean);
                    return (
                      <article className="inventory-item" key={i.id}>
                        <div className="item-title">
                          <div className="item-name">
                            <strong>{i.name}</strong>
                            {fresh && (
                              <span className={`freshness ${fresh.className}`}>
                                {fresh.label}
                              </span>
                            )}
                          </div>
                          <div className="item-actions">
                            {active && (
                              <button
                                className="icon"
                                title={`Decrease ${i.name} by 1 ${i.unit}`}
                                aria-label={`Decrease ${i.name} by 1 ${i.unit}`}
                                disabled={busy}
                                onClick={() =>
                                  action("quantity", { id: i.id, delta: -1 })
                                }
                              >
                                <Minus size={16} />
                              </button>
                            )}
                            <span className="quantity-value">
                              {i.quantity} {i.unit}
                            </span>
                            {active && (
                              <button
                                className="icon"
                                title={`Increase ${i.name} by 1 ${i.unit}`}
                                aria-label={`Increase ${i.name} by 1 ${i.unit}`}
                                disabled={busy}
                                onClick={() =>
                                  action("quantity", { id: i.id, delta: 1 })
                                }
                              >
                                <Plus size={16} />
                              </button>
                            )}
                            {active && (
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
                        {showBrand && <p className="muted">{brand}</p>}
                        <p className={i.expired ? "expired" : "muted"}>
                          {i.expiration} ·{" "}
                          {i.dateSource === "ai"
                            ? "AI estimated"
                            : i.datePrecision === "exact"
                              ? "Exact"
                              : "Approximate"}{" "}
                          · {i.dateKind}
                        </p>
                        {details.length > 0 && (
                          <p className="muted">{details.join(" · ")}</p>
                        )}
                      </article>
                    );
                  })}
              </section>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
