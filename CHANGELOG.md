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

## [0.13.3] — 2026-08-26

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: the date field was invisible until something was chosen

## [0.13.2] — 2026-08-26

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: wording that says what it means, in both languages

## [0.13.1] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: the phone, measured across four screens instead of assumed

## [0.13.0] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: a page that answers whether the system is watching, and a map that can look back

## [0.12.1] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: the outlook repeated a zone type the workers saw an hour ago

## [0.12.0] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: a zone may be a forest and an ordnance site at once

## [0.11.2] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: the live cycle was watching one satellite out of three

## [0.11.1] — 2026-08-23

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: a replay that skipped its own last week, and said nothing about its findings

## [0.11.0] — 2026-08-22

### Added

- **A system-status section: "Schaut das System hin?"** Every feed reports
  when it last delivered — each satellite product separately, the weather,
  the forecast, the fire danger — plus what the record holds, how many
  sensors are reporting, how many jobs failed, and how far the archive has
  been replayed. It exists because on 14 August 2026 this deployment was
  healthy by every measure it had while polling one satellite out of three;
  the page is built around the distinction that hid it, that quiet is not the
  same as not looking. `missing` and `stale` are therefore different words,
  and a completed cycle that reached no instrument at all reads `blind`.
  `GET /api/status`; collapsed by default and polled only while open.
- **Time travel on the map.** A date field shows the detections of any past
  day, which after an archive replay is the view worth showing a fire
  brigade. A chosen day is a MODE, not a filter: the pulsing markers come off
  (they mean "this needs somebody now"), the camera stops chasing new alerts,
  and a banner says what is on screen. `GET /api/anomalies` gained an
  exclusive `until` bound.
- **A hazard profile for a site that is two hazards at once**
  (`white_phosphorus_forest`). The Föhrenwald is a pine forest standing on
  WWII white phosphorus, and the model forced a choice between them: as
  `wildfire` the ignition window was never computed, so ground sensors could
  not influence anything; as `white_phosphorus` a real fire on a cool April
  day would have stayed ELEVATED and paged nobody. The new profile escalates
  on any credible detection like a forest, **and** tracks, shows and
  forecasts the phosphorus window — naming the phosphorus mechanism, and
  ignoring the satellite's confidence rating, whenever that window is open. A
  self-ignition looks weak from orbit, which is exactly what is expected on
  such ground.
- **Satellite archive backfill.** An operator can replay any range of NASA
  FIRMS detections since 2012 through the live rule, against the weather of
  their own day. Replayed detections are stored and de-duplicated like any
  other but marked as history: they never alarm, page, pulse on the map or
  borrow today's sensor readings — and the incident register counts them,
  so a fire from before this system existed gets a checkable "would have
  alarmed: yes/no". Started from the panel under the register or
  `POST /api/backfill/satellite`; progress and coverage gaps are shown per
  run. Docs: `docs/satellite-backfill.md`.
- **Fire danger (Canadian FWI) on the panel and in the report.** The Canadian
  Fire Weather Index per zone — the method behind the EFFIS and national
  fire-danger maps — computed hourly by the workers from 92 days of weather
  plus the seven-day forecast, classed "very low" to "extreme" with
  tomorrow's trend, and recorded daily in `fire_danger_history`. Labelled
  "computed by the EFFIS method", never "official": no public endpoint
  returns the figure for a point. `GET /api/fire-danger`; folded into
  `GET /api/conditions` as `fireDanger`. Pinned to the published reference
  example by unit test. Docs: `docs/fire-danger.md`.

### Changed

- The incident register now asks two questions apart — **seen by the
  satellite** (any detection within 2 km) and **alert raised** — and judges
  both by the satellite's acquisition time rather than the evaluation time,
  so a verdict reached today about a pass in 2019 counts for the 2019 fire.
- The live map draws the last seven days of detections, like the history
  panel; the full table stays reachable through `/api/anomalies?since=`.
- Each backfill run reports **what the rule made of the replayed passes**,
  by alert level. "32 detections" says nothing on its own; "5 would have been
  critical" is the answer the replay exists to give. Counted on read, so the
  figure keeps up while the evaluation queue drains.

### Fixed

- **Touch targets on a phone, measured rather than assumed.** A sweep at
  375×812, 375×667, 320×568, landscape and tablet found four controls below
  this application's own 44 px standard — two of them mine from today, two
  older. The worst was `✓ Bestätigt` / `∅ Ohne Befund` at **19 px**: the half
  of the validation loop a responder closes in the field, on the device they
  are holding, and the smallest target in the application. Also `+ Sensor`
  and `+ Ereignis` (14 px — styled as inline links, but they start something)
  and the base-map switcher (36 px). All at 44 px now; the only small targets
  left are MapLibre's attribution links, which are required text rather than
  controls.
- **The time-travel banner covered the base-map switcher** on every phone.
  Fixing the switcher's own touch size then grew it into the banner again, so
  the depth of the top row is now a named value (`--ofw-top-rail`) beside the
  sheet height it mirrors — one place where raising it fixes both.
- **The outlook repeated a zone's hazard type as it was up to an hour ago.**
  The forecast snapshot carries a copy of each zone's name and type, taken
  when the workers last ran. Convert a zone and the readiness line changed at
  once — it reads the database — while the outlook kept insisting the
  ignition window did not apply. The API now re-reads both from the database
  and uses the snapshot only for the weather it was written to carry.
- **The live cycle watched one satellite out of three.** VIIRS flies on Suomi
  NPP, NOAA-20 and NOAA-21, about forty minutes apart on the same orbit —
  each a separate look at the ground. The ingestion polled only Suomi NPP.
  Over the Föhrenwald on 14 August 2026, NOAA-20 saw the fire at 10:41,
  NOAA-21 at 11:25 and Suomi NPP at 12:00: **79 minutes of warning given
  away**, and three quarters of the observations never fetched. All three are
  polled now (`FIRMS_SOURCES`); the legacy `FIRMS_SOURCE` is merged in rather
  than treated as an override, so a deployment carrying the old shipped
  default gains the other two instead of being frozen on one.
- **A pass published more than 24 hours late was missed for good.** Each
  cycle asked FIRMS for the last day only, so a pass held up in processing
  fell out of the window before the next cycle looked. The window is two days
  now (`FIRMS_LOOKBACK_DAYS`); re-asking costs nothing, because job ids and
  the database's unique constraint are both keyed on (source, pixel,
  acquisition time).
- The satellite backfill checked for the weather it needs by total hours over
  the range, which a range ending near today passes with room to spare while
  missing its last week entirely — the nightly weather job stops six days
  short. Detections in that tail were then dropped for want of conditions.
  Counted per day now: a run over 17–23 August fetched 168 hours per zone
  where it previously fetched none.

## [0.10.1] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- fix: say what happens, not what the mechanism is called

## [0.10.0] — 2026-08-21

### Changed

<!-- Written from commit subjects: no Unreleased notes existed at release
     time. Worth rewriting for a reader who does not read diffs. -->
- feat: the situation report — everything the system knows, dated, on paper

## [0.9.0] — 2026-08-21

### Changed

- **Plain language throughout.** "Eskaliert bei jeder glaubwürdigen
  Detektion" now reads "Alarm bei jeder erkannten Hitzequelle — unabhängig
  vom Wetter", "keine Wetterfrage" became "Wetter spielt hier keine Rolle",
  the THERMAL ANOMALY level is now UNUSUAL HEAT / UNGEWÖHNLICHE HITZE, and
  the page title names dangerous heat sources instead of thermal anomalies —
  consistently across the panel, the forecast, the PDF report, notifications
  and the manual.

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

- **Situation report as PDF.** `GET /api/report/lagebericht.pdf` (linked from
  the info panel) renders the whole picture into one dated document: current
  conditions and readiness, open alerts, the ignition forecast, the seasonal
  record with drawn year bars, the incident report card, sensors — and the
  system's limits inside the document itself, so the report cannot be quoted
  without its assumptions. German by default, `?lang=en` for English; the
  same numbers the API serves, never computed separately.

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

[Unreleased]: https://github.com/michifueby/OpenFireWatch/compare/v0.13.3...HEAD
[0.13.3]: https://github.com/michifueby/OpenFireWatch/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/michifueby/OpenFireWatch/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/michifueby/OpenFireWatch/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/michifueby/OpenFireWatch/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/michifueby/OpenFireWatch/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/michifueby/OpenFireWatch/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/michifueby/OpenFireWatch/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/michifueby/OpenFireWatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/michifueby/OpenFireWatch/releases/tag/v0.1.0
