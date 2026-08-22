# Fire danger (Canadian FWI)

The line under the readings: **Waldbrandgefahr (FWI): hoch · FWI 24** — and
why it says "computed", not "official".

---

## What it is

The Canadian Forest Fire Weather Index System (Van Wagner 1987) is the method
behind the European Forest Fire Information System's daily map, behind
GeoSphere's fire-danger products, and behind the national maps a fire brigade
already reads. It takes noon temperature, relative humidity, wind and the rain
of the 24 h before noon, carries three moisture codes with memory from day to
day (fine fuel, duff, deep drought), and combines them into one figure — the
FWI — that EFFIS maps onto six classes:

| class | FWI |
| --- | --- |
| very low | < 5.2 |
| low | 5.2 – 11.2 |
| moderate | 11.2 – 21.3 |
| high | 21.3 – 38 |
| very high | 38 – 50 |
| extreme | ≥ 50 |

It answers a different question from the phosphorus rule. That rule asks
"is buried ordnance about to meet air"; the FWI asks "how would a fire behave
today". Both belong on the panel, and they are kept apart on it.

## Why computed here

There is no public endpoint that returns the figure for a point. EFFIS
publishes the map, not the number — its WMS is not queryable and returned
blank tiles for every date tried; GeoSphere's data hub has no fire-weather
product; Open-Meteo offers none. What all of them publish is this index,
computed by this published method. Running the method on our own weather data
is therefore not a stand-in for the official figure: it is the official
method, on slightly different inputs (Open-Meteo's model at the zone, where
EFFIS uses ECMWF at 8 km). The values will be close and will occasionally
differ by a class at a boundary.

So the UI, the report and the API all say **computed by the EFFIS method**,
and `method: 'canadian_fwi'` travels with every response. Nothing downstream
may call it official.

## Where it is computed and tested

`workers/src/fire-danger/fwi.ts` — a pure module, no I/O. Its test pins every
equation to the published worked example (13 April, 17 °C, 42 %, 25 km/h,
no rain → FFMC 87.69, DMC 8.55, DC 19.01, ISI 10.85, BUI 8.49, FWI 10.10).
If a constant drifts, that is where it shows.

The hourly task (`fire-danger.task.ts`) pulls 92 days of history plus the
seven-day forecast per zone from one model run, reduces it to noon
observations, runs the chain from the conventional starting codes — 92 days
is enough for them to have washed out; the drought code's e-folding time is
about 52 days — and publishes:

- a Redis snapshot the API serves (`/api/fire-danger`, and folded into
  `/api/conditions` as `fireDanger` with today's worst zone and tomorrow's
  trend), which expires on its own;
- one row per zone and past day in `fire_danger_history`, so the seasonal
  record and the incident register can later ask what the danger was on the
  day something burned. Forecast days are not persisted.

## Caveats

- Winter: the Canadian system is conventionally stopped under snow. EFFIS
  runs it all year; so does this. A January figure is computed, and low.
- Noon: a day without a 12:00 reading is skipped, not interpolated.
- The worst zone is the area's figure. Zones in one deployment sit a few
  kilometres apart and read the same weather; a reader wants the number the
  way the national map gives it.
