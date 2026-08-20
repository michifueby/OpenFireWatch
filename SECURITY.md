# Security Policy

OpenFireWatch is an early warning system. A vulnerability here can do more than
leak data: it can suppress a real alert or fabricate a false one. Please treat
findings accordingly.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting instead:

> Repository → **Security** → **Report a vulnerability**

If that is unavailable to you, contact the maintainer through the profile at
<https://github.com/michifueby>.

Please include what you can: affected component, reproduction steps, and the
impact you see. A proof of concept helps, but a clear description is already
useful.

This is a volunteer-run open-source project — expect an initial response within
a few days rather than hours.

## Scope

Findings in this repository are in scope, most valuably:

- **Alert suppression** — anything that makes a genuine detection go
  unreported, silently downgrade, or fail to reach connected clients.
- **Alert fabrication** — injecting alerts without the operator key.
- **Hazard zone tampering** — creating, moving or retiring zones without
  authorisation, or destroying the `validated_events` audit trail.
- **Authentication bypass** on any write endpoint.
- Injection, SSRF, or deserialisation issues in the ingestion path, which
  processes third-party data (NASA FIRMS, GeoSphere, Open-Meteo).

Out of scope: vulnerabilities in the upstream data providers themselves, and
findings that require an attacker who already holds `OPERATOR_API_KEY`.

## Known limitations, by design

These are documented trade-offs rather than bugs. They are still worth
improving — a pull request is welcome — but a report telling us they exist
will not be treated as a new finding.

- **One shared operator key.** There are no user accounts, so writes cannot be
  attributed to an individual. A multi-user deployment needs real
  authentication and a per-user audit trail; the `ApiKeyGuard` is the seam
  where that belongs.
- **Reads are public.** Detections, hazard zones and the live alert feed are
  served without authentication. That is deliberate for a situation map, but
  it means zone geometry is public information in any deployment.
- **Swagger is exposed** at `/api/docs`.
- **The database and broker carry no TLS** inside the compose network. They
  are not published to the host in the production topology
  (`docker compose -f docker-compose.yml up`); if you split services across
  hosts, secure that transport yourself.
- **No rate limiting** on the API.

## Deploying safely

- Generate `POSTGRES_PASSWORD` and `OPERATOR_API_KEY` yourself
  (`openssl rand -hex 24`). The values in `.env.example` are public.
- Never commit `.env` — it is gitignored, and it should stay that way.
- Use the production topology so the database and broker are not reachable
  from the host, and terminate TLS in front of the API and web UI.
