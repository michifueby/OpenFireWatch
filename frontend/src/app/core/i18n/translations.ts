/**
 * Typed translation dictionaries for the entire UI (English + German).
 *
 * The `TranslationDict` interface is the contract: every locale MUST provide
 * every key, so a missing translation is a compile-time error, never a blank
 * string in production. Codebase language remains English — these are the
 * user-facing strings only.
 */

export type Locale = 'en' | 'de';

export interface TranslationDict {
  // --- Document ---------------------------------------------------------------
  appTitle: string;

  // --- Alert dashboard (command-center panel, top-right) -----------------------
  dashboardAria: string;
  dashboardTitle: string;
  live: string;
  offline: string;
  gatewayConnected: string;
  gatewayReconnecting: string;
  noActiveAlerts: string;
  /** One label per critical level, so the alert names the actual hazard. */
  levelPhosphorusFire: string;
  levelWildfire: string;
  levelOrdnanceHeat: string;
  levelThermalAnomaly: string;
  levelSmouldering: string;
  levelElevated: string;
  smoulderingEvidence: string;
  historyShow: string;
  historyHide: string;
  historyTitle: string;
  historyEmpty: string;
  historyOutsideZones: string;
  conditionsTitle: string;
  conditionsUnavailable: string;
  conditionsStation: string;
  conditionsArmed: string;
  conditionsOnDetection: string;
  conditionsGap: string;
  conditionsGapTempOnly: string;
  conditionsGapSoilOnly: string;
  conditionsTemp: string;
  conditionsSoil: string;
  conditionsHumidity: string;
  conditionsWind: string;
  /** "aus SO" / "from SE" — direction the wind comes from. */
  windFrom: string;
  conditionsAsOf: string;
  // --- Ignition-window outlook --------------------------------------------------
  forecastTitle: string;
  forecastNone: string;
  forecastUnavailable: string;
  forecastNotWeatherGated: string;
  forecastWindow: string;
  forecastLeadTime: string;
  forecastPeak: string;
  // --- Seasonal record ----------------------------------------------------------
  seasonShow: string;
  seasonHide: string;
  seasonTitle: string;
  seasonEmpty: string;
  seasonAverage: string;
  seasonYear: string;
  seasonDays: string;
  seasonPeak: string;
  seasonSource: string;
  // --- Incident register ---------------------------------------------------------
  incidentsTitle: string;
  incidentAdd: string;
  incidentEmpty: string;
  incidentPlaceHint: string;
  incidentKind: string;
  kindFire: string;
  kindDrill: string;
  kindObservation: string;
  incidentWhen: string;
  incidentTitleField: string;
  incidentNotes: string;
  incidentSave: string;
  incidentDelete: string;
  incidentDeleteConfirm: string;
  incidentNeedFields: string;
  incidentInWindow: string;
  incidentNotInWindow: string;
  incidentWindowUnknown: string;
  incidentAlerted: string;
  incidentNotAlerted: string;
  incidentSummary: string;
  incidentOutcomes: string;
  // --- Alert outcome --------------------------------------------------------------
  outcomeConfirm: string;
  outcomeNothing: string;
  outcomeConfirmed: string;
  outcomeNothingFound: string;
  ack: string;
  ackAria: string;
  /** Acknowledging is a guarded write; these explain that and record it. */
  ackNeedsKey: string;
  ackedAt: string;
  /** Collapsed mobile sheet: the one-line summary and its toggle labels. */
  sheetAlert: string;
  sheetAlerts: string;
  sheetQuiet: string;
  sheetExpand: string;
  sheetCollapse: string;
  labelTemp: string;
  labelSoil: string;
  labelCoords: string;
  labelAcquired: string;

  // --- Map (basemap switcher, marker, popup) -----------------------------------
  basemapAria: string;
  basemapDark: string;
  basemapAerial: string;
  basemapTerrain: string;
  basemapAustriaOnly: string;
  criticalMarkerTitle: string;
  popupZone: string;
  popupTemperature: string;
  popupSoilMoisture: string;
  popupCoordinates: string;
  popupAcquired: string;
  popupNoZone: string;

  // --- About panel (bottom-left) ------------------------------------------------
  aboutAria: string;
  aboutInfoAria: string;
  aboutLead: string;
  aboutStep1Label: string;
  aboutStep1: string;
  aboutStep2Label: string;
  aboutStep2: string;
  aboutStep3Label: string;
  aboutStep3: string;
  aboutStep4Label: string;
  aboutStep4: string;
  developedBy: string;
  openSource: string;

  // --- Zone editor -------------------------------------------------------------
  zonesTitle: string;
  zonesOpen: string;
  zonesClose: string;
  zonesUnlockHint: string;
  zonesApiKey: string;
  zonesUnlock: string;
  zonesLock: string;
  zonesInvalidKey: string;
  zonesNew: string;
  zonesEmpty: string;
  zonesEdit: string;
  zonesRetire: string;
  zonesRetireConfirm: string;
  zonesDrawHint: string;
  zonesDrawPoints: string;
  zonesUndo: string;
  zonesFinish: string;
  zonesCancel: string;
  zonesRedraw: string;
  zonesNameEn: string;
  zonesNameDe: string;
  zonesHazard: string;
  zonesSave: string;
  zonesSaving: string;
  zonesSaved: string;
  zonesNeedGeometry: string;
  zonesNeedNames: string;
  // --- Sensor management (inside the zone editor) -------------------------------
  sensorAdd: string;
  sensorsOutside: string;
  sensorPlaceHint: string;
  sensorPosition: string;
  sensorPlace: string;
  sensorReposition: string;
  sensorSave: string;
  sensorLabel: string;
  sensorDeviceId: string;
  sensorCalibration: string;
  sensorCalibrationHint: string;
  sensorTempOffset: string;
  sensorScale: string;
  sensorSoilOffset: string;
  sensorRetireConfirm: string;
  sensorSaved: string;
  sensorNeedFields: string;
  sensorNeedPosition: string;
  sensorReporting: string;
  sensorStale: string;
  sensorNoData: string;
  sensorBattery: string;

  hazardWhitePhosphorus: string;
  hazardWildfire: string;
  hazardAmmunitionDepot: string;
  hazardGeneric: string;
}

export const TRANSLATIONS: Record<Locale, TranslationDict> = {
  en: {
    appTitle: 'OpenFireWatch — Live Thermal Anomaly Map',

    dashboardAria: 'Critical phosphorus fire alerts',
    dashboardTitle: 'CRITICAL ALERTS',
    live: '● LIVE',
    offline: '○ OFFLINE',
    gatewayConnected: 'Gateway connected',
    gatewayReconnecting: 'Reconnecting…',
    noActiveAlerts: '— no active critical alerts —',
    levelPhosphorusFire: 'PHOSPHORUS FIRE',
    levelWildfire: 'WILDFIRE',
    levelOrdnanceHeat: 'HEAT AT ORDNANCE SITE',
    levelThermalAnomaly: 'THERMAL ANOMALY',
    levelSmouldering: 'SMOULDERING NEST',
    levelElevated: 'ELEVATED',
    smoulderingEvidence: 'persisted across {passes} passes in {hours} h · peak {frp} MW',
    historyShow: 'Show history',
    historyHide: 'Hide history',
    historyTitle: 'LAST 7 DAYS',
    historyEmpty: 'Nothing evaluated in this period.',
    historyOutsideZones: 'outside all zones',
    conditionsTitle: 'CONDITIONS',
    conditionsUnavailable: 'No recent ingestion cycle — conditions unknown.',
    conditionsStation: 'station',
    conditionsArmed: 'ignition window OPEN',
    conditionsOnDetection: 'escalates on any credible detection',
    conditionsGap: '{temp} °C and {soil} % from the ignition window',
    conditionsGapTempOnly: 'soil already dry enough — {temp} °C short of ignition',
    conditionsGapSoilOnly: 'temperature reached — soil still {soil} % too moist',
    conditionsTemp: 'AIR TEMPERATURE',
    conditionsSoil: 'SOIL MOISTURE',
    conditionsHumidity: 'HUMIDITY',
    conditionsWind: 'WIND',
    windFrom: 'from {dir}',
    conditionsAsOf: 'as of',
    forecastTitle: 'IGNITION OUTLOOK · 7 DAYS',
    forecastNone: 'no ignition window in the next 7 days',
    forecastUnavailable: 'No recent forecast — outlook unknown.',
    forecastNotWeatherGated: 'escalates on detection — not a weather question',
    forecastWindow: '{day}, {from}–{to}',
    forecastLeadTime: 'in {hours} h',
    forecastPeak: 'up to {temp} °C · soil down to {soil} %',
    seasonShow: 'Show seasonal record',
    seasonHide: 'Hide seasonal record',
    seasonTitle: 'IGNITION WINDOWS BY SEASON',
    seasonEmpty: 'No history collected yet.',
    seasonAverage: '{days} days per year on average',
    seasonYear: '{year}',
    seasonDays: '{days} d',
    seasonPeak: 'longest single spell {hours} h',
    seasonSource:
      'Reanalysis weather, soil layer 0–7 cm (the live rule uses 1–3 cm; the two differ by about 2 percentage points).',
    incidentsTitle: 'INCIDENTS',
    incidentAdd: '+ Incident',
    incidentEmpty: 'No incidents recorded yet. Past events count too — each one tests the thresholds.',
    incidentPlaceHint: 'Tap the map where it happened. The zone follows from the position.',
    incidentKind: 'Type',
    kindFire: 'Fire',
    kindDrill: 'Drill',
    kindObservation: 'Observation',
    incidentWhen: 'When it happened',
    incidentTitleField: 'Title',
    incidentNotes: 'Notes (optional)',
    incidentSave: 'Save incident',
    incidentDelete: 'Delete',
    incidentDeleteConfirm: 'Delete this entry for good? It is a manual record; corrections are legitimate.',
    incidentNeedFields: 'Title, type and time are required.',
    incidentInWindow: 'ignition window was OPEN',
    incidentNotInWindow: 'window was closed',
    incidentWindowUnknown: 'window unknown for that hour',
    incidentAlerted: 'alert was raised',
    incidentNotAlerted: 'no alert raised',
    incidentSummary: '{fires} fires · {inWindow} of {applicable} in an open window · {alerted} with an alert',
    incidentOutcomes: 'Crew feedback on alerts: {confirmed} confirmed · {nothing} nothing found',
    outcomeConfirm: 'Confirmed',
    outcomeNothing: 'Nothing found',
    outcomeConfirmed: 'confirmed on site',
    outcomeNothingFound: 'checked — nothing found',
    ack: 'ACK',
    sheetAlert: 'ACTIVE ALERT',
    sheetAlerts: 'ACTIVE ALERTS',
    sheetQuiet: 'All quiet — no zone near its threshold',
    sheetExpand: 'Show situation details',
    sheetCollapse: 'Hide situation details',
    ackAria: 'Acknowledge alert',
    ackNeedsKey:
      'Acknowledging clears the alarm for everyone, so it needs the operator key. Unlock it in the Hazard zones panel.',
    ackedAt: 'Acknowledged',
    labelTemp: 'TEMPERATURE',
    labelSoil: 'SOIL MOISTURE',
    labelCoords: 'LAT / LON',
    labelAcquired: 'ACQUIRED',

    basemapAria: 'Base map',
    basemapDark: 'Dark',
    basemapAerial: 'Aerial',
    basemapTerrain: 'Terrain',
    basemapAustriaOnly: 'Austria only',
    criticalMarkerTitle: 'CRITICAL ALERT',
    popupZone: 'Zone',
    popupTemperature: 'Temperature',
    popupSoilMoisture: 'Soil moisture',
    popupCoordinates: 'Coordinates',
    popupAcquired: 'Acquired',
    popupNoZone: '—',

    aboutAria: 'About OpenFireWatch',
    aboutInfoAria: 'Show information about OpenFireWatch',
    aboutLead:
      'An open-source early warning system that detects dangerous heat ' +
      'sources — such as wildfires or self-igniting phosphorus ammunition ' +
      'from World War II (e.g. in the Föhrenwald near Wiener Neustadt) — ' +
      'in near real-time and reports them on this map.',
    aboutStep1Label: 'Satellite data:',
    aboutStep1:
      'NASA satellites (FIRMS) report where unusual heat is currently being measured.',
    aboutStep2Label: 'Weather data:',
    aboutStep2:
      'Current temperature and humidity from GeoSphere Austria are added, along with soil moisture.',
    aboutStep3Label: 'Risk assessment:',
    aboutStep3:
      'If a hotspot lies inside a risk zone and it is hotter than 30 °C and ' +
      'the soil is very dry (below 20 % soil moisture — the ground cracks ' +
      'open and buried ammunition comes into contact with oxygen), the ' +
      'highest alert is triggered.',
    aboutStep4Label: 'Instant alert:',
    aboutStep4:
      'Critical events appear immediately as a pulsating red dot on the map — ' +
      'with all readings first responders need.',
    developedBy: 'Developed by',
    openSource: 'Open Source (MIT)',

    zonesTitle: 'HAZARD ZONES',
    zonesOpen: 'Manage hazard zones',
    zonesClose: 'Close',
    zonesUnlockHint:
      'Managing zones requires the operator key (OPERATOR_API_KEY). It is kept for this browser tab only.',
    zonesApiKey: 'Operator key',
    zonesUnlock: 'Unlock',
    zonesLock: 'Lock',
    zonesInvalidKey: 'Key rejected — check OPERATOR_API_KEY.',
    zonesNew: '+ New zone',
    zonesEmpty: 'No active zones.',
    zonesEdit: 'Edit',
    zonesRetire: 'Retire',
    zonesRetireConfirm: 'Retire this zone? It stops raising alerts; its history is kept.',
    zonesDrawHint: 'Place corners on the map, then Finish to close the outline.',
    zonesDrawPoints: 'corners',
    zonesUndo: 'Undo point',
    zonesFinish: 'Finish',
    zonesCancel: 'Cancel',
    zonesRedraw: 'Redraw outline',
    zonesNameEn: 'Name (English)',
    zonesNameDe: 'Name (German)',
    zonesHazard: 'Hazard type',
    zonesSave: 'Save zone',
    zonesSaving: 'Saving…',
    zonesSaved: 'Zone saved.',
    zonesNeedGeometry: 'Draw an outline with at least 3 corners first.',
    zonesNeedNames: 'Both names are required.',
    sensorAdd: '+ Sensor',
    sensorsOutside: 'Sensors outside every zone',
    sensorPlaceHint:
      'Tap the map where the sensor is mounted. Its zone follows from the position automatically.',
    sensorPosition: 'Position',
    sensorPlace: 'Place on the map',
    sensorReposition: 'Reposition',
    sensorSave: 'Save sensor',
    sensorLabel: 'Name',
    sensorDeviceId: 'Device ID (LoRaWAN)',
    sensorCalibration: 'Calibration (optional)',
    sensorCalibrationHint:
      'true value = raw × factor + offset. Leave as is unless the probe was calibrated in the field.',
    sensorTempOffset: 'Temperature offset (°C)',
    sensorScale: 'Soil moisture factor',
    sensorSoilOffset: 'Soil moisture offset (%)',
    sensorRetireConfirm:
      'Retire this sensor? It stops feeding evaluations; its readings are kept.',
    sensorSaved: 'Sensor saved.',
    sensorNeedFields: 'Name and device ID are required.',
    sensorNeedPosition: 'Place the sensor on the map first.',
    sensorReporting: 'reporting',
    sensorStale: 'not reporting',
    sensorNoData: 'no data yet',
    sensorBattery: 'Battery',

    hazardWhitePhosphorus: 'White phosphorus',
    hazardWildfire: 'Wildfire',
    hazardAmmunitionDepot: 'Ammunition depot',
    hazardGeneric: 'General',
  },

  de: {
    appTitle: 'OpenFireWatch — Live-Karte thermischer Anomalien',

    dashboardAria: 'Kritische Phosphorbrand-Alarme',
    dashboardTitle: 'KRITISCHE ALARME',
    live: '● LIVE',
    offline: '○ OFFLINE',
    gatewayConnected: 'Mit Gateway verbunden',
    gatewayReconnecting: 'Verbindung wird wiederhergestellt…',
    noActiveAlerts: '— keine aktiven kritischen Alarme —',
    levelPhosphorusFire: 'PHOSPHORBRAND',
    levelWildfire: 'WALDBRAND',
    levelOrdnanceHeat: 'HITZE AN MUNITIONSSTANDORT',
    levelThermalAnomaly: 'THERMISCHE ANOMALIE',
    levelSmouldering: 'GLUTNEST',
    levelElevated: 'ERHÖHT',
    smoulderingEvidence: 'bei {passes} Überflügen in {hours} h · Spitze {frp} MW',
    historyShow: 'Verlauf anzeigen',
    historyHide: 'Verlauf ausblenden',
    historyTitle: 'LETZTE 7 TAGE',
    historyEmpty: 'In diesem Zeitraum wurde nichts bewertet.',
    historyOutsideZones: 'außerhalb aller Zonen',
    conditionsTitle: 'BEDINGUNGEN',
    conditionsUnavailable: 'Kein aktueller Abrufzyklus — Bedingungen unbekannt.',
    conditionsStation: 'Station',
    conditionsArmed: 'Zündfenster OFFEN',
    conditionsOnDetection: 'eskaliert bei jeder glaubwürdigen Detektion',
    conditionsGap: '{temp} °C und {soil} % vom Zündfenster entfernt',
    conditionsGapTempOnly: 'Boden bereits trocken genug — nur noch {temp} °C bis zur Zündung',
    conditionsGapSoilOnly: 'Temperatur erreicht — Boden noch {soil} % zu feucht',
    conditionsTemp: 'LUFTTEMPERATUR',
    conditionsSoil: 'BODENFEUCHTE',
    conditionsHumidity: 'LUFTFEUCHTE',
    conditionsWind: 'WIND',
    windFrom: 'aus {dir}',
    conditionsAsOf: 'Stand',
    forecastTitle: 'ZÜNDFENSTER-VORHERSAGE · 7 TAGE',
    forecastNone: 'kein Zündfenster in den nächsten 7 Tagen',
    forecastUnavailable: 'Keine aktuelle Vorhersage — Ausblick unbekannt.',
    forecastNotWeatherGated: 'eskaliert bei Detektion — keine Wetterfrage',
    forecastWindow: '{day}, {from}–{to} Uhr',
    forecastLeadTime: 'in {hours} h',
    forecastPeak: 'bis {temp} °C · Boden bis {soil} %',
    seasonShow: 'Saisonauswertung anzeigen',
    seasonHide: 'Saisonauswertung ausblenden',
    seasonTitle: 'ZÜNDFENSTER NACH SAISON',
    seasonEmpty: 'Noch keine Historie erfasst.',
    seasonAverage: 'im Mittel {days} Tage pro Jahr',
    seasonYear: '{year}',
    seasonDays: '{days} T',
    seasonPeak: 'längste Einzelphase {hours} h',
    seasonSource:
      'Reanalyse-Wetterdaten, Bodenschicht 0–7 cm (die Regel arbeitet mit 1–3 cm; beide unterscheiden sich um rund 2 Prozentpunkte).',
    incidentsTitle: 'EREIGNISSE',
    incidentAdd: '+ Ereignis',
    incidentEmpty: 'Noch keine Ereignisse erfasst. Auch vergangene zählen — jedes prüft die Schwellenwerte.',
    incidentPlaceHint: 'Auf die Karte tippen, wo es passiert ist. Die Zone ergibt sich aus der Position.',
    incidentKind: 'Art',
    kindFire: 'Brand',
    kindDrill: 'Übung',
    kindObservation: 'Beobachtung',
    incidentWhen: 'Zeitpunkt',
    incidentTitleField: 'Bezeichnung',
    incidentNotes: 'Anmerkungen (optional)',
    incidentSave: 'Ereignis speichern',
    incidentDelete: 'Löschen',
    incidentDeleteConfirm: 'Eintrag endgültig löschen? Er ist eine manuelle Erfassung; Korrekturen sind legitim.',
    incidentNeedFields: 'Bezeichnung, Art und Zeitpunkt sind erforderlich.',
    incidentInWindow: 'Zündfenster war OFFEN',
    incidentNotInWindow: 'Fenster war geschlossen',
    incidentWindowUnknown: 'Fenster für diese Stunde unbekannt',
    incidentAlerted: 'Alarm wurde ausgelöst',
    incidentNotAlerted: 'kein Alarm ausgelöst',
    incidentSummary: '{fires} Brände · {inWindow} von {applicable} im offenen Fenster · {alerted} mit Alarm',
    incidentOutcomes: 'Einsatz-Rückmeldungen: {confirmed} bestätigt · {nothing} ohne Befund',
    outcomeConfirm: 'Bestätigt',
    outcomeNothing: 'Ohne Befund',
    outcomeConfirmed: 'vor Ort bestätigt',
    outcomeNothingFound: 'geprüft — nichts gefunden',
    ack: 'QUITT',
    sheetAlert: 'AKTIVER ALARM',
    sheetAlerts: 'AKTIVE ALARME',
    sheetQuiet: 'Lage ruhig — keine Zone nahe ihrer Schwelle',
    sheetExpand: 'Lagedetails einblenden',
    sheetCollapse: 'Lagedetails ausblenden',
    ackAria: 'Alarm quittieren',
    ackNeedsKey:
      'Quittieren löscht den Alarm für alle und erfordert deshalb den Betreiber-Schlüssel. Im Panel „Gefahrenzonen“ entsperren.',
    ackedAt: 'Quittiert',
    labelTemp: 'TEMPERATUR',
    labelSoil: 'BODENFEUCHTE',
    labelCoords: 'LAT / LON',
    labelAcquired: 'ERFASST',

    basemapAria: 'Kartenart',
    basemapDark: 'Dunkel',
    basemapAerial: 'Luftbild',
    basemapTerrain: 'Gelände',
    basemapAustriaOnly: 'nur Österreich',
    criticalMarkerTitle: 'KRITISCHER ALARM',
    popupZone: 'Zone',
    popupTemperature: 'Temperatur',
    popupSoilMoisture: 'Bodenfeuchte',
    popupCoordinates: 'Koordinaten',
    popupAcquired: 'Erfasst',
    popupNoZone: '—',

    aboutAria: 'Über OpenFireWatch',
    aboutInfoAria: 'Informationen zu OpenFireWatch anzeigen',
    aboutLead:
      'Ein Open-Source-Frühwarnsystem, das gefährliche Hitzequellen — etwa ' +
      'Waldbrände oder sich selbst entzündende Phosphormunition aus dem ' +
      'Zweiten Weltkrieg (z. B. im Föhrenwald bei Wiener Neustadt) — nahezu ' +
      'in Echtzeit erkennt und auf dieser Karte meldet.',
    aboutStep1Label: 'Satellitendaten:',
    aboutStep1:
      'NASA-Satelliten (FIRMS) melden, wo gerade ungewöhnliche Hitze gemessen wird.',
    aboutStep2Label: 'Wetterdaten:',
    aboutStep2:
      'Dazu kommen aktuelle Temperatur und Luftfeuchte von GeoSphere Austria sowie die Bodenfeuchte.',
    aboutStep3Label: 'Gefahrenbewertung:',
    aboutStep3:
      'Liegt ein Hitzepunkt in einer Risikozone und ist es über 30 °C heiß ' +
      'und der Boden sehr trocken (unter 20 % Bodenfeuchte — dann reißt der ' +
      'Boden auf und vergrabene Munition kommt mit Sauerstoff in Kontakt), ' +
      'wird der höchste Alarm ausgelöst.',
    aboutStep4Label: 'Sofortiger Alarm:',
    aboutStep4:
      'Kritische Ereignisse erscheinen ohne Verzögerung als pulsierender ' +
      'roter Punkt auf der Karte — mit allen Messwerten für die Einsatzkräfte.',
    developedBy: 'Entwickelt von',
    openSource: 'Open Source (MIT)',

    zonesTitle: 'GEFAHRENZONEN',
    zonesOpen: 'Gefahrenzonen verwalten',
    zonesClose: 'Schließen',
    zonesUnlockHint:
      'Zum Verwalten wird der Betreiber-Schlüssel benötigt (OPERATOR_API_KEY). Er gilt nur für diesen Browser-Tab.',
    zonesApiKey: 'Betreiber-Schlüssel',
    zonesUnlock: 'Entsperren',
    zonesLock: 'Sperren',
    zonesInvalidKey: 'Schlüssel abgelehnt — OPERATOR_API_KEY prüfen.',
    zonesNew: '+ Neue Zone',
    zonesEmpty: 'Keine aktiven Zonen.',
    zonesEdit: 'Bearbeiten',
    zonesRetire: 'Stilllegen',
    zonesRetireConfirm:
      'Zone stilllegen? Sie löst keine Alarme mehr aus, die Historie bleibt erhalten.',
    zonesDrawHint: 'Eckpunkte auf der Karte setzen, dann mit Fertig die Fläche schließen.',
    zonesDrawPoints: 'Eckpunkte',
    zonesUndo: 'Punkt zurück',
    zonesFinish: 'Fertig',
    zonesCancel: 'Abbrechen',
    zonesRedraw: 'Umriss neu zeichnen',
    zonesNameEn: 'Name (Englisch)',
    zonesNameDe: 'Name (Deutsch)',
    zonesHazard: 'Gefahrenart',
    zonesSave: 'Zone speichern',
    zonesSaving: 'Wird gespeichert…',
    zonesSaved: 'Zone gespeichert.',
    zonesNeedGeometry: 'Zuerst einen Umriss mit mindestens 3 Eckpunkten zeichnen.',
    zonesNeedNames: 'Beide Namen sind erforderlich.',
    sensorAdd: '+ Sensor',
    sensorsOutside: 'Sensoren außerhalb aller Zonen',
    sensorPlaceHint:
      'Auf die Karte tippen, wo der Sensor montiert ist. Die Zone ergibt sich automatisch aus der Position.',
    sensorPosition: 'Position',
    sensorPlace: 'Auf der Karte platzieren',
    sensorReposition: 'Neu platzieren',
    sensorSave: 'Sensor speichern',
    sensorLabel: 'Bezeichnung',
    sensorDeviceId: 'Geräte-ID (LoRaWAN)',
    sensorCalibration: 'Kalibrierung (optional)',
    sensorCalibrationHint:
      'Wahrer Wert = Rohwert × Faktor + Offset. Unverändert lassen, wenn die Sonde nicht im Feld kalibriert wurde.',
    sensorTempOffset: 'Temperatur-Offset (°C)',
    sensorScale: 'Bodenfeuchte-Faktor',
    sensorSoilOffset: 'Bodenfeuchte-Offset (%)',
    sensorRetireConfirm:
      'Sensor stilllegen? Er fließt nicht mehr in Bewertungen ein; die Messwerte bleiben erhalten.',
    sensorSaved: 'Sensor gespeichert.',
    sensorNeedFields: 'Bezeichnung und Geräte-ID sind erforderlich.',
    sensorNeedPosition: 'Zuerst den Sensor auf der Karte platzieren.',
    sensorReporting: 'meldet',
    sensorStale: 'meldet nicht',
    sensorNoData: 'noch keine Daten',
    sensorBattery: 'Akku',

    hazardWhitePhosphorus: 'Weißer Phosphor',
    hazardWildfire: 'Waldbrand',
    hazardAmmunitionDepot: 'Munitionsdepot',
    hazardGeneric: 'Allgemein',
  },
};
