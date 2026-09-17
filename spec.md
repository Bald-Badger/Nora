# Nora Product Specification

This document is the authoritative specification for Nora's behavior, scope, security boundaries, data model, and deployment requirements.

Nora is a local kitchen-inventory notebook for the fridge, freezer, and shelf, with a chat interface and a bridge to an external AI agent such as ChatGPT.

The goal is to make updating and checking kitchen food inventory feel as easy as texting someone. Nora records what is available, helps prevent forgotten or duplicate purchases, tracks expiration information, and supplies inventory context to the AI agent when the user requests higher-level help.

## Responsibility Boundary

Nora is not its own reasoning, recipe, or recommendation engine.

**Nora owns:**

- The local inventory database.
- The human-readable inventory view.
- Schema validation and SQL transactions.
- Current date, time, and household time-zone context.
- Inventory history, undo, and debug logs.
- Selecting relevant inventory context and passing it to the AI agent.
- Applying or displaying validated structured responses from the AI agent.

**The AI agent owns:**

- Interpreting natural and vague language.
- Making good-faith assumptions when information is missing.
- Estimating expiration dates when no manual date is available.
- Interpreting uploaded images.
- Producing meal, recipe, substitution, and shopping recommendations.
- Returning typed, structured inventory actions for Nora to validate.

The AI agent never receives direct database access.

The AI provider is replaceable. Nora's domain logic, inventory schema, validation, and user interface must not depend on one provider's SDK or response format. Provider-specific code belongs behind a common adapter so Groq, OpenAI, Gemini, or a future local model can be selected through configuration without rewriting inventory behavior.

The first implementation ships the Groq adapter. Additional providers require an adapter implementing the same contract; selecting an unsupported provider must fail visibly rather than silently falling back.

## MVP Interface

The first version is a minimal, chat-first web interface modeled after a focused coding-assistant conversation screen. It contains:

1. A chat window.
2. Separate image-upload and camera buttons that attach a photo to a chat message. On supported phones, the camera button directly invokes the rear camera.
3. A clear inventory button that opens the current kitchen inventory view on demand.

The inventory view is hidden until requested and groups items by category. It should be easy to close and return to the conversation without losing chat state. The database is the canonical inventory record; the inventory view is a compact scanning surface emphasizing item name, quantity, unit, Fridge/Freezer/Shelf location, and expiration date. Useful brands, specific storage details, leftover state, and inactive status may appear when relevant. It omits notes, date source, date precision, date kind, confidence, added date, and placeholder values such as `unknown`; those fields remain stored and available in authenticated exports.

The interface supports persistent day and night themes with an obvious header toggle. The user's choice is retained locally in the browser.

The AI status indicator reflects completion health, not merely provider reachability. A successful completion immediately reports ready; rate-limit responses immediately report rate limited until their retry window passes; network or provider failures report unavailable. The client refreshes status after every AI request and periodically while the page is open.

Each active inventory item has a trash control for quickly marking it discarded. Discarding is an audited, undoable inventory edit rather than a database deletion. Discarded items leave the default active view and remain visible when past items are included.

Within each category, inventory items are ordered by expiration date, earliest first. Active items that are already expired or expire within seven calendar days display a distinct freshness badge based on Nora's configured household date.

Each active item has one-step decrease and increase controls. These adjustments change the stored quantity by one of the item's displayed unit, use the same transaction and permanent audit trail as chat edits, and can be undone. Decreasing an item to zero marks it empty.

The inventory view offers authenticated CSV and JSON downloads containing the complete inventory, including inactive records and freshness metadata. Exports are generated locally, are not sent to the AI provider, and must not contain credentials, sessions, debug logs, or password hashes.

The header includes an in-app expiration reminder bell. A red count appears for every active expired item and every active item expiring within three calendar days. Expired leftovers are specifically marked to throw away; other expired items are marked for review or discard. Opening the reminder shows the affected item, quantity, expiration date, and reason. Reminders never remove inventory automatically and are recalculated from the authoritative local inventory and household date.

The first interface tracks food and drink in exactly three top-level locations: `Fridge`, `Freezer`, and `Shelf`. Broader rooms and non-food household inventory remain future scope.

Fast inventory entry is more important than meal suggestions in the first version.

When a feature's MVP status is unclear, keep it in the future roadmap until it is explicitly promoted to the MVP.

## Example Messages

Nora should accept natural messages such as:

- "I bought milk, eggs, spinach, and chicken."
- "Used the last of the tomatoes."
- "Do I still have yogurt?"
- "Add two packs of tofu expiring next Friday."
- "Costco full fat milk x3, expires in roughly 3 months."
- "What should I cook before it goes bad?"
- "Help me come up with a few dinners I can make in 30 minutes, with recipes."
- "What regular staples should I buy?"
- "Actually, make that almond milk."
- "Undo the last change."

## AI Text-to-Inventory Flow

The configured AI provider is the primary text-to-inventory interpreter. Nora sends each chat message with relevant context, which may include current inventory, known locations, recent edits, current date and time, time zone, and household preferences.

The AI returns a typed, structured response rather than free-form inventory data. Supported inventory actions include:

- Add an item.
- Consume or remove an item.
- Update a quantity or unit.
- Update an expiration date.
- Move an item.
- Mark an item discarded.
- Query the inventory.
- Add or update a leftover.
- Undo the last change.
- Return a non-inventory response, such as cooking advice.

A structured inventory action should include the affected item, quantity and unit, location, freshness estimate and precision, assumptions, and confidence.

Nora validates the response against its schema and applies accepted changes in one SQL transaction. After a change, Nora shows a short receipt describing what it recorded and any assumptions, with a clear undo option.

SQLite is never connected directly to the AI service. For each request, Nora queries only the relevant records, serializes them into a bounded provider-neutral context payload, and sends that payload with the user's message or image through the active provider adapter. The AI returns a structured action matching Nora's strict internal schema. Nora validates the action, resolves referenced item IDs, checks current database state, and performs the SQL transaction itself. Query-only AI answers receive a filtered snapshot and cannot write inventory.

When a consumption message uses a vague amount, such as "I used some milk," the AI agent should estimate the amount. Nora records the estimate, clearly shows the assumed quantity in the change receipt, and allows the change to be undone. Exact amounts and phrases such as "used the last" take priority over estimation.

The MVP inventory accepts food and drink stored in the Fridge, Freezer, or on the Shelf. Explicit user storage instructions take priority. Otherwise, the AI makes a good-faith inference from the item: frozen foods such as frozen dumplings use `Freezer`, shelf-stable foods and spices such as ground pepper use `Shelf`, and chilled or perishable foods such as milk use `Fridge`. Nora must reject obvious non-food objects, such as socks, with a brief explanation and no inventory action. If a named object is ambiguous and could reasonably be food, a household consumable, or a mistaken name, Nora asks for clarification without changing inventory. Photo recognition ignores incidental non-food objects and reports relevant omissions.

If the AI service is unavailable or returns an invalid action, Nora must not change inventory. It should tell the user that chat-based inventory updates are temporarily unavailable and safely record the failure in the debug log.

While signed in, Nora displays a compact AI-provider availability indicator. It uses a cached, credentialed provider health request, reveals no provider diagnostics or credentials to the browser, and does not imply that any particular inference request is guaranteed to succeed.

The MVP assumes the configured AI service is normally available and does not provide a separate manual inventory-editing form. When the service is unavailable, Nora must show a clear on-screen notice and wait for it to recover.

## AI Instruction Contract

This specification is the authoritative, human-readable contract for Nora's AI behavior. Nora must include a static, actively maintained core instruction set in the repository. Runtime prompts and skill-like task instructions implement this specification; they must not introduce policy, permissions, or behavior that conflicts with or is absent from this document.

The instruction set should be split into a stable core prompt and focused task prompts for inventory extraction, image recognition, expiration estimation, and agent recommendations. Nora assembles the applicable instructions with the current date and time, minimum relevant inventory context, the user's message and images, and the required structured-output schema.

Prompt maintenance follows these rules:

- Store all runtime instructions as version-controlled source files inside Nora; do not fetch hidden prompts remotely.
- Include a prompt-set version in every AI processing record and AI-assisted inventory audit event.
- Each prompt file must declare which `spec.md` sections it implements so behavior remains traceable to this specification.
- Any prompt change that alters user-visible behavior, data disclosure, inventory authority, expiration handling, or food-safety behavior must update `spec.md` and its tests in the same change.
- Test prompt behavior with representative exact, vague, conflicting, image-based, and malicious inputs before release.
- Provider adapters may translate message and schema formats, but they must not redefine Nora's behavioral rules.
- Treat all AI responses as untrusted proposals. Prompts cannot grant an AI provider direct SQLite access, secret access, or authority to bypass local validation.
- When the prompt files and `spec.md` disagree, `spec.md` wins and the implementation is considered defective.

## AI Agent Requests

Nora does not act as a general-purpose chatbot. It accepts only household food inventory, food storage, expiration, grocery, and inventory-informed cooking, recipe, meal-planning, or shopping requests. It briefly declines unrelated chat and does not disclose inventory context to the AI answering stage for such requests.

For open-ended questions such as "What can I make right now?", Nora passes the question and relevant inventory context to the configured AI agent. The context may include current inventory, soon-to-expire items, past inventory activity, household preferences, and time constraints.

The AI agent handles meal ideas, recipes, substitutions, and weekly meal planning. Advice does not change inventory unless the user explicitly requests an inventory change.

When asked, the AI agent may use past inventory activity to recommend likely staples. For example, if the user regularly keeps full-fat milk in the fridge, it may suggest buying milk when none remains. Nora must not proactively interrupt the user, add recommended items, or modify the shopping list without a request.

## Image Handling

The MVP supports full photo-to-inventory recognition. Nora may send user-uploaded photos of groceries, fridge contents, pantry shelves, receipts, or visible best-by dates to the configured AI provider. The AI identifies the items, quantities, units, and visible expiration information, then proposes inventory additions or updates for Nora to validate and the user to confirm before applying them in one SQL transaction.

The composer does not provide separate receipt or barcode scan buttons. Uploaded images and camera photos use the normal protected image pipeline, and the AI determines whether an image is groceries, a receipt, packaging/barcode, a storage view, or a date label. For receipts, Nora extracts food and drink lines while ignoring prices, totals, tax, payment data, loyalty identifiers, and obvious non-food purchases. Receipt dates are not expiration dates.

Barcode images are decoded locally with the repository's pinned ZXing dependency. Nora accepts retail UPC/EAN formats, sends only the decoded numeric barcode to Open Food Facts for a product lookup, and does not send the barcode photo to that service or the AI provider. A named product lookup is passed through the normal AI schema for freshness estimation and shown as a proposal requiring confirmation. Failed decoding and unknown products do not change inventory.

If the API is unavailable, image-capable access is not enabled, or image analysis fails, Nora must clearly report that the image feature is temporarily down. It must not claim the image was processed. Diagnostic details should be logged without exposing credentials.

Retain original uploaded images in Nora's local persistent storage for debugging for 30 days. Each image should be linked to its AI-processing record and resulting inventory events. After 30 days, delete the image file while retaining its processing metadata and inventory audit events. Images remain private to Nora and must not be retransmitted except when needed for an inventory-related request.

## Expiration and Food Safety

Manual expiration information takes priority when available. This includes a best-by date read from an uploaded image. If no manual date is available, the AI agent makes a good-faith estimate.

For uncertain dates, Nora actively chooses the longest credible endpoint under proper storage rather than the minimum, midpoint, average, or conservative recommendation. It assumes a newly acquired item starts in normal good condition and was promptly stored unless contrary information is supplied. Missing detail alone does not shorten an estimate. Produce and foods whose decline is primarily freshness receive generous quality-review dates, acknowledging that the user accepts texture and flavor decline. This preference applies generally; it does not permit Nora to extend safety-sensitive refrigerated dates beyond defensible safe-storage limits or claim that uncertainty is proof of safety. Where a safety range applies, Nora uses its latest defensible endpoint.

Generic food names must not be mapped to the shortest-lived subtype without evidence. In particular, `salad` may mean unopened packaged greens, a salad kit, whole or loose greens, undressed cut vegetables, or a prepared/dressed/protein salad. Nora uses packaging, visible ingredients, and the user's wording to select the applicable upper-end estimate. If the distinction materially changes the date and cannot be inferred, Nora asks one concise clarification and makes no inventory change instead of assuming a prepared deli-style salad.

Plain leafy greens and similarly named raw produce must never receive a 3- or 4-day prepared-salad estimate solely because of vague wording such as `salad`, `green leaf`, or `greens`. Without evidence of dressing, cooked or safety-sensitive ingredients, prior cutting/aging, or spoilage, Nora uses the generous upper end for fresh refrigerated produce and records a quality date.

For items stored in `Freezer`, Nora assumes continuous storage at 0°F (-18°C) or below unless told otherwise. AI-estimated freezer dates are generous quality-review dates, not safety deadlines. Nora uses the upper end of item-specific freezer quality guidance and defaults to a 12-month quality-review date when no more specific duration is available. Passing that date indicates possible quality loss rather than proving continuously frozen food unsafe; thawed food receives the applicable refrigerated handling limit.

For a message such as "Costco full fat milk x3, expires in roughly 3 months," the structured result should identify:

- Item: Costco full-fat milk.
- Quantity: 3.
- Expiration: three months from the date added.
- Expiration confidence: approximate or user-estimated.

The interface always displays a calendar date. An AI-derived date is labeled **AI estimated**; an explicitly exact user-provided or image-read date is labeled **exact**. Vague user dates retain their approximate precision and display **Approximate**, even after conversion to a calendar date.

Nora's backend clock and configured household time zone are authoritative for resolving relative dates such as "in 3 months" and "next Friday," checking expiration, and timestamping logs.

Prepared or opened leftovers are tracked separately. The AI agent should provide one practical latest-use date based on the food type, preparation, known storage conditions, and refrigerator temperature. Nora should distinguish quality-related dates from safety-related dates and must not present smell or appearance as proof that food is safe.

When the user says an existing item was opened, unsealed, thawed, or first used, Nora treats the message as an inventory edit. The AI receives the matching current item and household date and proposes a replacement expiration based on the item's after-opening storage life. Quantity and unrelated fields remain unchanged, the update is audited, and ambiguous item references require clarification.

Items marked expired or determined to be definitely expired are not usable inventory. Nora excludes them from context for meal ideas, recipes, and substitutions. They remain visible only for review, correction, or discard and must never be recommended for consumption.

Nora should alert the user after an item is definitely expired, explain why it was flagged, and let the user discard it, correct its details, or keep the record. It must never remove an item automatically.

Keeping an expired record does not restore it to usable inventory. The item remains excluded from recipes and meal recommendations until the user explicitly corrects or replaces its expiration date.

## Inventory Data Model

Each inventory record should support:

- **Identity:** display name, normalized name, brand, and notes.
- **Quantity:** numeric or fractional amount and status such as available, low, empty, consumed, or discarded.
- **Unit:** count, weight, volume, or household wording such as `3 cartons`, `500 g`, `1 L`, `1 bunch`, or `half a jar`. Preserve the user's original unit when practical.
- **Location:** exactly `Fridge`, `Freezer`, or `Shelf` in the current interface. The optional storage field may hold a more specific detail such as `top shelf`, `freezer drawer`, or `spice rack`.
- **Category:** an editable category such as dairy, produce, meat, spice, cleaning supply, or medicine.
- **Storage details:** optional container, shelf, bin, or room information.
- **Dates and freshness:** added date, expiration or best-by date, source, precision, and confidence.
- **Date source:** user-provided, image-read, or AI-estimated.
- **Date precision:** exact, approximate, or unknown.
- **Source and history:** whether the item came from chat, photo, barcode, receipt, or manual entry, plus later changes.

Nora may merge a newly added item into an existing inventory entry only when the product identity, unit, location, expiration date, expiration source, and expiration precision match. Items with different expiration details remain separate batches even when they are otherwise the same product.

## Storage and Logging

Use a relational, SQL-compatible data model. SQLite is the preferred starting database because it runs locally with minimal setup and can later migrate to a server-hosted SQL database.

Keep inventory items, locations, inventory edit logs, and debug logs in separate related tables. Do not store the entire inventory as one unstructured document.

Every inventory edit must record:

- Timestamp.
- Affected item.
- Action.
- Previous value.
- New value.
- Change source.
- Original user message.
- AI action and assumptions.
- Validation result.

The separate debug log records parsed intent, assumptions, errors, API failures, and system events without exposing sensitive credentials.

Retain debug logs for a rolling 90-day period. Keep inventory edit history permanently unless the user explicitly deletes it in a future data-management workflow.

Retain visible chat history for 60 days. The initial conversation view loads only the newest 30 retained messages. When the user scrolls upward to the top threshold, Nora loads the next 30 older messages while preserving scroll position; it does not preload all retained chat. Deleting an expired chat message must not remove or alter inventory changes and audit events that resulted from it.

All session and data-retention periods must be configuration values rather than hard-coded behavior. Initial defaults are:

- Session idle timeout: 15 days.
- Session maximum lifetime: 30 days.
- Uploaded-image lifetime: 30 days.
- Chat-history lifetime: 60 days.
- Debug-log lifetime: 90 days.
- Inventory edit history: permanent.

## Deployment

- **Target host:** Ubuntu 26.04.1 LTS on `x86_64`, kernel `7.0.0-31-generic`.
- **Container runtime:** Docker `29.5.0` with Docker Compose `v5.1.3`.
- **LAN address:** `192.168.50.39`, reserved in the router's DHCP configuration. The `172.x` host addresses are Docker bridge networks and are not used for local DNS.
- **IPv6:** The host has globally routable IPv6 addresses. Firewall rules must restrict Nora on both IPv4 and IPv6; relying only on the absence of IPv4 port forwarding is insufficient.
- **Private DNS:** Pi-hole provides local DNS. Configure `nora.shuainium.com` as a local DNS record resolving to `192.168.50.39`, and configure VPN clients to use Pi-hole for DNS.
- **Remote access:** WireGuard runs on the home router. WireGuard clients must receive or use Pi-hole as their DNS resolver and have a route to the `192.168.50.0/24` LAN so `nora.shuainium.com` reaches the private server address.
- **Public DNS provider:** Cloudflare manages `shuainium.com`. Use a narrowly scoped Cloudflare DNS API token for the ACME DNS-01 challenge so Traefik can obtain TLS certificates without exposing Nora to the internet. Do not use a Cloudflare Tunnel or create a public Nora address record.
- Package Nora as Docker containers managed with Docker Compose.
- Persist the SQLite database, uploaded images, and application logs outside the disposable application container using mounted local volumes.
- Make Nora available at `nora.shuainium.com` only from the home LAN and home VPN.
- Use local or split-horizon DNS so that hostname resolves to the server's private IP for LAN and VPN clients.
- Do not publish Nora in public DNS or forward Nora's HTTP/HTTPS ports from the internet-facing router.
- Put a reverse proxy in front of Nora for its hostname and TLS handling.
- Publish only `192.168.50.39:443` from Docker. Keep application ports on the private Docker network and do not publish an unencrypted HTTP fallback.
- Do not mount the Docker socket into Nora or its reverse proxy.
- Mount the Cloudflare token read-only only into the reverse proxy; application containers must not have access to it.
- Permit inbound access only from trusted LAN and VPN subnets. Nora may still make outbound requests to the configured AI API.
- Store API keys and other secrets in environment or secret files that are not committed to source control.
- Back up the persistent SQLite and upload volumes regularly.
- Create one automatic backup of the persistent SQLite database and retained uploads per day.
- Store backups inside a dedicated directory within the Nora repository, such as `backups/`, and exclude that directory from Git.
- Retain the latest 30 daily backups and automatically prune older backup files.
- Repository-local backups protect against application and database mistakes but do not protect against loss or failure of the server disk.

## Access Control

- Nora is reachable only from the trusted home LAN or home VPN.
- Nora uses a single-user password rather than passkeys or phone-IP allowlisting.
- Store only a strong password hash, never the plaintext password.
- After successful login, remember the browser with a server-side session and a secure HTTPS-only cookie.
- Sessions expire after 15 days of inactivity and always expire after a maximum of 30 days, even when actively used.
- Support manual logout and server-side revocation of all active sessions.
- Other LAN or VPN users may reach the login screen but cannot view or modify inventory without the password.

## AI Data Boundary

- Nora may send the AI service project source code, inventory records, and inventory-related content needed for the current request.
- Inventory-related content may include the user's current message, uploaded images, relevant inventory history, locations, timestamps, preferences, and prior inventory actions.
- For barcode lookup, Nora may send only the decoded numeric barcode to the configured public product database. Barcode images remain local.
- Send only the subset needed for the current request rather than the entire database or history by default.
- Never send credentials, API keys, passwords, session tokens, secret files, or unrelated host and household data.
- Treat debug logs as private diagnostic data; do not send them unless sensitive fields have been removed and the user explicitly requests AI-assisted debugging.

## Technology Stack

- **Language:** TypeScript.
- **Web application:** Next.js with React and the App Router, self-hosted as one Node.js application.
- **Database:** SQLite through Prisma ORM's established SQLite connector and migrations, using tested stable package versions.
- **Validation:** Zod schemas between AI responses, application logic, and database writes.
- **AI integration:** A provider-neutral application interface with provider-specific adapters. Select the active provider and model through configuration rather than hard-coding either one.
- **Verified development provider:** Groq is reachable from the host, and `qwen/qwen3.8-27b` has been verified for structured vision output using both remote image URLs and locally encoded base64 image uploads. Treat the model ID as configurable because provider model availability may change.
- **Testing:** Vitest for application logic and Playwright for browser workflows.
- **Packaging:** Docker and Docker Compose.
- **Reverse proxy:** Traefik with file-provider routing and ACME DNS-01 certificate renewal. Do not enable its dashboard or Docker-socket provider.

## MVP Requirements

- Local-only persistence with no accounts or cloud sync.
- SQLite-backed relational storage.
- AI-powered, structured text-to-inventory conversion through a replaceable provider adapter.
- Rejection of obvious non-food objects without changing inventory.
- Chat-based add, consume, update, discard, query, correction, and undo actions.
- Item name, quantity, unit, category, location, added date, expiration date, date source, and precision.
- An on-demand, human-readable kitchen inventory grouped by category, showing each item's Fridge, Freezer, or Shelf location and synchronized with the database.
- Expiration-first inventory ordering with expired and seven-day freshness badges.
- Audited, undoable one-step quantity controls.
- Authenticated local CSV and JSON inventory exports.
- A compact AI-provider availability indicator.
- Full photo-to-inventory recognition, including image attachment, item detection, quantity and unit extraction, and visible expiration information.
- Receipt-to-inventory proposals with explicit user confirmation.
- Local UPC/EAN decoding and Open Food Facts product lookup with explicit user confirmation.
- In-app three-day expiration reminders and overdue-leftover disposal reminders.
- AI-estimated expiration when manual information is unavailable.
- Current date, time, and household time-zone awareness.
- Persistent inventory edit and debug logs.
- Transaction-safe database changes with visible assumptions and undo.
- Definitely-expired alerts without automatic removal.
- Exclusion of expired items from meal recommendations.
- Leftover tracking with one practical AI-estimated latest-use date.
- On-request meal, recipe, and shopping recommendations through the configured AI agent.
- No manual inventory-editing fallback; display an on-screen notice when the configured AI service is unavailable.

## Nice Later Ideas

- Recipe integrations.
- An inventory-based meal discovery page that shows AI-recommended dishes from current non-expired inventory, recipes, and clearly identified missing ingredients.
- A dedicated food-type shelf-life system for automatic expiration estimates. The MVP uses the configured AI agent's general estimate when no manual date is available.

## Not Planned Yet

- In-fridge cameras or automatic fridge photography.
- Shared household inventory.
- Whole-home inventory beyond the implemented Fridge, Freezer, and Shelf food locations.
- Dietary-preference and allergy filters.
- Built-in weekly meal-planning logic. Open-ended meal planning belongs to the AI agent.
