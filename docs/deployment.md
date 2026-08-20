# Deployment on a Hetzner Cloud server

A step-by-step guide to running OpenFireWatch publicly on a small VPS for
roughly €4–5 a month. The `docker-compose.yml` from this repository runs
unchanged; a second file adds TLS.

> **Why a VPS and not GitHub Pages?** Pages serves static files only. This
> system needs a live PostGIS database, Redis, a WebSocket server, and workers
> that poll NASA every few minutes. Free platforms that sleep on inactivity are
> equally unsuitable: a sleeping worker fetches no satellite data, and an early
> warning system that is only awake when someone is watching warns nobody.

---

## 1. Create the server

| Setting | Recommendation |
| ------- | -------------- |
| Type | **CX22** (2 vCPU, 4 GB RAM, 40 GB) — the stack needs roughly 700 MB, the rest is headroom for the Angular build |
| Image | Ubuntu 24.04 LTS |
| Location | Nuremberg or Falkenstein for an Austrian deployment |
| SSH key | Add yours — do **not** use password login |
| Firewall | Allow inbound **22, 80, 443** only |

An x86 (CX) type matters: the `postgis/postgis:16-3.4-alpine` image is
amd64-only. On an ARM server you would have to swap it for a multi-arch build
such as `imresamu/postgis:16-3.4-alpine`.

## 2. Point your domain at it

Create an **A record** for your domain (and `www` if you want it) pointing to
the server's IPv4 address, and an **AAAA record** for its IPv6 address. Caddy
cannot obtain a certificate until this resolves, so do it first — DNS
propagation is usually minutes.

## 3. Prepare the server

```bash
ssh root@YOUR_SERVER_IP
```

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git ufw
systemctl enable --now docker
```

Firewall — note the caveat below:

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

> ⚠️ **Docker bypasses ufw.** Published container ports are inserted into
> iptables ahead of ufw's rules, so `ufw deny` does not close them. That is why
> step 5 binds the API and web UI to `127.0.0.1` — that, not the firewall, is
> what keeps them off the public internet.

Create a non-root user to run the stack:

```bash
adduser --disabled-password --gecos "" ofw && usermod -aG docker ofw
mkdir -p /opt/openfirewatch && chown ofw:ofw /opt/openfirewatch
```

## 4. Get the code

```bash
su - ofw
git clone https://github.com/michifueby/OpenFireWatch.git /opt/openfirewatch
cd /opt/openfirewatch
cp .env.example .env
```

## 5. Configure `.env`

Generate real secrets — the values in `.env.example` are public:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "OPERATOR_API_KEY=$(openssl rand -hex 24)"
```

Then edit `.env` and set:

```bash
POSTGRES_PASSWORD=<the generated value>
OPERATOR_API_KEY=<the generated value>
FIRMS_MAP_KEY=<your NASA key>

DOMAIN=your.domain
ACME_EMAIL=you@example.org

# Public URL. Without it the map stays silent even while the backend raises
# alerts: the Socket.IO handshake still answers 200, but without the
# access-control-allow-origin header, so the BROWSER discards it. Nothing
# looks wrong in the server logs — which is what makes this worth getting
# right the first time.
CORS_ORIGINS=https://your.domain

# Bind to loopback: only Caddy may be reachable from outside.
API_PORT=127.0.0.1:8000
FRONTEND_PORT=127.0.0.1:4200
```

## 6. Start it

```bash
deploy/deploy.sh
```

That is a thin wrapper around:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Naming the base file explicitly is deliberate: it skips
`docker-compose.override.yml`, which exists only to publish the database and
broker on localhost for development. The wrapper adds one thing on top: it
reads the release version and the exact commit out of the repository and
passes them into the build, so the images carry standard OCI labels and the
running services can tell you what they are.

The first build takes a few minutes. Verify the exposure is what you expect:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Only **caddy** may show `0.0.0.0:80` and `0.0.0.0:443`. Everything else must
read `127.0.0.1:…` or show no published port at all.

Watch the certificate being issued:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
```

Then open `https://your.domain`.

## 7. Load your hazard zones

The demo Föhrenwald zone is seeded automatically on first start. Add the
version-controlled ones:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  psql -U openfirewatch -d openfirewatch < deploy/zones/st-egyden-foehrenwald.sql
```

From here on, zones are managed in the UI — see
[monitoring-areas.md](monitoring-areas.md). The polled satellite area follows
the zones automatically, so there is nothing else to configure.

## 8. Backups

```bash
mkdir -p /opt/openfirewatch/backups
crontab -e
```

```cron
0 3 * * * cd /opt/openfirewatch && ./deploy/backup.sh >> /opt/openfirewatch/backups/backup.log 2>&1
```

The script dumps the database, fails loudly on a truncated dump, and prunes
anything older than 14 days. **Copy the directory off the machine too** — a
backup on the same disk survives a mistake, not a lost server.

Restore:

```bash
gunzip -c backups/openfirewatch_<stamp>.sql.gz | \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  psql -U openfirewatch -d openfirewatch
```

## 9. Updating

```bash
cd /opt/openfirewatch && git pull && deploy/deploy.sh
```

Only rebuilt services restart; the database and its volume are untouched.

Then confirm that what you pushed is what is running:

```bash
curl -s https://openfirewatch.org/api/health
# {"status":"ok","version":"0.1.0","revision":"a1b2c3d"}
```

`revision` is the field that matters here. The version only moves when a
release is cut, so between releases it cannot tell you whether the fix you
just deployed is live; the commit can. A `-dirty` suffix means the image was
built from a working tree with uncommitted edits — on a server, that is
usually a mistake worth looking into.

## Recurring costs

| Item | Cost |
| ---- | ---- |
| Hetzner CX22 | ~€4–5 / month |
| Domain | ~€10 / year (optional — use the server IP for testing) |
| TLS certificate | €0 (Let's Encrypt) |
| NASA FIRMS, GeoSphere Austria, Open-Meteo | €0 |

**One thing to check before going public:** the map uses CARTO's public
basemap URL. For a permanently public service, review their usage terms, or
switch to a provider with an explicit free tier and your own key (for example
MapTiler) in `map.component.ts`. Getting this wrong means the basemap quietly
stops loading one day.

## Operational notes

- **Logs:** `docker compose … logs -f workers` shows one line per ingestion
  cycle, including the resolved monitoring area.
- **Health:** `https://your.domain/api/health`.
- **API docs:** `https://your.domain/api/docs` — public by default. Put it
  behind Caddy basic auth if you would rather it were not.
- **Unattended upgrades:** `apt install -y unattended-upgrades` keeps the host
  patched; container images are updated by re-running step 9.
