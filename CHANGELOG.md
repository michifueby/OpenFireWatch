# Changelog

All notable changes to OpenFireWatch are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, the HTTP API, the WebSocket payloads and
the database schema may still change between minor releases. `1.0.0` is
reserved for the point at which the hazard zones have been reviewed by the
fire service that would rely on them — until then, the shape of the data is
still a question, not a commitment.

## [Unreleased]

### Added

- **Notification channels.** Critical alerts and a dead-man's switch for
  stalled ingestion are delivered off the map through configurable channels:
  a generic HMAC-signed webhook (which reaches anything — existing alerting,
  chat, an email relay) and Telegram. Deduplicated per event across replicas,
  retried with backoff, and every delivery outcome recorded so *was anyone
  told?* has an answer. A fresh deployment notifies nobody until a channel is
  configured. Adding a channel is one class and one line — see
  [docs/notifications.md](docs/notifications.md).

## [0.2.0] — 2026-08-21

### Added

- **Ground sensors (LoRaWAN).** Intake for temperature/soil-moisture sensors
  mounted in the risk areas (`POST /api/sensors/readings`, TTN-v3 webhook
  format accepted directly), guarded by a dedicated gateway token. When a
  detection lands in a zone with a fresh reading, the measured values replace
  the regional estimate as the ignition rule's inputs — and the alert names
  the sensor. Stale sensors fall back to the regional estimate.
- **Switchable base maps.** Dark (global), aerial imagery and terrain — the
  latter two from basemap.at, the official Austrian basemap under CC BY 4.0,
  whose orthophoto resolves single trees and forest tracks at 30 cm. The
  choice is remembered, and Austria-only sources are marked as such so nobody
  outside their coverage stares at blank tiles.
- **Sensor management in the UI.** The hazard-zones panel lists each zone's
  sensors with reporting state, values and battery; placing a sensor is a tap
  on the map, and its zone is derived from the position. Register, edit,
  reposition, calibrate and retire — no SQL required. Sensors show on the map
  as teal dots with a detail popup.

### Changed

- **Readability pass over the whole UI.** The muted label grey now meets
  WCAG AA on the dark panels, and no informational text renders below ~11 px
  any more — the smallest labels sat at 9 px, which read as decoration on a
  phone at arm's length.

### Fixed

- Aerial and terrain base maps rendered as a checkerboard of black gaps: four
  of the five basemap.at hostnames the service is commonly documented with do
  not resolve, so most tile requests failed. Only hosts verified to answer are
  used now, and each source carries its actual maximum zoom (imagery 19,
  terrain 17), so zooming past it stretches the last level instead of leaving
  holes.
- Adopting a drawn outline into the zone form silently failed in production
  (NG0600: signal writes inside effects are disallowed by default) — drawing
  a zone or placing a sensor now actually reaches the form.

## [0.1.0] — 2026-08-20

First tagged release. The system has been running publicly at
<https://openfirewatch.org> and is in use as a demonstration; everything below
describes what that deployment does.

### Added

- **Satellite ingestion.** NASA FIRMS (VIIRS) hotspots polled on a schedule
  into durable BullMQ queues, correlated at ingestion time with air
  temperature and humidity from GeoSphere Austria (TAWES) and topsoil
  moisture from Open-Meteo. Failed cycles retry with exponential backoff and
  land on a dead letter queue rather than being dropped.
- **The phosphorus rule.** A detection inside a white-phosphorus zone
  escalates when the ground is above 30 °C and topsoil moisture is below
  20 % — the conditions under which cracked, dry ground exposes buried
  WWII ordnance to oxygen.
- **Per-hazard escalation.** Wildfire, ammunition-depot and generic zones
  each carry their own criteria, so a zone is not judged by rules written for
  a different danger.
- **Smouldering nest detection.** Repeated weak detections in the same place
  across separate satellite passes are escalated on the evidence, which
  outranks the predictive weather gates.
- **Hazard zones in PostGIS.** `ST_Intersects` against GiST-indexed polygons,
  editable from the map without a redeploy, retired rather than deleted so
  their alert history survives.
- **Live situation map.** MapLibre GL, dark command-centre styling, pulsing
  markers for critical escalations, alerts pushed over Socket.IO from a Redis
  fan-out.
- **Alert history.** Every verdict since the first deployment is readable
  back, so a reload no longer wipes the picture.
- **Current conditions and per-zone readiness.** How far each zone is from
  its own threshold, in the operator's terms ("only 4 °C from ignition").
- **Acknowledgements.** Recorded in the database, shared across every device
  live, guarded by the operator key so a passer-by cannot silence an alarm.
- **Bilingual interface** (German and English), following the browser
  language, with an explicit switch.
- **Phone layout.** Bottom-sheet situation panel, touch-sized controls and
  safe-area handling, so the map is usable on the device people carry.
- **Operator API key** on every write, failing closed when unset.
- **German manual** for responders, residents and developers
  (`docs/handbuch/handbuch.pdf`).
- **Production deployment** with Caddy, automatic TLS, backups and hardening
  notes.
- **End-to-end tests** against real PostGIS and Redis, run in CI on every
  push.

### Fixed

- The API crashed at startup when `API_PORT` carried a host-interface prefix.
- The map overlay only followed zone changes made through the editor, not
  those made in SQL.
- The situation panel coloured detection-gated zones permanently red,
  spending the alarm colour on a property rather than a state.
- Critical markers were lost if an alert arrived while the map style was
  still loading, and were never restored after a reload.

[Unreleased]: https://github.com/michifueby/OpenFireWatch/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/michifueby/OpenFireWatch/releases/tag/v0.1.0
