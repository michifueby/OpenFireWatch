-- =============================================================================
-- Registering a ground sensor
--
-- The intake refuses readings from any device id that is not registered:
-- registration is where a sensor's position and calibration are recorded, and
-- a reading with no position has no zone to apply to.
--
-- WHERE the sensor stands is the whole point of registering it. The zone a
-- sensor speaks for is derived from its coordinates with ST_Intersects, never
-- typed in — so place the point where the probe is actually buried, not at
-- the gate of the property.
--
-- CALIBRATION: capacitive soil-moisture probes are soil-dependent. Calibrate
-- against two reference readings (saturated and dry) and express the result
-- as scale + offset:  true_pct = raw * scale + offset.  The defaults are the
-- identity transform. Raw values are stored unchanged and calibrated on read,
-- so correcting a calibration later also corrects every past reading.
--
-- Re-runnable: ON CONFLICT updates in place, and re-activates a retired
-- sensor.
--
--   docker compose -f docker-compose.yml exec -T db \
--     psql -U openfirewatch -d openfirewatch < deploy/sensors/register-sensor.example.sql
-- =============================================================================

INSERT INTO ground_sensors
  (device_id, label, geom,
   temperature_offset_c, soil_moisture_scale, soil_moisture_offset_pct)
VALUES
  ( -- The LoRaWAN network server's device id, exactly as it appears there.
    'foehrenwald-bodensonde-01',
    'Föhrenwald Bodensonde 1 (Forststraße Ost)',
    ST_SetSRID(ST_MakePoint(16.2155, 47.7593), 4326), -- lon, lat (WGS84)
    0,    -- temperature offset in °C
    1,    -- soil moisture scale
    0     -- soil moisture offset in %
  )
ON CONFLICT (device_id) DO UPDATE
  SET label                    = EXCLUDED.label,
      geom                     = EXCLUDED.geom,
      temperature_offset_c     = EXCLUDED.temperature_offset_c,
      soil_moisture_scale      = EXCLUDED.soil_moisture_scale,
      soil_moisture_offset_pct = EXCLUDED.soil_moisture_offset_pct,
      is_active                = TRUE;

-- Retiring (never DELETE — the readings are the drought record of that spot):
--   UPDATE ground_sensors SET is_active = FALSE WHERE device_id = '...';
