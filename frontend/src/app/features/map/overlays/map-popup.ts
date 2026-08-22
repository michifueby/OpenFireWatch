/**
 * Popups, built with DOM APIs rather than innerHTML.
 *
 * Every value in a popup is operator data or a satellite reading, and this
 * application is on the open internet — `textContent` means there is no
 * injection surface to reason about, only text.
 *
 * A popup is rendered in the language active when it opens; a later language
 * switch does not retro-translate one that is already on screen.
 */

import maplibregl from 'maplibre-gl';

import { TranslationService } from '@core/i18n/translation.service';
import { AnomalyAlert } from '@core/models/alert.model';
import { IconName, createIconElement } from '@shared/ui/icons';

/** Feature properties carried by the sensor layer (MapLibre re-parses JSON). */
export interface SensorPopupProps {
  label: string;
  deviceId: string;
  reporting: boolean;
  temperatureC: number | null;
  soilMoisturePct: number | null;
  batteryPct: number | null;
}

/** The detail popup behind a critical marker. */
export function buildAlertPopup(
  alert: AnomalyAlert,
  i18n: TranslationService,
): maplibregl.Popup {
  const container = shell('alert', i18n.levelLabel(alert.level));
  const t = (key: Parameters<TranslationService['t']>[0]): string => i18n.t(key);

  appendLines(container, [
    `${t('popupZone')}: ${alert.zone ? i18n.pick(alert.zone.name) : t('popupNoZone')}`,
    `${t('popupTemperature')}: ${alert.weather.temperatureC} °C`,
    `${t('popupSoilMoisture')}: ${alert.weather.soilMoisturePct} %`,
    `${t('popupCoordinates')}: ${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`,
    `${t('popupAcquired')}: ${new Date(alert.acquiredAt).toLocaleString()}`,
  ]);

  return new maplibregl.Popup({ offset: 18, closeButton: true }).setDOMContent(
    container,
  );
}

/** What one ground sensor is reporting, and whether it is reporting at all. */
export function buildSensorPopupContent(
  props: SensorPopupProps,
  i18n: TranslationService,
): HTMLElement {
  const container = shell('sensor', props.label);

  appendLines(container, [
    props.deviceId,
    props.temperatureC != null
      ? `${i18n.t('conditionsTemp')}: ${props.temperatureC} °C`
      : null,
    props.soilMoisturePct != null
      ? `${i18n.t('conditionsSoil')}: ${props.soilMoisturePct} %`
      : null,
    props.batteryPct != null
      ? `${i18n.t('sensorBattery')}: ${props.batteryPct} %`
      : null,
    i18n.t(props.reporting ? 'sensorReporting' : 'sensorStale'),
  ]);

  return container;
}

/**
 * Popup body with its heading: an icon in the heading's own colour, then the
 * words. The icon inherits `currentColor`, so it is red in a critical alert
 * and neutral in a sensor popup without either place saying so.
 */
function shell(icon: IconName, title: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'ofw-popup';

  const heading = document.createElement('strong');
  heading.className = 'ofw-popup-heading';
  heading.appendChild(createIconElement(icon, 15));
  const label = document.createElement('span');
  label.textContent = title;
  heading.appendChild(label);

  container.appendChild(heading);
  return container;
}

/** One `<div>` per line; nulls are readings the source does not have. */
function appendLines(container: HTMLElement, lines: readonly (string | null)[]): void {
  for (const text of lines) {
    if (!text) continue;
    const row = document.createElement('div');
    row.textContent = text;
    container.appendChild(row);
  }
}
