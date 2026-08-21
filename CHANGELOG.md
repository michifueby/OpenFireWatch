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

## [0.9.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: the probe can raise the alarm itself — and speak English

## [0.8.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: wind on the panel, the record as CSV — and two bugs en route

## [0.7.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: escalate the alert nobody took

## [0.6.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: incident register — the thresholds get a report card

## [0.5.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: seasonal ignition history — how unusual is this year, actually

## [0.4.0] — 2026-08-21

### Added

- **Sensor-raised alerts.** A ground probe can now raise an alarm itself —
  the case no satellite sees: smouldering under the surface or under a closed
  canopy. Absolute threshold (50 °C) or an abnormal climb (+15 K over the
  six-hour median, 35 °C floor), both on calibrated values, one alert per
  probe per episode. The result is an ordinary critical alert: same map,
  acknowledgement, escalation, notifications and incident validation.
- **Notification language.** `NOTIFY_LANGUAGE=de|en` — all message texts in
  one typed module instead of hard-coded German across five services.

- **Wind in the conditions panel.** The TAWES station reports it and nothing
  showed it; for a responder, wind is the spread-direction question. Shown as
  "10 km/h aus SO", and the row disappears when the station has no anemometer
  rather than pretending a dash is a reading.
- **CSV export of the seasonal record.** `GET /api/history/ignition-windows.csv`
  — semicolon-delimited with a BOM, so a German-locale Excel opens it intact.
- **Escalation for unacknowledged alerts.** A critical alert that nobody has
  taken within `NOTIFY_ESCALATE_MINUTES` (default 15) triggers one reminder
  through every configured channel — once per alert, never repeated, and never
  for an alert somebody has acknowledged.
- **Incident register and validation.** Real events — fires, drills,
  observations, including ones from years past — recorded in the operator
  panel with a tap on the map. Every fire is automatically held against the
  ignition-window history (was the window open in that hour?) and the alert
  record (did the system warn?), and crews can record on each alert whether
  anything was actually found. Together that produces the numbers no warning
  system likes to publish: hit rate and false-alarm rate. It is the first
  mechanism that makes the literature thresholds testable against this site.
- **Seasonal ignition history.** How often each zone has actually met its
  ignition criteria, by year and month, over a decade of reanalysis weather
  backfilled per zone. The project's own records could never answer this —
  they are written only when a satellite detects something — so a hot, dry day
  without a detection left no trace. For the Föhrenwald: 13.8 days per year on
  average, with 2024 and 2026 the two highest in the record. See
  [docs/seasonal-history.md](docs/seasonal-history.md).
- **Ignition-window forecast.** The phosphorus rule read forwards instead of
  backwards: a seven-day hourly outlook per weather-gated zone saying when
  temperature and topsoil moisture are next expected to meet the ignition
  criteria at the same hour. Shown in the situation panel and, inside a
  three-day horizon, sent through the notification channels as a warning. The
  detection pipeline can only report a fire a satellite has already seen —
  this is the same rule used to prepare rather than to report. See
  [docs/forecast.md](docs/forecast.md).

## [0.3.0] — 2026-08-21

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

### Changed

- **Icons instead of emoji.** The four emoji in the interface carried their
  own colours into a palette where red means "alarm" and nothing else may
  claim it, rendered as a different picture on every platform, and were read
  aloud by name in the middle of a heading. They are now inline SVG in
  `currentColor`, so an alert marker is red because the alert is critical.
  Seven hand-drawn icons, no icon library and nothing fetched at runtime.

### Fixed

- Rebuilding the backend container left the site's API answering 502 until
  the frontend was restarted too: nginx pins the upstream IP it resolves at
  startup. It now re-resolves per request via Docker's DNS, so a backend
  redeploy no longer looks like a backend crash.
- The CSV export shifted every ignition-window day into the previous date on
  any server east of Greenwich — a date column round-tripped through a local
  JS Date. The database now formats the date as text.

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

[Unreleased]: https://github.com/michifueby/OpenFireWatch/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/michifueby/OpenFireWatch/releases/tag/v0.1.0
