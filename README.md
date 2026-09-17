# Nora

Nora is a private, local-first kitchen inventory notebook for the fridge, freezer, and shelf, with a chat interface and a bridge to a replaceable AI provider. It turns natural-language messages and grocery photos into validated inventory changes while keeping SQLite, authority, and audit history local.

The complete product and security contract lives in [spec.md](spec.md). That document is authoritative for behavior, scope, prompts, data handling, and deployment decisions.

## Current Status

Nora is a Next.js application with SQLite inventory, password authentication, chat updates, photo confirmation, undo, audit history, and daily maintenance. Its configured LAN/VPN address is:

```text
https://nora.shuainium.com
```

The current deployment includes:

- A Next.js application running as the unprivileged `node` user with a read-only root filesystem.
- Traefik on `192.168.50.39:443` with automatic ACME DNS-01 certificates.
- Pi-hole split DNS mapping `nora.shuainium.com` to the private server address.
- No public address record, router port forwarding, Cloudflare Tunnel, Docker socket mount, or directly published application port.
- A verified Groq connection with structured image recognition through `qwen/qwen3.8-27b`.

Groq is the first provider adapter; model selection is configurable. AI failures leave inventory unchanged and display a notice. The legacy `static/` prototype and `nginx.conf` are retained for reference but excluded from the application image.

## Fresh-Host Setup

### 1. Prepare the host

Install Git, Docker Engine, and the Docker Compose plugin. Reserve a private LAN address for the host in the router and confirm that inbound Internet port forwarding is disabled.

Clone Nora and enter the repository:

```bash
git clone YOUR_REPOSITORY_URL Nora
cd Nora
```

Copy `.env.example` to `.env` and set `NORA_LAN_IP` for the new host. The file also configures the AI model, time zone, session lifetimes, and retention periods. Keep the HTTPS binding on a private address rather than `0.0.0.0`, and make sure host port `443` is free:

```bash
ss -ltn '( sport = :443 )'
```

### 2. Configure private DNS

In Pi-hole, add a local DNS record:

```text
nora.shuainium.com -> <Nora private LAN address>
```

Configure WireGuard clients to use Pi-hole for DNS and route the home LAN. Do not create a public `A` or `AAAA` record, enable a Cloudflare Tunnel, or forward port `443` on the router.

### 3. Create external secrets

For a fresh host only, create the root-only secret directory and files. These commands skip files that already exist:

```bash
sudo install -d -m 700 -o root -g root /etc/nora/secrets
sudo test -f /etc/nora/secrets/cloudflare_dns_token || sudo install -m 600 -o root -g root /dev/null /etc/nora/secrets/cloudflare_dns_token
sudo test -f /etc/nora/secrets/groq_api_key || sudo install -m 600 -o root -g root /dev/null /etc/nora/secrets/groq_api_key
```

Create a Cloudflare API token limited to the `shuainium.com` zone with only **Zone DNS Edit** and **Zone Read** permissions. In Bash with shell tracing disabled (`set +x`), enter it without placing its value in shell history:

```bash
read -rsp 'Cloudflare DNS token: ' NORA_SECRET; echo
printf '%s' "$NORA_SECRET" | sudo tee /etc/nora/secrets/cloudflare_dns_token >/dev/null
unset NORA_SECRET
```

Enter the Groq API key the same way:

```bash
read -rsp 'Groq API key: ' NORA_SECRET; echo
printf '%s' "$NORA_SECRET" | sudo tee /etc/nora/secrets/groq_api_key >/dev/null
unset NORA_SECRET
```

Confirm metadata only; never print either file:

```bash
sudo stat -c '%U %G %a %n' \
  /etc/nora/secrets/cloudflare_dns_token \
  /etc/nora/secrets/groq_api_key
```

Both files should report `root root 600`.

The app startup process copies the Groq key into container-only tmpfs with mode `400`, then drops to UID 1000. The original key remains root-owned. Only the proxy mounts the Cloudflare token. No secret value appears in Compose environment variables.

### 4. Prepare persistent certificate storage

Traefik runs without filesystem-bypass capabilities, so its certificate directory must be root-owned:

```bash
sudo install -d -m 700 -o root -g root data/letsencrypt
```

The `data/` directory is Git-ignored. On a migration, restore persistent application data and backups separately according to `spec.md`; do not commit them to Git.

### 5. Start and verify Nora

```bash
docker compose up -d --build
docker compose ps
docker compose logs --no-color --tail=100 nora-proxy
```

Create your password interactively on the server. It is hidden while typing, stored only as a salted scrypt hash, and never sent to Groq:

```bash
docker compose exec --user node nora npm run setup
```

Use at least 12 characters. The same command resets the password and revokes all sessions. Until setup completes, the app denies access to inventory and AI endpoints. The browser provides logout and sign-out-all-devices controls.

Open `https://nora.shuainium.com` from a LAN or WireGuard device. Verify from the host without depending on its DNS configuration:

```bash
NORA_LAN_IP=192.168.50.39 # Replace this after a host-address change.
curl --fail --head \
  --resolve "nora.shuainium.com:443:${NORA_LAN_IP}" \
  https://nora.shuainium.com/
```

The response should be successful with a trusted certificate. `docker compose ps` should show only the private-address HTTPS binding; the application container must not publish its internal port to the host.

## Run

Start or rebuild Nora:

```bash
docker compose up -d --build
```

Check container health and logs:

```bash
docker compose ps
docker compose logs
```

Stop the deployment:

```bash
docker compose down
```

## Repository Layout

```text
.
├── README.md                 Project overview and operations
├── spec.md                   Authoritative product specification
├── compose.yaml              Private Docker deployment
├── Dockerfile                Application image
├── prisma/                   Relational schema and versioned migrations
├── src/app/                  Chat interface and authenticated HTTP routes
├── src/ai/                   Provider adapter and versioned prompt files
├── src/lib/                  Validation, sessions, and inventory transactions
├── scripts/                  Password setup, maintenance, and smoke tests
├── tests/                    Database, API, session, and browser tests
├── traefik-dynamic.yaml      Private HTTPS routing
└── static/                   Legacy prototype (not deployed)
```

Secrets are stored outside the repository under `/etc/nora/secrets/` and must never be committed, printed, or copied into application logs. Runtime data, certificate state, uploads, and backups remain Git-ignored.

## Backups and Migration

Persistent state is in `data/app/nora.db` and `data/app/uploads/`. The maintenance service removes expired uploads/chat/debug records and creates one SQLite snapshot plus retained uploads per day in `backups/YYYY-MM-DD/`, retaining 30 daily snapshots by default. These backups contain private inventory and password hashes; protect them like the live database. Original messages attached to inventory audit events are retained with those permanent events.

To migrate, stop Nora with `docker compose down`, then transfer `data/app/`, `data/letsencrypt/`, and `backups/` over your trusted LAN/VPN using a tool that preserves permissions. Transfer `/etc/nora/secrets/` separately using a protected channel. Restore application data and backup ownership to UID/GID `1000:1000`, keep certificate state root-owned, and keep secrets `root:root 600`. Update the new host's private IP in `.env` and Pi-hole, then start Compose. Never run two hosts against the same SQLite file.

To restore a daily backup, stop Compose, preserve the current `data/app/` directory as a rollback copy, and recreate it from the selected backup's `nora.db` and `uploads/`. Restore ownership to `1000:1000` and restrictive permissions, start Nora, and reset the password with `npm run setup` above to revoke restored sessions. Backups do not include the Cloudflare token or Groq key. Local backups do not protect against disk loss; keep an encrypted copy on another trusted disk.

## Development Checks

Use Node.js 22 with `npm ci`. Keep test databases separate from production:

```bash
export DATABASE_URL=file:/tmp/nora-test.db
npx prisma generate
npx prisma migrate deploy
npm test
npm run build
```

Browser tests live in `tests/browser/` and use a disposable database/password fixture. `scripts/test-seed.ts` refuses to seed any database except `file:/tmp/nora-e2e.db`. Live Groq smoke tests send only synthetic text and a synthetic grocery label; they require the protected key and consume provider quota.

## Implementation Rule

Code, runtime prompts, schemas, tests, and deployment configuration must implement [spec.md](spec.md). When implementation and specification disagree, the specification wins until the discrepancy is deliberately resolved in both places.
