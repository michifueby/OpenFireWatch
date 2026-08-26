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
  levelSensorHeat: string;
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
  conditionsDetectionWindowOpen: string;
  conditionsDetectionWindowGap: string;
  gapTempOnlyShort: string;
  gapSoilOnlyShort: string;
  gapBothShort: string;
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
  fireDangerTitle: string;
  backfillTitle: string;
  backfillHint: string;
  backfillFrom: string;
  backfillTo: string;
  backfillStart: string;
  backfillInProgress: string;
  backfillQueued: string;
  backfillRunning: string;
  backfillDone: string;
  backfillFailed: string;
  backfillWindows: string;
  backfillDetections: string;
  backfillGaps: string;
  fireDangerTomorrow: string;
  fireDangerMethod: string;
  dangerVeryLow: string;
  dangerLow: string;
  dangerModerate: string;
  dangerHigh: string;
  dangerVeryHigh: string;
  dangerExtreme: string;
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
  incidentSeen: string;
  incidentNotSeen: string;
  incidentAlerted: string;
  incidentNotAlerted: string;
  incidentSummary: string;
  incidentOutcomes: string;
  // --- Alert outcome --------------------------------------------------------------
  outcomeConfirm: string;
  outcomeNothing: string;
  outcomeConfirmed: string;
  outcomeNothingFound: string;
  /** Prefix on alerts a ground probe raised itself. */
  sensorMeasuredBy: string;
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
  mapShowDay: string;
  mapViewingDay: string;
  mapBackToLive: string;
  mapDetections: string;
  statusShow: string;
  statusHide: string;
  statusTitle: string;
  statusLoading: string;
  statusOverallOk: string;
  statusOverallDegraded: string;
  statusOverallBlind: string;
  statusSatellites: string;
  statusNoSources: string;
  statusAnswered: string;
  statusNoAnswer: string;
  statusCycle: string;
  statusLookback: string;
  statusFeeds: string;
  statusWeather: string;
  statusForecast: string;
  statusFireDanger: string;
  statusZones: string;
  statusFresh: string;
  statusStale: string;
  statusMissing: string;
  statusNever: string;
  statusJustNow: string;
  statusMinutesAgo: string;
  statusHoursAgo: string;
  statusRecord: string;
  statusDetections24h: string;
  statusDetections7d: string;
  statusDetectionsTotal: string;
  statusSensors: string;
  statusDeadLetters: string;
  statusRecordReaches: string;
  statusReplayedTo: string;
  statusAsOf: string;
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
  reportLink: string;
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
  zonesLoadFailed: string;
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
  hazardWhitePhosphorusForest: string;
  hazardWildfire: string;
  hazardAmmunitionDepot: string;
  hazardGeneric: string;
}

export const TRANSLATIONS: Record<Locale, TranslationDict> = {
  en: {
    appTitle: 'OpenFireWatch — Live Map of Dangerous Heat Sources',

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
    levelThermalAnomaly: 'UNUSUAL HEAT',
    levelSmouldering: 'SMOULDERING NEST',
    levelSensorHeat: 'GROUND SENSOR HEAT',
    levelElevated: 'ELEVATED',
    smoulderingEvidence: 'persisted across {passes} passes in {hours} h · peak {frp} MW',
    historyShow: 'Show history',
    historyHide: 'Hide history',
    historyTitle: 'LAST 7 DAYS',
    historyEmpty: 'Nothing evaluated in this period.',
    historyOutsideZones: 'outside all zones',
    conditionsTitle: 'CONDITIONS',
    conditionsUnavailable: 'No recent readings — conditions unknown.',
    conditionsStation: 'station',
    conditionsArmed: 'ignition window OPEN',
    conditionsOnDetection: 'alarms on any detected heat source — regardless of weather',
    conditionsDetectionWindowOpen:
      'alarms on any detected heat source — and the phosphorus window is OPEN',
    conditionsDetectionWindowGap:
      'alarms on any detected heat source · phosphorus window {gap}',
    gapTempOnlyShort: '{temp} °C away',
    gapSoilOnlyShort: 'soil {soil} % away',
    gapBothShort: '{temp} °C and {soil} % away',
    conditionsGap: '{temp} °C and {soil} % from the ignition window',
    conditionsGapTempOnly: 'soil already dry enough — {temp} °C short of ignition',
    conditionsGapSoilOnly: 'temperature reached — soil still {soil} % too moist',
    conditionsTemp: 'AIR TEMPERATURE',
    conditionsSoil: 'SOIL MOISTURE',
    conditionsHumidity: 'HUMIDITY',
    conditionsWind: 'WIND',
    windFrom: 'from {dir}',
    conditionsAsOf: 'as of',
    fireDangerTitle: 'FIRE DANGER (FWI)',
    backfillTitle: 'Satellite archive',
    backfillHint:
      'Replay past satellite detections through the same rule. The register above can ' +
      'then say, for a fire from before this system existed, whether it would have ' +
      'alarmed. Replayed data never raises an alert — it is history.',
    backfillFrom: 'from',
    backfillTo: 'to',
    backfillStart: 'Replay archive',
    backfillInProgress: 'Replay in progress…',
    backfillQueued: 'queued',
    backfillRunning: 'running',
    backfillDone: 'done',
    backfillFailed: 'failed',
    backfillWindows: 'windows',
    backfillDetections: 'detections',
    backfillGaps: 'not covered by any product',
    fireDangerTomorrow: 'tomorrow',
    fireDangerMethod:
      'Canadian Fire Weather Index — the method behind the EFFIS and national ' +
      'fire-danger maps — computed from the weather at each zone. Not an official figure.',
    dangerVeryLow: 'very low',
    dangerLow: 'low',
    dangerModerate: 'moderate',
    dangerHigh: 'high',
    dangerVeryHigh: 'very high',
    dangerExtreme: 'extreme',
    forecastTitle: 'IGNITION OUTLOOK · 7 DAYS',
    forecastNone: 'no ignition window in the next 7 days',
    forecastUnavailable: 'No current forecast available.',
    forecastNotWeatherGated: 'weather plays no role here — alarms on detected heat',
    forecastWindow: '{day}, {from}–{to}',
    forecastLeadTime: 'in {hours} h',
    forecastPeak: 'up to {temp} °C · soil down to {soil} %',
    seasonShow: 'Show seasonal record',
    seasonHide: 'Hide seasonal record',
    seasonTitle: 'IGNITION WINDOWS BY SEASON',
    seasonEmpty: 'No history collected yet.',
    seasonAverage: '{days} days per year on average',
    seasonYear: '{year}',
    seasonDays: '{days} days',
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
    incidentNotInWindow: 'ignition window was closed',
    incidentWindowUnknown: 'ignition window unknown for that hour',
    incidentSeen: 'seen by satellite',
    incidentNotSeen: 'not seen by satellite',
    incidentAlerted: 'alert was raised',
    incidentNotAlerted: 'no alert raised',
    incidentSummary: '{fires} fires · {inWindow} of {applicable} in an open window · {seen} seen by satellite · {alerted} with an alert',
    incidentOutcomes: 'Crew feedback on alerts: {confirmed} confirmed · {nothing} nothing found',
    outcomeConfirm: 'Confirmed',
    outcomeNothing: 'Nothing found',
    outcomeConfirmed: 'confirmed on site',
    outcomeNothingFound: 'checked — nothing found',
    sensorMeasuredBy: 'Ground sensor',
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
    mapShowDay: 'Show a past day',
    mapViewingDay: 'Viewing',
    mapBackToLive: 'Back to live',
    mapDetections: 'detections',
    statusShow: 'Show system status',
    statusHide: 'Hide system status',
    statusTitle: 'SYSTEM STATUS',
    statusLoading: 'Asking…',
    statusOverallOk: 'Every feed delivered on time.',
    statusOverallDegraded: 'Limited — not every feed is delivering as it should.',
    statusOverallBlind:
      'No data is arriving — the map is not showing the current situation.',
    statusSatellites: 'Satellites polled most recently',
    statusNoSources: 'No poll reported yet.',
    statusAnswered: 'answered',
    statusNoAnswer: 'no answer',
    statusCycle: 'Last complete poll',
    statusLookback: 'covering {days} days',
    statusFeeds: 'Other feeds',
    statusWeather: 'Weather',
    statusForecast: 'Ignition forecast',
    statusFireDanger: 'Fire danger (FWI)',
    statusZones: 'zones',
    statusFresh: 'fresh',
    statusStale: 'stale',
    statusMissing: 'no data',
    statusNever: 'never',
    statusJustNow: 'just now',
    statusMinutesAgo: '{minutes} min ago',
    statusHoursAgo: '{hours} h ago',
    statusRecord: 'Stored data',
    statusDetections24h: 'detections 24 h',
    statusDetections7d: '7 days',
    statusDetectionsTotal: 'total',
    statusSensors: 'sensors active',
    statusDeadLetters: 'failed jobs',
    statusRecordReaches: 'Data reaches back to',
    statusReplayedTo: 'archive replayed to',
    statusAsOf: 'as of',
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
    reportLink: 'Situation report (PDF)',
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
    zonesLoadFailed: 'Could not load the zones.',
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
    hazardWhitePhosphorusForest: 'Forest with phosphorus legacy',
    hazardWildfire: 'Wildfire',
    hazardAmmunitionDepot: 'Ammunition depot',
    hazardGeneric: 'General',
  },

  de: {
    appTitle: 'OpenFireWatch — Live-Karte gefährlicher Hitzequellen',

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
    levelThermalAnomaly: 'UNGEWÖHNLICHE HITZE',
    levelSmouldering: 'GLUTNEST',
    levelSensorHeat: 'HITZE AN BODENSONDE',
    levelElevated: 'ERHÖHT',
    smoulderingEvidence: 'bei {passes} Überflügen in {hours} h · Spitze {frp} MW',
    historyShow: 'Verlauf anzeigen',
    historyHide: 'Verlauf ausblenden',
    historyTitle: 'LETZTE 7 TAGE',
    historyEmpty: 'In diesem Zeitraum wurde nichts bewertet.',
    historyOutsideZones: 'außerhalb aller Zonen',
    conditionsTitle: 'BEDINGUNGEN',
    conditionsUnavailable: 'Keine aktuellen Messwerte — Bedingungen unbekannt.',
    conditionsStation: 'Station',
    conditionsArmed: 'Zündfenster OFFEN',
    conditionsOnDetection: 'Alarm bei jeder erkannten Hitzequelle — unabhängig vom Wetter',
    conditionsDetectionWindowOpen:
      'Alarm bei jeder erkannten Hitzequelle — Zündfenster ist OFFEN',
    conditionsDetectionWindowGap:
      'Alarm bei jeder erkannten Hitzequelle · Zündfenster {gap}',
    gapTempOnlyShort: 'noch {temp} °C',
    gapSoilOnlyShort: 'Boden noch {soil} %',
    gapBothShort: 'noch {temp} °C und {soil} %',
    conditionsGap: '{temp} °C und {soil} % vom Zündfenster entfernt',
    conditionsGapTempOnly: 'Boden bereits trocken genug — nur noch {temp} °C bis zur Zündung',
    conditionsGapSoilOnly: 'Temperatur erreicht — Boden noch {soil} % zu feucht',
    conditionsTemp: 'LUFTTEMPERATUR',
    conditionsSoil: 'BODENFEUCHTE',
    conditionsHumidity: 'LUFTFEUCHTE',
    conditionsWind: 'WIND',
    windFrom: 'aus {dir}',
    conditionsAsOf: 'Stand',
    fireDangerTitle: 'WALDBRANDGEFAHR (FWI)',
    backfillTitle: 'Satellitenarchiv',
    backfillHint:
      'Vergangene Satellitendetektionen durch dieselbe Regel laufen lassen. Damit kann ' +
      'das Register oben auch für einen früheren Brand sagen, ob das System alarmiert ' +
      'hätte. Nachgeladene Daten lösen nie einen Alarm aus — sie sind Vergangenheit.',
    backfillFrom: 'von',
    backfillTo: 'bis',
    backfillStart: 'Archiv nachladen',
    backfillInProgress: 'Nachladen läuft…',
    backfillQueued: 'wartet',
    backfillRunning: 'läuft',
    backfillDone: 'fertig',
    backfillFailed: 'fehlgeschlagen',
    backfillWindows: 'Fenster',
    backfillDetections: 'Detektionen',
    backfillGaps: 'von keinem Produkt abgedeckt',
    fireDangerTomorrow: 'morgen',
    fireDangerMethod:
      'Canadian Fire Weather Index — die Methode hinter den Waldbrandkarten von ' +
      'EFFIS und der Länder — berechnet aus dem Wetter an der Zone. Kein amtlicher Wert.',
    dangerVeryLow: 'sehr gering',
    dangerLow: 'gering',
    dangerModerate: 'mäßig',
    dangerHigh: 'hoch',
    dangerVeryHigh: 'sehr hoch',
    dangerExtreme: 'extrem',
    forecastTitle: 'ZÜNDFENSTER-VORHERSAGE · 7 TAGE',
    forecastNone: 'kein Zündfenster in den nächsten 7 Tagen',
    forecastUnavailable: 'Keine aktuelle Vorhersage verfügbar.',
    forecastNotWeatherGated: 'Wetter spielt hier keine Rolle — Alarm bei erkannter Hitze',
    forecastWindow: '{day}, {from}–{to} Uhr',
    forecastLeadTime: 'in {hours} h',
    forecastPeak: 'bis {temp} °C · Boden bis {soil} %',
    seasonShow: 'Saisonauswertung anzeigen',
    seasonHide: 'Saisonauswertung ausblenden',
    seasonTitle: 'ZÜNDFENSTER NACH SAISON',
    seasonEmpty: 'Noch keine Historie erfasst.',
    seasonAverage: 'im Mittel {days} Tage pro Jahr',
    seasonYear: '{year}',
    seasonDays: '{days} Tage',
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
    incidentNotInWindow: 'Zündfenster war geschlossen',
    incidentWindowUnknown: 'Zündfenster für diese Stunde unbekannt',
    incidentSeen: 'vom Satelliten gesehen',
    incidentNotSeen: 'nicht vom Satelliten gesehen',
    incidentAlerted: 'Alarm wurde ausgelöst',
    incidentNotAlerted: 'kein Alarm ausgelöst',
    incidentSummary: '{fires} Brände · {inWindow} von {applicable} im offenen Fenster · {seen} vom Satelliten gesehen · {alerted} mit Alarm',
    incidentOutcomes: 'Einsatz-Rückmeldungen: {confirmed} bestätigt · {nothing} ohne Befund',
    outcomeConfirm: 'Bestätigt',
    outcomeNothing: 'Ohne Befund',
    outcomeConfirmed: 'vor Ort bestätigt',
    outcomeNothingFound: 'geprüft — nichts gefunden',
    sensorMeasuredBy: 'Bodensonde',
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
    mapShowDay: 'Vergangenen Tag anzeigen',
    mapViewingDay: 'Ansicht',
    mapBackToLive: 'Zur Live-Ansicht',
    mapDetections: 'Detektionen',
    statusShow: 'Systemzustand anzeigen',
    statusHide: 'Systemzustand ausblenden',
    statusTitle: 'SYSTEMZUSTAND',
    statusLoading: 'Wird abgefragt…',
    statusOverallOk: 'Alle Quellen haben rechtzeitig geliefert.',
    statusOverallDegraded: 'Eingeschränkt — nicht alle Quellen liefern wie vorgesehen.',
    statusOverallBlind:
      'Es kommen keine Daten an — die Karte zeigt nicht die aktuelle Lage.',
    statusSatellites: 'Zuletzt abgefragte Satelliten',
    statusNoSources: 'Noch keine Abfrage gemeldet.',
    statusAnswered: 'geantwortet',
    statusNoAnswer: 'keine Antwort',
    statusCycle: 'Letzte vollständige Abfrage',
    statusLookback: 'Abfrage über {days} Tage',
    statusFeeds: 'Weitere Quellen',
    statusWeather: 'Wetter',
    statusForecast: 'Zündfenster-Vorhersage',
    statusFireDanger: 'Waldbrandgefahr (FWI)',
    statusZones: 'Zonen',
    statusFresh: 'frisch',
    statusStale: 'veraltet',
    statusMissing: 'keine Daten',
    statusNever: 'nie',
    statusJustNow: 'gerade eben',
    statusMinutesAgo: 'vor {minutes} min',
    statusHoursAgo: 'vor {hours} h',
    statusRecord: 'Datenbestand',
    statusDetections24h: 'Detektionen 24 h',
    statusDetections7d: '7 Tage',
    statusDetectionsTotal: 'gesamt',
    statusSensors: 'Sonden aktiv',
    statusDeadLetters: 'fehlgeschlagene Aufträge',
    statusRecordReaches: 'Daten reichen zurück bis',
    statusReplayedTo: 'Archiv nachgeladen bis',
    statusAsOf: 'Stand',
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
    reportLink: 'Lagebericht (PDF)',
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
    zonesLoadFailed: 'Die Zonen konnten nicht geladen werden.',
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
    hazardWhitePhosphorusForest: 'Wald mit Phosphor-Altlast',
    hazardWildfire: 'Waldbrand',
    hazardAmmunitionDepot: 'Munitionsdepot',
    hazardGeneric: 'Allgemein',
  },
};
