# Frontend architecture

How the Angular application is organised, and why. The backend counterpart is
[architecture.md](architecture.md); this document covers only what runs in the
browser.

---

## 1. Folders follow features, not file types

```
src/app/
├── app.component.ts          shell: the map, with three overlay panels on top
├── app.config.ts             what the application is assembled from
├── core/                     cross-cutting; knows about no feature
│   ├── api/                  the HTTP layer (below)
│   ├── i18n/                 runtime translation
│   └── models/               payloads shared with the backend
├── features/                 one folder per thing the system does
│   ├── about/
│   ├── alerts/               dashboard shell, live alert list, the record
│   ├── conditions/           what the ground is doing right now
│   ├── forecast/             when the ignition window next opens
│   ├── history/              how often it opened in past seasons
│   ├── incidents/            the register of what actually happened
│   ├── map/                  MapLibre, basemaps, the drawn overlays
│   ├── operator/             the console that hosts the editing sections
│   ├── sensors/              ground probes
│   └── zones/                hazard polygons
└── shared/ui/                the icon component and its path data
```

Inside a feature:

| Folder | Holds |
| ------ | ----- |
| `data-access/` | the service that talks to the API, and the types it returns |
| `ui/` | presentational components the feature's host composes |
| *(root)* | the feature's own panel, plus any pure logic worth testing alone |

The rule that keeps this honest: **a feature owns both its data and its
screen**. Before this layout, `core/services/` held four services that were
each about exactly one feature, while `incidents/` held an API client whose
entire user interface lived inside the zones editor. Two folders had to be
opened to change one thing.

Imports cross folders by alias — `@core/…`, `@features/…`, `@shared/…` — and
stay relative inside one. A relative path with three `../` in it is a
statement that something is in the wrong place; making that visible is the
point.

---

## 2. Every request goes through one door

```
component → feature repository → ApiClient → HttpClient → interceptor
                                                              │
                                              attaches X-API-Key, drops it on 401
```

- **`core/api/api-client.ts`** wraps `HttpClient` in a promise-shaped surface,
  because every caller here is a one-shot command written in `async/await`.
  It is also the one place an HTTP failure becomes an `ApiError`.
- **`core/api/operator-key.interceptor.ts`** attaches the operator credential
  to same-origin writes and clears it the moment the server refuses it. This
  used to be five copies of the same eight lines — five places to forget the
  header, and five to forget that a 401 has to lock the panel.
- **`core/api/api-error.ts`** states what a status means, once: 401 and 503
  both leave the operator unable to write, so both surface as `locked`; every
  other failure surfaces the API's own message ("ring must be closed") rather
  than a number.
- **`core/api/polled-resource.ts`** is the timer three services had each
  written out by hand. It runs outside Angular's zone so a poll that finds
  nothing does not wake change detection, and it keeps the last known value
  when a request fails — stale conditions are useful, a blank panel is not.

Feature services are **repositories**: they expose `list()`, `create()`,
`retire()` and a `revision` signal, and nothing above them ever sees a URL.

---

## 3. State is signals; events are streams

`RealTimeAlertService` is where the distinction is easiest to see:

| Exposed as | Why |
| ---------- | --- |
| `anomalies$`, `criticalAlerts$` — Observables | Things that HAPPEN. The map's camera must react to an alert *arriving*, not to the fact that one exists; flying on a state change would yank the view every time the history reloaded. |
| `activeWarnings`, `history`, `connected` — signals | Things that ARE. A template asking "what is outstanding?" wants the current answer, and a signal is that. |

Every component uses `ChangeDetectionStrategy.OnPush` (the lint config
enforces it) and the built-in control flow (`@if` / `@for` with `track`).

Two traps worth knowing about, both of which this codebase has fallen into:

- **Signal writes in effects fail silently in production.** Angular raises
  NG0600 in development and does nothing in a production build. Both map →
  form hand-offs shipped broken this way. They now pass
  `{ allowSignalWrites: true }`, which is safe here because the hand-off is
  one-way.
- **A side effect inside an effect subscribes to whatever it reads.** Starting
  a map gesture repaints the draft layer, and repainting reads the draw
  service's own signals — so the click that answered the question re-ran the
  effect, which restarted the gesture and discarded the answer. Wrapping the
  call in `untracked()` is the fix; `sensor-form.component.spec.ts` is the
  regression test, and it only reproduces the bug with a map attached.

---

## 4. Composition instead of god components

Two components used to carry most of the application:

| Was | Is now |
| --- | ------ |
| `alert-dashboard.component.ts`, 1330 lines: conditions, forecast, alerts, seasons and the record in one class with 695 lines of inline CSS | a 138-line shell that owns the sheet, composing five feature components that each fetch their own data |
| `zone-editor.component.ts`, 637 lines + 519 of template: three drafts, three confirmations and thirty setters | an operator console that shows one section at a time, plus three form components that each own their draft and hand back a finished payload |

The forms are **presentational**: `[zone]` in, `(save)` out. The console never
sees a half-typed name, and the form never sees an HTTP error it cannot
phrase.

The map is split the same way, into one object per thing drawn
(`features/map/overlays/`). Every overlay has the same three-part life —
register a source, register layers, load data — and every one of them has to
survive a basemap change, because `setStyle` discards anything that is not
part of the new style. Keeping the three parts together is what makes
"reinstall everything" a loop over four collaborators.

---

## 5. Styles

Component stylesheets are files, not template literals. What several
components share lives in `src/styles/`:

- `_tokens.scss` — the one red that means "act now", the monospace stack every
  measured value is set in, the single breakpoint.
- `_operator-kit.scss` — the console's buttons, fields and record rows, as
  mixins, so each section pulls in only the part it renders and there is one
  definition of what a "danger" button looks like.

Both are on the Sass load path (`stylePreprocessorOptions.includePaths`), so a
component writes `@use 'tokens' as *;`.

---

## 6. Checks

```bash
npm run lint     # OnPush everywhere, ofw- prefixes, no floating promises
npm test         # 60 unit tests, headless Chrome
npm run build    # production bundle
```

The unit suite deliberately covers what a browser check cannot reach cheaply:
how a failed write is phrased at every status code, how a readiness line reads
at every threshold, how a forecast is worded in both languages, and the
map-gesture hand-off described above. All three run in CI on every push.
