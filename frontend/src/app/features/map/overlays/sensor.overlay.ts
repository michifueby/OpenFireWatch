/**
 * Ground sensors as small teal dots — green-ish while reporting, grey once
 * silent.
 *
 * Installed before the detections so those paint above: a sensor is context,
 * a detection is the event. The colour is the maintenance signal; a probe
 * that has stopped answering says so on the map rather than in a log.
 */

import { Injectable, inject } from '@angular/core';
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import { TranslationService } from '@core/i18n/translation.service';
import { SensorApiService } from '@features/sensors/data-access/sensor-api.service';

import { SensorPopupProps, buildSensorPopupContent } from './map-popup';

const SOURCE = 'ground-sensors';
const LAYER = 'ground-sensors-dots';

@Injectable({ providedIn: 'root' })
export class SensorOverlay {
  private readonly sensorApi = inject(SensorApiService);
  private readonly i18n = inject(TranslationService);

  private map?: MapLibreMap;
  /** Layer-scoped handlers outlive their layer; bind them exactly once. */
  private handlersBound = false;

  install(map: MapLibreMap): void {
    this.map = map;

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: LAYER,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'case',
          ['get', 'reporting'],
          '#2dd4bf', // fresh data
          '#5b6678', // silent — the dot itself is the maintenance signal
        ],
        'circle-stroke-color': '#05070c',
        'circle-stroke-width': 1.5,
      },
    });

    if (this.handlersBound) return;
    this.handlersBound = true;

    map.on('click', LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(event.lngLat)
        .setDOMContent(
          buildSensorPopupContent(
            feature.properties as SensorPopupProps,
            this.i18n,
          ),
        )
        .addTo(map);
    });
    map.on('mouseenter', LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /** Fetch the registry and mirror it onto the layer. */
  async load(): Promise<void> {
    const source = this.map?.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    try {
      const sensors = await this.sensorApi.list();
      source.setData({
        type: 'FeatureCollection',
        features: sensors.map((sensor) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [sensor.longitude, sensor.latitude],
          },
          properties: {
            label: sensor.label,
            deviceId: sensor.deviceId,
            reporting: sensor.reporting,
            temperatureC: sensor.temperatureC,
            soilMoisturePct: sensor.soilMoisturePct,
            batteryPct: sensor.batteryPct,
          },
        })),
      });
    } catch {
      // The map stays usable without the sensor overlay.
    }
  }
}
