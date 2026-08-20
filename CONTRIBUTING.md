# Contributing to OpenFireWatch

Thanks for considering a contribution. This is an early warning system, so the
bar for correctness is higher than for a typical side project — but the setup
is deliberately simple, and small focused changes are the easiest to review.

## Getting the stack running

```bash
git clone https://github.com/michifueby/OpenFireWatch.git
cd OpenFireWatch
cp .env.example .env      # then fill in FIRMS_MAP_KEY and the two secrets
docker compose up --build
```

Everything runs in containers — no local Node.js or PostgreSQL required. The
map is at <http://localhost:4200>, the API docs at
<http://localhost:8000/api/docs>.

Generate the two secrets rather than keeping the example values:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # OPERATOR_API_KEY
```

## Running the tests

The end-to-end suite runs against real PostGIS and Redis — it does not mock the
infrastructure, because the spatial queries *are* the logic worth testing. It
needs the development compose override (which publishes the database and broker
on localhost) plus the credentials from `.env`:

```bash
docker compose up -d
cd backend && set -a && . ../.env && set +a && npm run test:e2e
```

The suite creates its own isolated database and Redis logical DB, so it never
touches your development data.

## Conventions

- **English everywhere** — code, comments, commit messages, documentation.
  User-facing strings are the exception: those live in the translation
  dictionaries and must be provided in both English and German.
- **[Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **TypeScript is `strict`** in every package. No `any` escapes.
- **Spatial logic belongs in PostGIS**, not in application code. If you are
  about to compare coordinates by hand, there is probably an `ST_` function
  that does it correctly and uses the index.
- **Comment the *why*.** The *what* is visible in the code; the reasoning
  behind a threshold, a fallback or an ordering decision is not.

## What a good pull request looks like

1. Branch from `main`: `git checkout -b feat/my-change`.
2. Keep it focused — one concern per PR reviews far faster than five.
3. Add or adjust tests for behaviour you change. Detection and escalation
   rules in particular should never change without a test that would have
   caught the old behaviour.
4. `docker compose up --build` must still come up cleanly, and CI must be
   green (it runs the E2E suite plus a typecheck and production build of every
   package).
5. Describe the problem, not just the solution — it helps reviewers judge
   whether the approach fits.

## Changing detection or escalation rules

Thresholds live in one place on purpose:
[`backend/src/evaluation/alert-level.enum.ts`](backend/src/evaluation/alert-level.enum.ts).
They are engineering defaults, not doctrine — but they are also the difference
between a real alert and a missed one. If you change one, say in the PR *why*,
and remember which direction is dangerous: understating a real fire is far
worse than an extra false alarm.

## Hazard zones

The bundled Föhrenwald zone is a demonstration boundary derived from
OpenStreetMap land cover. It is **not** an official hazard or contamination
map. Do not add zones that imply otherwise without a citable source, and never
present derived geometry as an authoritative boundary.

See [docs/monitoring-areas.md](docs/monitoring-areas.md) for how zones and the
monitored satellite area relate.

## Versioning and releases

The root `VERSION` file is the single source of truth. Three `package.json`
manifests, the OpenAPI document, the about panel and the image labels all
derive from it — never edit any of them by hand. CI fails the build if they
drift apart.

```bash
scripts/version.sh --check   # verify every copy agrees
scripts/version.sh 0.2.0     # set a new version everywhere
```

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Below `1.0.0` the HTTP API, the WebSocket payloads and the database schema may
still change between minor releases, so:

| Change | Bump |
| --- | --- |
| A new detection rule, endpoint, or panel | minor (`0.1.0` → `0.2.0`) |
| A fix that changes no interface | patch (`0.1.0` → `0.1.1`) |
| A renamed field, removed endpoint, or altered alert semantics | minor, until `1.0.0` — and say so plainly in the changelog |

`1.0.0` is reserved for the point at which the hazard zones have been reviewed
by the fire service that would rely on them. Until then the shape of the data
is still a question rather than a commitment.

### Cutting a release

```bash
scripts/version.sh 0.2.0
# move the Unreleased entries in CHANGELOG.md under [0.2.0] with today's date
git commit -am "release: v0.2.0"
git tag -a v0.2.0 -m "OpenFireWatch v0.2.0"
git push --follow-tags
```

### Deploying

On the server, use the deploy script rather than `docker compose` directly:

```bash
cd /opt/openfirewatch && git pull && deploy/deploy.sh
```

It passes the version and the exact commit into the build, so the images carry
standard OCI labels and the running services can say what they are:

```bash
curl -s https://openfirewatch.org/api/health
# {"status":"ok","version":"0.2.0","revision":"a1b2c3d"}
```

That `revision` is the field worth checking after a deploy. The version only
moves on a release, so between releases it cannot tell you whether the fix you
just pushed is the one that is running — the commit can.

## Reporting problems

Open an issue for anything larger than a quick fix so the approach can be
discussed first. For **security** issues, do not open a public issue — see
[SECURITY.md](SECURITY.md).

Please be kind and constructive; we follow the
[Contributor Covenant](CODE_OF_CONDUCT.md).
