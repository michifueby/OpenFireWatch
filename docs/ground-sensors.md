# Ground sensors

Everything the escalation rules read from the sky is regional: one GeoSphere
TAWES station and one Open-Meteo grid point stand in for a monitored area
roughly 18 km across. The two numbers the phosphorus rule turns on — 30 °C
and 20 % topsoil moisture — describe conditions *in the soil where the
ordnance lies*, and a modelled value from kilometres away is a good guess at
them, not a measurement.

A sensor mounted in the risk area measures them. This page describes how the
intake works and how to connect one.

## How a reading changes an evaluation

Nothing about the evaluation pipeline changes shape. When a satellite
detection lands inside a zone, the evaluator asks whether a **registered,
active sensor standing inside that zone** has reported within the freshness
window (`SENSOR_MAX_AGE_MINUTES`, default 90 minutes):

- If yes, the measured temperature and soil moisture **replace the regional
  estimate** as the rule's inputs, field by field — a sensor without a soil
  probe still improves the temperature. The alert record carries the numbers
  the rule actually ran on, and names the sensor.
- If the newest reading is older than the window, the evaluation falls back
  to the regional estimate. A sensor with a dead battery must never report
  calm conditions on behalf of a wood that is drying out.
- Several sensors in one zone: the **most conservative** reading wins — the
  hottest temperature, the driest soil. One probe covers a few square metres
  of a wood that is not uniform; taking the worst of them errs in the safe
  direction.

Sensors do not raise alerts by themselves (yet). They sharpen the verdict on
satellite detections. `GET /api/sensors` shows every registered sensor, its
derived zone, its latest calibrated values, its battery, and whether it is
still reporting.

## Connecting a LoRaWAN sensor

The intended path is LoRaWAN: battery-powered nodes in the forest, a gateway
within radio range, a network server (e.g. The Things Stack) that decodes
uplinks and forwards them per webhook.

1. **Register the device** — see
   [`deploy/sensors/register-sensor.example.sql`](../deploy/sensors/register-sensor.example.sql).
   The device id must match the network server's exactly. Unregistered
   devices are refused, never auto-created: registration is where position
   and calibration live, and a reading without a position has no zone to
   apply to.

2. **Set the intake token** on the server (`.env`):

   ```bash
   SENSOR_INGEST_TOKEN=$(openssl rand -hex 24)
   ```

   This is deliberately **not** the operator key. The gateway holds this
   token and can do nothing with it but submit readings; whoever reaches the
   shed the gateway sits in must not thereby be able to retire a hazard zone
   or silence an alarm.

3. **Point the webhook** at the intake:

   - URL: `https://openfirewatch.org/api/sensors/readings`
   - Header: `X-Sensor-Token: <token>` (or `Authorization: Bearer <token>`)

   The endpoint accepts a TTN-v3-style uplink envelope directly, so on The
   Things Stack this is the built-in webhook integration with one custom
   header — no relay service to write or host.

4. **Make the payload formatter emit these names** in `decoded_payload`:

   | Field | Unit | |
   | --- | --- | --- |
   | `temperatureC` | °C | optional |
   | `soilMoisturePct` | % volumetric, **raw** | optional |
   | `relativeHumidityPct` | % | optional |
   | `batteryPct` | % | optional |

   The names are strict on purpose. A formatter could plausibly emit `temp`
   or a raw ADC count, and guessing the name would mean guessing the unit —
   an uncalibrated 0–1023 count sailing past a "below 20 %" threshold would
   read as bone dry forever. The formatter is a small function in the network
   server's own UI; making it emit these names is part of commissioning.

Anything else that can POST JSON works too — the canonical shape is:

```bash
curl -X POST https://openfirewatch.org/api/sensors/readings \
  -H "X-Sensor-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"foehrenwald-bodensonde-01",
       "observedAt":"2026-08-20T12:00:00Z",
       "temperatureC":31.5,"soilMoisturePct":14.2,"batteryPct":91}'
```

## Calibration

Capacitive soil-moisture probes drift and are soil-dependent. Calibrate in
the field against a saturated and a dry reference, express the result as
`true = raw × scale + offset`, and record both on the registration row.

Raw values are stored unchanged and calibrated **on read** — so when a
calibration turns out wrong, correcting it also corrects every past reading,
instead of freezing the mistake into the record.

## Failure is not "all quiet"

`GET /api/sensors` reports `reporting: false` the moment a sensor's newest
reading falls outside the freshness window. Check it after storms and as part
of any maintenance round. The evaluation has already stopped trusting that
sensor by then; what it cannot do is climb a tree and change the battery.

## What this does not do yet

- **Sensor-only alerts.** A reading of 45 °C with no satellite detection does
  not alarm anyone today. That is the natural next step once notification
  channels exist, and it needs its own trigger model (threshold crossing with
  hysteresis, not per-reading evaluation).
- **Per-device credentials.** All devices arrive through one gateway token.
  Fine for a handful of own sensors behind one network server; revisit before
  accepting readings from hardware other people operate.
