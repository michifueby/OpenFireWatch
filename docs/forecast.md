# Ignition-window forecast

The detection pipeline can only report a fire a satellite has already seen —
hours after it started, at 375 m resolution, and not at all under a closed
canopy. That limitation is real and permanent, and the manual says so.

But the phosphorus rule is not an observation. It is a statement about
conditions: white phosphorus ignites near 30 °C once topsoil moisture falls
below about 20 % and the drying ground exposes buried ordnance to air. Used
only against measurements, the rule waits for a fire. Used against a forecast,
it says when the conditions for one arrive.

That is the difference between *"it started two hours ago"* and *"Thursday
afternoon will be critical"* — between reporting and preparing.

## What it does

Every hour, one request per active zone to Open-Meteo for the next seven days
of hourly air temperature and topsoil moisture at 1–3 cm — the same source and
the same depth already used for current conditions. The API then applies the
same thresholds the live evaluator uses, and reports every continuous run of
hours in which **both** criteria hold.

```bash
curl -s https://openfirewatch.org/api/forecast
```

```json
{
  "available": true,
  "generatedAt": "2026-08-21T12:53:59.204Z",
  "zones": [
    {
      "zoneId": 1,
      "name": { "de": "Föhrenwald (Steinfeld)", "en": "Föhrenwald (Steinfeld)" },
      "hazardType": "white_phosphorus",
      "weatherGated": true,
      "soilAlreadyDry": false,
      "hoursUntilNextWindow": 142,
      "windows": [
        {
          "from": "2026-08-27T13:00+02:00",
          "to": "2026-08-27T17:00+02:00",
          "peakTemperatureC": 31.3,
          "minSoilMoisturePct": 9.4
        }
      ]
    }
  ]
}
```

A window inside three days is also sent through the notification channels, as
a **warning** rather than an alarm — there is still time to act, which is a
different thing from a fire.

## Four decisions worth knowing

**Both criteria in the same hour.** Comparing a day's maximum temperature with
that day's minimum soil moisture would report windows that never existed: heat
at 15:00 and dryness at 04:00 are not a coincidence in time, and ignition
needs them to be.

**The thresholds are imported, never restated.** `ForecastService` reads
`PHOSPHORUS_IGNITION` from the evaluation module. A second copy would be a
second definition of danger, free to drift from the one raising alerts — and
the drift would stay invisible until a forecast said "safe" about conditions
the live rule called critical.

**Only weather-gated zones are forecast.** A wildfire zone escalates on any
credible detection, which no weather forecast can predict. Reporting "no
ignition window" for such a zone would read as reassurance the system has no
basis for, so it reports *not a weather question* instead.

**Times carry their offset.** Open-Meteo returns local Vienna times without a
zone marker, and an unqualified timestamp is parsed in the reader's own zone —
inside a UTC container that shifts every window by two hours in summer. The
worker appends the offset the API reports, so `2026-08-27T13:00+02:00` is both
unambiguous to a machine and readable as "13:00" to a crew.

## What it is not

- **Not a prediction that something will burn.** It says the conditions for
  self-ignition are expected, nothing more. Most such windows pass without
  incident — which is exactly why a patrol during one is cheap insurance.
- **Not precise beyond the forecast itself.** Seven days out, a weather model
  is a decent guess; three days out it is a good one. That is why notifications
  only go out inside a 72-hour horizon (`FORECAST_WARN_HOURS`) while the panel
  shows the full week.
- **Not validated against ignitions in the Föhrenwald.** The 30 °C and 20 %
  come from the literature on white phosphorus, not from measurements at this
  site. A forecast built on an assumption inherits the assumption.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FORECAST_POLL_INTERVAL` | `3600` | Seconds between forecast refreshes (workers) |
| `FORECAST_WARN_HOURS` | `72` | How far ahead a window is worth notifying about |

The snapshot is held in Redis under `forecast:current` with a four-hour TTL —
so a stopped worker leaves no week-old outlook looking current, and the API
answers `available: false` rather than implying that nothing is ahead.
