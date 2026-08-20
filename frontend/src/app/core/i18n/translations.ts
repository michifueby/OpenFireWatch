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
  ack: string;
  ackAria: string;
  labelTemp: string;
  labelSoil: string;
  labelCoords: string;
  labelAcquired: string;

  // --- Map (marker + popup) ----------------------------------------------------
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
    ack: 'ACK',
    ackAria: 'Acknowledge alert',
    labelTemp: 'TEMP',
    labelSoil: 'SOIL H₂O',
    labelCoords: 'LAT / LON',
    labelAcquired: 'ACQUIRED',

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
    zonesDrawHint: 'Click on the map to place corners. Double-click or Finish to close.',
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
    ack: 'QUITT',
    ackAria: 'Alarm quittieren',
    labelTemp: 'TEMP',
    labelSoil: 'BODEN H₂O',
    labelCoords: 'LAT / LON',
    labelAcquired: 'ERFASST',

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
    zonesDrawHint: 'Auf die Karte klicken, um Eckpunkte zu setzen. Doppelklick oder Fertig schließt die Fläche.',
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
    hazardWhitePhosphorus: 'Weißer Phosphor',
    hazardWildfire: 'Waldbrand',
    hazardAmmunitionDepot: 'Munitionsdepot',
    hazardGeneric: 'Allgemein',
  },
};
