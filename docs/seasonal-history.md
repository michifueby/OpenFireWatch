# Seasonal ignition history

The live map answers *what is happening now*. This answers *how often has this
happened before* — which is the question an authority asks before funding
anything, and the only way to check whether the thresholds describe this wood
or just the literature.

For the Föhrenwald, over the decade to 2026:

```
Mittel: 13.8 Tage/Jahr
2017:  17 Tage,  66 h   (Aug 7, Jul 6, Jun 4)
2018:   8 Tage,  33 h   (Aug 7, Jul 1)
2019:  14 Tage,  71 h   (Jul 7, Aug 4, Jun 3)
2020:   2 Tage,   7 h   (Jul 2)
2021:  14 Tage,  57 h   (Jun 7, Jul 4, Aug 3)
2022:  12 Tage,  73 h   (Jul 7, Aug 3, Jun 2)
2023:  10 Tage,  46 h   (Aug 6, Jul 4)
2024:  29 Tage, 145 h   (Aug 15, Jul 8, Sep 4)
2025:  18 Tage,  90 h   (Aug 8, Jun 5, Jul 5)
2026:  33 Tage, 218 h   (Jun 11, Aug 11, Jul 10)   ← Jahr läuft noch
```

Read it carefully before quoting it: the two highest years in the record are
the two most recent, and 2026 passed every complete year before the season
ended. That is a finding worth putting in front of somebody. It is also a
finding built on assumptions — see the limits below.

## Where the data comes from

Not from this system's own records. It could not be: a row is written only
when a satellite detects something, so a hot, bone-dry day that happened to
pass without a detection leaves no trace. The conditions history was never
there to query.

Instead a worker backfills hourly temperature and topsoil moisture per zone
from the Open-Meteo archive (ERA5 reanalysis), ten years back by default, once
per zone-year and never again. About 250 000 rows for three zones — trivial
for PostgreSQL, and the raw hours are kept rather than daily summaries,
because the rule needs both criteria in the *same hour* and a daily maximum
paired with a daily minimum cannot express that.

```bash
curl -s https://openfirewatch.org/api/history/ignition-windows
```

For spreadsheets and reports, the same record exports day by day as CSV —
semicolon-delimited with a UTF-8 BOM, so a German-locale Excel opens it
without mangling either the columns or the umlauts:

```bash
curl -sO https://openfirewatch.org/api/history/ignition-windows.csv
```

The same table also accepts measured values (`source = 'measured'`), so the
record improves as the deployment's own ground sensors accumulate.

## What it is honest about

**The soil layer is not the same one.** The archive publishes 0–7 cm; the live
rule is written for 1–3 cm. Measured over 1153 overlapping hours at the
Föhrenwald, the archive layer read on average **2.2 percentage points wetter**,
and the count of hours below the 20 % threshold differed by about **2 %**.
Close enough to count days in a season; not close enough to quote a precise
figure. Every row records its source, and the interface says so on screen.

**The thresholds are literature values.** 30 °C and 20 % come from published
work on white phosphorus, not from measurements in this wood. A decade of
history computed from an assumption inherits the assumption — which is exactly
why this endpoint is useful: line these dates up against the fires that
actually happened and the assumption becomes testable.

**The running year is excluded from the average.** Half a summer would drag
the mean down and read as a trend rather than as the calendar not being
finished. It is still shown, marked as incomplete.

**Zones that ignore weather report nothing.** A wildfire zone escalates on any
credible detection. Reporting "0 ignition days" for it would describe a decade
of safety it never had.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HISTORY_YEARS` | `10` | How many calendar years back to backfill |
| `HISTORY_BACKFILL_INTERVAL` | `86400` | Seconds between gap checks (workers) |

A closed year is fetched once; the current year is refreshed as it fills in.
A daily run therefore does almost nothing, which is the intent — the archive
is a free service.
