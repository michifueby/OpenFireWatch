# Satellite archive backfill

Replaying years of NASA FIRMS detections through the live rule — so the
incident register can say, for a fire that happened before this system
existed, whether it **would have alarmed**.

---

## Why

The incident register holds every recorded fire against two questions:
was the ignition window open, and did the system alarm? The first is
answered from a decade of reanalysis weather. The second could only be
answered from the day the system was switched on — for every earlier fire it
said "no alert", which was true and useless.

FIRMS keeps the detections: VIIRS on Suomi NPP from 20 January 2012, on
NOAA-20 from April 2018. Replaying them through the same rule, against the
weather of their own day, turns "we would have alarmed" into a yes or a no
that can be checked.

## What a run does

An operator starts a run for a date range — from the panel under the
incident register, or `POST /api/backfill/satellite {from, to}` with the
operator key. The API records the run and hands it to the workers over a
queue of its own, so a replay of five summers never delays a live ingestion
cycle. The workers then:

1. **Ask FIRMS what it holds.** Every product comes as a near-real-time
   stream and a standard-processing archive, and the boundary between them
   moves (on 22 Aug 2026: SNPP archive to 27 April, NRT from 28 April). The
   `data_availability` listing says where, and the plan chooses per day.
   Asking the wrong stream returns an empty CSV that looks exactly like "no
   fires that week" — the failure this whole system is built to avoid.
2. **Cut the range into requests** of at most five days (FIRMS' limit), one
   per product, in chronological order.
3. **Make sure the weather is there.** A detection from 2014 is evaluated
   against the conditions of 2014: the reanalysis archive is fetched for any
   zone short of it, into the same `zone_weather_history` the seasonal
   analysis uses.
4. **Fetch, pair, publish.** Every detection is paired with the weather at
   its hour — the zone it fell in, or the nearest zone outside all of them,
   as the live cycle pairs a detection with one area-wide reading — and
   published as a detection report marked `ingestion: 'backfill'`, at low
   priority so live reports still jump the queue.

The evaluation service does the rest: same rule, same tables, same
de-duplication (a day the live cycle already saw enqueues nothing new).

## What the mark changes

`ingestion: 'backfill'` travels with the report and lands as
`validated_events.backfilled = true`. It changes exactly four things:

| | live | backfill |
| --- | --- | --- |
| evaluated by the rule, stored, de-duplicated | yes | yes |
| broadcast to browsers, paged to the crew, pulsing marker | yes | **never** |
| escalation reminder when unacknowledged | yes | **never** |
| today's ground sensor substituted for the regional estimate | yes | **never** — a probe reading from this afternoon says nothing about a July in 2019 |
| counted by the incident register | yes | **yes — the point** |

Every query that describes the live picture — the alert list, what is
outstanding, the history panel, the map — excludes backfilled events. The
register includes them, and judges by **acquisition time**, never evaluation
time: a verdict reached today about a pass in 2019 counts for the 2019 fire.

The register now answers two questions apart: **seen by the satellite** (any
detection within 2 km, 48 h before to 12 h after) and **alert raised**. A
fire seen but not alarmed is the thresholds' report card; one never seen is
a limit of the instrument, and no threshold would have changed it.

## Coverage gaps are not quiet days

A run reports the days inside its range that no product covered —
`coverageGaps` in the API, a line on the panel. Requesting 2012 from New
Year yields "2012-01-01 to 2012-01-19 not covered". Absence of rows there is
not absence of fires.

## Limits

- **One run at a time.** FIRMS rations 5000 requests per 10 minutes per
  key, shared with the live cycle. Runs are paced (`FIRMS_BACKFILL_PACE_MS`,
  500 ms) and wait out the quota message rather than failing.
- **At most five years per run.** Split a longer range.
- **Smouldering detection depends on order.** The persistence signature
  looks at passes in the 72 h before; requests are chronological, but the
  evaluation queue runs five jobs at once, so a second pass can occasionally
  be judged before its first. It would be judged ELEVATED instead of
  CRITICAL_SMOULDERING — never the other way.
- **VIIRS only by default** (`FIRMS_BACKFILL_SOURCES`). MODIS reaches back to
  2000 at 1 km pixels; add `MODIS` to the list if that era matters.

## Endpoints

```
POST /api/backfill/satellite   { "from": "2019-01-01", "to": "2019-12-31" }   → 202, the run
GET  /api/backfill/satellite                                                 → last 50 runs
```

400 for an inverted, future, pre-archive or over-long range; 409 while a run
is queued or running; 401 without the operator key.
