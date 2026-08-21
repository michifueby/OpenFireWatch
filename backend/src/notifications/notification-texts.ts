/**
 * Every human-facing notification string, in one place, in both languages.
 *
 * They were scattered across five services and hard-coded German — right for
 * the deployment this was built for, wrong for a project inviting other
 * operators. NOTIFY_LANGUAGE picks the language per deployment (not per
 * recipient: a notification goes to a channel, and a crew shares a channel).
 *
 * Builders rather than a key→string map: each message needs its own facts,
 * and a typed function per message means a missing value is a compile error
 * instead of a "{temp}" leaking into somebody's 03:00 phone alert.
 */

export type NotifyLang = 'de' | 'en';

export function notifyLang(): NotifyLang {
  return process.env.NOTIFY_LANGUAGE?.trim().toLowerCase() === 'en' ? 'en' : 'de';
}

/** Alert levels as a person should read them, per language. */
const LEVEL_NAMES: Record<NotifyLang, Record<string, string>> = {
  de: {
    CRITICAL_PHOSPHORUS_FIRE: 'Phosphorbrand',
    CRITICAL_WILDFIRE: 'Waldbrand',
    CRITICAL_ORDNANCE_HEAT: 'Hitze an Munitionsstandort',
    CRITICAL_SMOULDERING: 'Glutnest',
    CRITICAL_THERMAL_ANOMALY: 'Thermische Anomalie',
    CRITICAL_SENSOR_HEAT: 'Hitze an Bodensonde',
  },
  en: {
    CRITICAL_PHOSPHORUS_FIRE: 'Phosphorus fire',
    CRITICAL_WILDFIRE: 'Wildfire',
    CRITICAL_ORDNANCE_HEAT: 'Heat at ordnance site',
    CRITICAL_SMOULDERING: 'Smouldering nest',
    CRITICAL_THERMAL_ANOMALY: 'Thermal anomaly',
    CRITICAL_SENSOR_HEAT: 'Ground-sensor heat',
  },
};

export function levelName(level: string, lang = notifyLang()): string {
  return LEVEL_NAMES[lang][level] ?? level;
}

/** The line every message ends with; a notification is not a dispatch. */
const NOT_A_DISPATCH: Record<NotifyLang, string> = {
  de: 'Kein Ersatz für den Notruf 122.',
  en: 'Not a substitute for the emergency number (112/122).',
};

export function criticalAlertText(input: {
  level: string;
  zoneName: string | null;
  temperatureC?: number;
  soilMoisturePct?: number;
  latitude: number;
  longitude: number;
  acquiredAt: string;
  sensorLabel?: string;
}): { title: string; body: string } {
  const lang = notifyLang();
  const zone =
    input.zoneName ??
    (lang === 'de' ? 'außerhalb aller Zonen' : 'outside every zone');
  const when = new Date(input.acquiredAt).toLocaleString(
    lang === 'de' ? 'de-AT' : 'en-GB',
  );

  const de = [
    `Zone: ${zone}`,
    input.sensorLabel ? `Gemessen von Bodensonde: ${input.sensorLabel}` : null,
    input.temperatureC !== undefined ? `Temperatur: ${input.temperatureC} °C` : null,
    input.soilMoisturePct !== undefined ? `Bodenfeuchte: ${input.soilMoisturePct} %` : null,
    `Koordinaten: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    `${input.sensorLabel ? 'Messzeitpunkt' : 'Satellitenaufnahme'}: ${when}`,
  ];
  const en = [
    `Zone: ${zone}`,
    input.sensorLabel ? `Measured by ground sensor: ${input.sensorLabel}` : null,
    input.temperatureC !== undefined ? `Temperature: ${input.temperatureC} °C` : null,
    input.soilMoisturePct !== undefined ? `Soil moisture: ${input.soilMoisturePct} %` : null,
    `Coordinates: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    `${input.sensorLabel ? 'Measured at' : 'Satellite acquisition'}: ${when}`,
  ];

  return {
    title: `${levelName(input.level, lang)} — ${zone}`,
    body: [...(lang === 'de' ? de : en), '', NOT_A_DISPATCH[lang]]
      .filter((line): line is string => line !== null)
      .join('\n'),
  };
}

export function stalledText(): { title: string; body: string } {
  if (notifyLang() === 'en') {
    return {
      title: 'OpenFireWatch is no longer receiving data',
      body: [
        'No ingestion cycle has succeeded for several polling intervals.',
        'The map still shows the last known picture — but it is no longer',
        'current, and new heat sources are currently not being detected.',
        '',
        'Please check that the services are running.',
      ].join('\n'),
    };
  }
  return {
    title: 'OpenFireWatch empfängt keine Daten mehr',
    body: [
      'Seit mehreren Abfragezyklen ist keine Datenaufnahme mehr gelungen.',
      'Die Karte zeigt weiterhin den letzten bekannten Stand — sie ist',
      'aber nicht mehr aktuell, und neue Hitzequellen werden derzeit',
      'nicht erkannt.',
      '',
      'Bitte den Betrieb der Dienste prüfen.',
    ].join('\n'),
  };
}

export function recoveredText(): { title: string; body: string } {
  if (notifyLang() === 'en') {
    return {
      title: 'Data ingestion has recovered',
      body: 'OpenFireWatch is receiving satellite and weather data again.',
    };
  }
  return {
    title: 'Datenaufnahme läuft wieder',
    body: 'OpenFireWatch empfängt wieder Satelliten- und Wetterdaten.',
  };
}

export function escalationText(input: {
  anomalyId: number;
  level: string;
  minutes: number;
  zoneName: string | null;
  latitude: number;
  longitude: number;
}): { title: string; body: string } {
  const lang = notifyLang();
  const zone =
    input.zoneName ??
    (lang === 'de' ? 'außerhalb aller Zonen' : 'outside every zone');

  if (lang === 'en') {
    return {
      title: `Unacknowledged alert — ${input.minutes} minutes and counting`,
      body: [
        `Alert #${input.anomalyId} (${levelName(input.level, lang)}) was raised`,
        `${input.minutes} minutes ago and nobody has taken it yet.`,
        '',
        `Zone: ${zone}`,
        `Coordinates: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
        '',
        'Taking it means pressing ACK on the map.',
        NOT_A_DISPATCH.en,
      ].join('\n'),
    };
  }
  return {
    title: `Unquittierter Alarm — seit ${input.minutes} Minuten`,
    body: [
      `Alarm #${input.anomalyId} (${levelName(input.level, lang)}) wurde vor`,
      `${input.minutes} Minuten gemeldet und bisher von niemandem übernommen.`,
      '',
      `Zone: ${zone}`,
      `Koordinaten: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
      '',
      'Übernehmen heißt: QUITT auf der Karte drücken.',
      NOT_A_DISPATCH.de,
    ].join('\n'),
  };
}

export function forecastWindowText(input: {
  zoneName: string;
  from: string;
  to: string;
  peakTemperatureC: number;
  minSoilMoisturePct: number;
  hoursAway: number;
}): { title: string; body: string } {
  const lang = notifyLang();
  const day = new Date(input.from).toLocaleDateString(
    lang === 'de' ? 'de-AT' : 'en-GB',
    { weekday: 'long', day: '2-digit', month: '2-digit' },
  );
  const from = input.from.slice(11, 16);
  const to = input.to.slice(11, 16);
  const hours = Math.round(input.hoursAway);

  if (lang === 'en') {
    return {
      title: `Ignition window expected — ${input.zoneName}`,
      body: [
        `${day}, ${from}–${to}: both self-ignition criteria are expected`,
        'to be met in this zone at the same time:',
        '',
        `  temperature up to ${input.peakTemperatureC} °C`,
        `  soil moisture down to ${input.minSoilMoisturePct} %`,
        '',
        `Lead time: about ${hours} hours.`,
        '',
        'This is a forecast, not a fire. It buys time for a patrol,',
        'a word to visitors, or standby.',
        '',
        NOT_A_DISPATCH.en,
      ].join('\n'),
    };
  }
  return {
    title: `Zündfenster erwartet — ${input.zoneName}`,
    body: [
      `${day}, ${from}–${to} Uhr werden in dieser Zone beide Bedingungen`,
      'für eine Selbstentzündung zugleich erfüllt:',
      '',
      `  Temperatur bis ${input.peakTemperatureC} °C`,
      `  Bodenfeuchte bis herunter auf ${input.minSoilMoisturePct} %`,
      '',
      `Vorlauf: rund ${hours} Stunden.`,
      '',
      'Das ist eine Vorhersage, kein Brand. Sie schafft Zeit für Streife,',
      'Hinweise an Waldbesucher oder Bereitschaft.',
      '',
      NOT_A_DISPATCH.de,
    ].join('\n'),
  };
}

export function testText(): { title: string; body: string } {
  if (notifyLang() === 'en') {
    return {
      title: 'OpenFireWatch — test message',
      body: [
        'This is a test message. There is no incident.',
        '',
        'If you can read this, notifications are working.',
      ].join('\n'),
    };
  }
  return {
    title: 'OpenFireWatch — Testmeldung',
    body: [
      'Dies ist eine Testmeldung. Es liegt kein Ereignis vor.',
      '',
      'Wenn Sie das lesen, funktioniert die Benachrichtigung.',
    ].join('\n'),
  };
}
