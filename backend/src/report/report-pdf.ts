/**
 * The situation report as a PDF — a pure function from data to bytes.
 *
 * Kept apart from the collector so each can be judged alone: the collector
 * answers "are these the system's own numbers?", this file answers "is the
 * document readable?". pdfkit rather than a headless browser, because a
 * report generator that needs Chromium to run is a report generator that
 * fails on the day the meeting is.
 *
 * Layout principles, in order:
 *   1. The first page must carry the operational picture — conditions, open
 *     alerts, the next ignition window. History and caveats follow.
 *   2. Every number states its provenance; the two standing caveats (soil
 *     layer, literature thresholds) are IN the document, not a footnote to
 *     it. A report that hides its assumptions gets quoted without them.
 *   3. German is the default: the audience is an Austrian authority. ?lang=en
 *     exists because the project does.
 */

import PDFDocument from 'pdfkit';

import { levelName } from '../notifications/notification-texts';
import { ReportData } from './report.service';

type Lang = 'de' | 'en';

const COLOURS = {
  ink: '#1a202c',
  muted: '#5a6472',
  rule: '#c9ced6',
  alert: '#c21807',
  amber: '#b45309',
  ok: '#1f7a4d',
};

const T: Record<Lang, Record<string, string>> = {
  de: {
    title: 'Lagebericht',
    subtitle: 'Frühwarnsystem für gefährliche Hitzequellen',
    generated: 'Erstellt am',
    software: 'Softwarestand',
    s1: '1. Aktuelle Lage',
    readings: 'Messwerte',
    temperature: 'Lufttemperatur',
    soil: 'Bodenfeuchte',
    humidity: 'Luftfeuchte',
    wind: 'Wind',
    windFrom: 'aus',
    station: 'Station',
    noConditions: 'Keine aktuelle Datenaufnahme — Messwerte unbekannt.',
    fireDanger: 'Waldbrandgefahr (FWI)',
    fireDangerTomorrow: 'morgen',
    fireDangerMethod:
      'Canadian Fire Weather Index, berechnet nach der Methode von EFFIS und ' +
      'den nationalen Waldbrandkarten aus den Wetterdaten der Zone — kein amtlicher Wert.',
    danger_very_low: 'sehr gering',
    danger_low: 'gering',
    danger_moderate: 'mäßig',
    danger_high: 'hoch',
    danger_very_high: 'sehr hoch',
    danger_extreme: 'extrem',
    readiness: 'Zonenbereitschaft',
    armed: 'Zündfenster OFFEN',
    onDetection: 'Alarm bei jeder erkannten Hitzequelle — unabhängig vom Wetter',
    gap: '{t} °C und {s} % vom Zündfenster entfernt',
    openAlerts: 'Offene (unquittierte) kritische Alarme',
    noOpenAlerts: 'Keine offenen kritischen Alarme.',
    s2: '2. Zündfenster-Vorhersage (7 Tage)',
    forecastUnavailable: 'Keine aktuelle Vorhersage verfügbar.',
    noWindow: 'kein Zündfenster in den nächsten 7 Tagen',
    notWeather: 'Wetter spielt hier keine Rolle — Alarm bei erkannter Hitze',
    windowLine: '{day}, {from}–{to} Uhr · bis {t} °C · Boden bis {s} %',
    s3: '3. Saisonauswertung — Tage mit offenem Zündfenster',
    year: 'Jahr',
    days: 'Tage',
    hours: 'Stunden',
    longest: 'längste Phase',
    running: '(laufend)',
    average: 'Mittel über abgeschlossene Jahre: {d} Tage',
    seasonSource:
      'Datengrundlage: ERA5-Reanalyse, Bodenschicht 0–7 cm. Die Regel arbeitet mit 1–3 cm; ' +
      'über 1153 Vergleichsstunden weicht das Archiv im Mittel um 2,2 Prozentpunkte ab. ' +
      'Geeignet zum Zählen von Tagen, nicht für Aussagen auf die Kommastelle.',
    noSeason: 'Noch keine Wetterhistorie geladen.',
    s4: '4. Ereignisse und Validierung',
    noIncidents: 'Noch keine Ereignisse erfasst.',
    incidentSummary: '{f} Brände erfasst · {w} von {a} im offenen Zündfenster · {al} mit Alarm des Systems',
    outcomeSummary: 'Rückmeldungen zu Alarmen: {c} bestätigt · {n} ohne Befund',
    inWindow: 'Fenster offen',
    notInWindow: 'Fenster geschlossen',
    windowUnknown: 'Fenster unbekannt',
    alerted: 'Alarm ausgelöst',
    notAlerted: 'kein Alarm',
    kindFire: 'Brand',
    kindDrill: 'Übung',
    kindObservation: 'Beobachtung',
    s5: '5. Bodensonden',
    noSensors: 'Keine Sonden registriert.',
    sensorReporting: 'meldet',
    sensorSilent: 'meldet nicht',
    battery: 'Akku',
    s6: '6. Grenzen dieses Berichts',
    limits1:
      'Die Schwellenwerte (30 °C Lufttemperatur, 20 % Bodenfeuchte) entstammen der Fachliteratur ' +
      'zu weißem Phosphor und sind keine Messungen aus dem Gebiet. Jede Auswertung in diesem ' +
      'Bericht erbt diese Annahme; das Ereignisregister in Abschnitt 4 dient dazu, sie zu prüfen.',
    limits2:
      'Satelliten erfassen einen Ort nur beim Überflug (Stunden Verzug, ca. 375 m Auflösung) und ' +
      'sehen verdeckte Glut nicht. Bodensonden schließen diese Lücke nur an ihrem Standort.',
    limits3:
      'OpenFireWatch ist ein quelloffenes Werkzeug ohne Zulassung als Warnsystem, ohne zugesicherte ' +
      'Verfügbarkeit und ohne Reaktionszeit-Garantie. Dieser Bericht ersetzt weder Erkundung vor Ort ' +
      'noch die Alarmierung über die Landeswarnzentrale.',
    zone: 'Zone',
    outside: 'außerhalb aller Zonen',
    page: 'Seite',
    of: 'von',
  },
  en: {
    title: 'Situation report',
    subtitle: 'Early warning system for dangerous heat sources',
    generated: 'Generated',
    software: 'Software',
    s1: '1. Current situation',
    readings: 'Readings',
    temperature: 'Air temperature',
    soil: 'Soil moisture',
    humidity: 'Humidity',
    wind: 'Wind',
    windFrom: 'from',
    station: 'Station',
    noConditions: 'No recent ingestion cycle — readings unknown.',
    fireDanger: 'Fire danger (FWI)',
    fireDangerTomorrow: 'tomorrow',
    fireDangerMethod:
      'Canadian Fire Weather Index, computed by the method behind EFFIS and ' +
      'the national fire-danger maps from the weather at each zone — not an official figure.',
    danger_very_low: 'very low',
    danger_low: 'low',
    danger_moderate: 'moderate',
    danger_high: 'high',
    danger_very_high: 'very high',
    danger_extreme: 'extreme',
    readiness: 'Zone readiness',
    armed: 'ignition window OPEN',
    onDetection: 'alarms on any detected heat source — regardless of weather',
    gap: '{t} °C and {s} % from the ignition window',
    openAlerts: 'Open (unacknowledged) critical alerts',
    noOpenAlerts: 'No open critical alerts.',
    s2: '2. Ignition-window forecast (7 days)',
    forecastUnavailable: 'No recent forecast available.',
    noWindow: 'no ignition window in the next 7 days',
    notWeather: 'weather plays no role here — alarms on detected heat',
    windowLine: '{day}, {from}–{to} · up to {t} °C · soil down to {s} %',
    s3: '3. Seasonal record — days with an open ignition window',
    year: 'Year',
    days: 'Days',
    hours: 'Hours',
    longest: 'longest spell',
    running: '(running)',
    average: 'Average over complete years: {d} days',
    seasonSource:
      'Source: ERA5 reanalysis, soil layer 0–7 cm. The rule uses 1–3 cm; over 1153 overlapping ' +
      'hours the archive differs by 2.2 percentage points on average. Fit for counting days, ' +
      'not for decimals.',
    noSeason: 'No weather history loaded yet.',
    s4: '4. Incidents and validation',
    noIncidents: 'No incidents recorded yet.',
    incidentSummary: '{f} fires recorded · {w} of {a} in an open window · {al} with a system alert',
    outcomeSummary: 'Crew feedback on alerts: {c} confirmed · {n} nothing found',
    inWindow: 'window open',
    notInWindow: 'window closed',
    windowUnknown: 'window unknown',
    alerted: 'alert raised',
    notAlerted: 'no alert',
    kindFire: 'Fire',
    kindDrill: 'Drill',
    kindObservation: 'Observation',
    s5: '5. Ground sensors',
    noSensors: 'No sensors registered.',
    sensorReporting: 'reporting',
    sensorSilent: 'not reporting',
    battery: 'Battery',
    s6: '6. Limits of this report',
    limits1:
      'The thresholds (30 °C air temperature, 20 % soil moisture) come from published work on ' +
      'white phosphorus, not from measurements at this site. Every figure in this report inherits ' +
      'that assumption; the incident register in section 4 exists to test it.',
    limits2:
      'Satellites see a location only on overpass (hours of delay, ~375 m resolution) and cannot ' +
      'see covered smoulder. Ground sensors close that gap only where they stand.',
    limits3:
      'OpenFireWatch is an open-source tool with no certification as a warning system, no ' +
      'availability commitment and no response-time guarantee. This report replaces neither ' +
      'on-site reconnaissance nor official dispatch.',
    zone: 'Zone',
    outside: 'outside every zone',
    page: 'Page',
    of: 'of',
  },
};

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '?'));

/** Build the whole report; resolves once the last byte is written. */
export function renderReport(data: ReportData, lang: Lang): Promise<Buffer> {
  const t = T[lang];
  const locale = lang === 'de' ? 'de-AT' : 'en-GB';
  const pick = (name: { de: string; en: string }): string => name[lang] || name.de;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: 56, right: 56 },
    bufferPages: true, // page numbers are stamped at the end
    info: {
      Title: `OpenFireWatch — ${t['title']}`,
      Author: 'OpenFireWatch',
      Subject: t['subtitle'],
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  /** Room left, or a page break — sections must not strand their heading. */
  const need = (points: number): void => {
    if (doc.y + points > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  };

  const heading = (text: string): void => {
    need(60);
    doc.moveDown(1.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLOURS.ink)
      .text(text, left, doc.y, { width });
    doc
      .moveTo(left, doc.y + 3)
      .lineTo(left + width, doc.y + 3)
      .lineWidth(0.7)
      .strokeColor(COLOURS.rule)
      .stroke();
    doc.moveDown(0.6);
  };

  const line = (text: string, options: { colour?: string; indent?: number; bold?: boolean } = {}): void => {
    need(16);
    doc
      .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(options.colour ?? COLOURS.ink)
      .text(text, left + (options.indent ?? 0), doc.y, { width: width - (options.indent ?? 0) });
  };

  const mutedLine = (text: string, indent = 0): void => line(text, { colour: COLOURS.muted, indent });

  // ---------------------------------------------------------------- header --
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(COLOURS.ink)
    .text('OpenFireWatch', left, doc.y, { width });
  doc.font('Helvetica').fontSize(13).fillColor(COLOURS.alert).text(t['title']!);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(COLOURS.muted).text(t['subtitle']!);
  doc.text(
    `${t['generated']}: ${new Date(data.generatedAt).toLocaleString(locale)}   ·   ` +
      `${t['software']}: v${data.version} (${data.revision})   ·   openfirewatch.org`,
  );
  doc
    .moveTo(left, doc.y + 6)
    .lineTo(left + width, doc.y + 6)
    .lineWidth(1)
    .strokeColor(COLOURS.alert)
    .stroke();
  doc.moveDown(0.5);

  // -------------------------------------------------------- current picture --
  heading(t['s1']!);
  const c = data.conditions;
  if (c.available) {
    const wind =
      c.windSpeedKmh != null
        ? `   ${t['wind']}: ${Math.round(c.windSpeedKmh)} km/h${
            c.windDirectionDeg != null ? ` ${t['windFrom']} ${compass(c.windDirectionDeg, lang)}` : ''
          }`
        : '';
    line(
      `${t['temperature']}: ${c.temperatureC} °C   ${t['soil']}: ${c.soilMoisturePct} %   ` +
        `${t['humidity']}: ${c.relativeHumidityPct} %${wind}`,
    );
    mutedLine(`${t['station']} ${c.stationId} · ${new Date(c.observedAt!).toLocaleString(locale)}`);
  } else {
    line(t['noConditions']!, { colour: COLOURS.amber });
  }

  // The fire danger stands apart from the station readings: it comes from a
  // different feed, so it can be present when the readings are not — and the
  // method is named in the document itself, where the number will be quoted.
  const danger = c.fireDanger;
  if (danger?.available && danger.fwi !== undefined && danger.dangerClass) {
    const className = (c: string): string => t[`danger_${c}`] ?? c;
    const tomorrow = danger.tomorrow
      ? `   ${t['fireDangerTomorrow']}: ${className(danger.tomorrow.dangerClass)} (${danger.tomorrow.fwi})`
      : '';
    line(`${t['fireDanger']}: ${className(danger.dangerClass)} · FWI ${danger.fwi}${tomorrow}`);
    mutedLine(t['fireDangerMethod']!);
  }

  doc.moveDown(0.5);
  line(t['readiness']!, { bold: true });
  for (const zone of c.zones) {
    const state =
      zone.gate === 'detection'
        ? t['onDetection']!
        : zone.armed
          ? t['armed']!
          : fill(t['gap']!, {
              t: Math.max(0, Math.round((zone.temperatureGapC ?? 0) * 10) / 10),
              s: Math.max(0, Math.round((zone.soilMoistureGapPct ?? 0) * 10) / 10),
            });
    const colour =
      zone.gate === 'weather' && zone.armed ? COLOURS.alert : COLOURS.ink;
    line(`•  ${pick(zone.name)} — ${state}`, { indent: 8, colour });
  }

  doc.moveDown(0.5);
  line(t['openAlerts']!, { bold: true });
  if (data.openCriticals.length === 0) {
    mutedLine(t['noOpenAlerts']!, 8);
  } else {
    for (const alert of data.openCriticals.slice(0, 8)) {
      line(
        `•  #${alert.id} ${levelName(alert.level, lang)} — ${
          alert.zone ? pick(alert.zone.name) : t['outside']
        } · ${new Date(alert.evaluatedAt).toLocaleString(locale)} · ` +
          `${alert.weather.temperatureC} °C / ${alert.weather.soilMoisturePct} %`,
        { indent: 8, colour: COLOURS.alert },
      );
    }
  }

  // ---------------------------------------------------------------- forecast --
  heading(t['s2']!);
  if (!data.forecast.available) {
    line(t['forecastUnavailable']!, { colour: COLOURS.amber });
  } else {
    for (const zone of data.forecast.zones) {
      if (!zone.weatherGated) {
        mutedLine(`•  ${pick(zone.name)} — ${t['notWeather']}`, 8);
        continue;
      }
      const next = zone.windows[0];
      if (!next) {
        line(`•  ${pick(zone.name)} — ${t['noWindow']}`, { indent: 8 });
        continue;
      }
      const day = new Date(next.from).toLocaleDateString(locale, {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
      });
      line(
        `•  ${pick(zone.name)} — ` +
          fill(t['windowLine']!, {
            day,
            from: next.from.slice(11, 16),
            to: next.to.slice(11, 16),
            t: next.peakTemperatureC,
            s: next.minSoilMoisturePct,
          }),
        { indent: 8, colour: COLOURS.amber },
      );
    }
  }

  // ------------------------------------------------------------------ season --
  heading(t['s3']!);
  const seasonal = data.seasons.filter((z) => z.weatherGated && z.years.length > 0);
  if (seasonal.length === 0) {
    mutedLine(t['noSeason']!);
  } else {
    for (const zone of seasonal) {
      line(pick(zone.name), { bold: true });
      const currentYear = new Date().getFullYear();
      const worst = Math.max(...zone.years.map((y) => y.days), 1);
      // Drawn bars, not block glyphs: U+2588 is outside WinAnsi and the
      // standard fonts render it as garbage — and a rectangle scales exactly.
      const barLeft = left + 190;
      const barMax = width - 190 - 70;
      for (const year of zone.years) {
        need(15);
        const rowY = doc.y;
        const running = year.year === currentYear;
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(running ? COLOURS.amber : COLOURS.ink)
          .text(
            `${year.year}   ${year.days} ${t['days']} · ${year.hours} ${t['hours']}` +
              (running ? ` ${t['running']}` : ''),
            left + 8,
            rowY,
            { width: 180, lineBreak: false },
          );
        doc
          .rect(barLeft, rowY + 1.5, Math.max(2, (year.days / worst) * barMax), 6.5)
          .fill(running ? COLOURS.amber : COLOURS.alert);
        doc.fillColor(COLOURS.ink);
        doc.y = rowY + 14;
        doc.x = left;
      }
      if (zone.averageDaysPerYear !== null) {
        mutedLine(fill(t['average']!, { d: zone.averageDaysPerYear }), 8);
      }
      doc.moveDown(0.4);
    }
    doc.fontSize(8).fillColor(COLOURS.muted).text(t['seasonSource']!, left, doc.y, { width });
  }

  // --------------------------------------------------------------- incidents --
  heading(t['s4']!);
  if (data.incidents.length === 0) {
    mutedLine(t['noIncidents']!);
  } else {
    const s = data.incidentSummary;
    line(
      fill(t['incidentSummary']!, {
        f: s.fires,
        w: s.firesInWindow,
        a: s.firesWindowApplicable,
        al: s.firesAlerted,
      }),
      { bold: true },
    );
    if (s.alertsConfirmed + s.alertsNothingFound > 0) {
      line(fill(t['outcomeSummary']!, { c: s.alertsConfirmed, n: s.alertsNothingFound }));
    }
    doc.moveDown(0.3);
    for (const incident of data.incidents.slice(0, 15)) {
      const kind = t[`kind${incident.kind[0]!.toUpperCase()}${incident.kind.slice(1)}`] ?? incident.kind;
      const verdicts =
        incident.kind === 'fire'
          ? ` — ${
              incident.inIgnitionWindow === null
                ? t['windowUnknown']
                : incident.inIgnitionWindow
                  ? t['inWindow']
                  : t['notInWindow']
            }, ${incident.alertRaised ? t['alerted'] : t['notAlerted']}`
          : '';
      line(
        `•  ${new Date(incident.occurredAt).toLocaleDateString(locale)}  ${kind}: ${incident.title}` +
          `${incident.zone ? ` (${pick(incident.zone.name)})` : ''}${verdicts}`,
        { indent: 8 },
      );
    }
  }

  // ----------------------------------------------------------------- sensors --
  heading(t['s5']!);
  if (data.sensors.length === 0) {
    mutedLine(t['noSensors']!);
  } else {
    for (const sensor of data.sensors) {
      const values = [
        sensor.temperatureC !== null ? `${sensor.temperatureC} °C` : null,
        sensor.soilMoisturePct !== null ? `${sensor.soilMoisturePct} %` : null,
        sensor.batteryPct !== null ? `${t['battery']} ${sensor.batteryPct} %` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      line(
        `•  ${sensor.label} — ${sensor.reporting ? t['sensorReporting'] : t['sensorSilent']}` +
          (values ? ` · ${values}` : ''),
        { indent: 8, colour: sensor.reporting ? COLOURS.ok : COLOURS.muted },
      );
    }
  }

  // ------------------------------------------------------------------ limits --
  heading(t['s6']!);
  for (const key of ['limits1', 'limits2', 'limits3'] as const) {
    doc.font('Helvetica').fontSize(9).fillColor(COLOURS.ink).text(t[key]!, left, doc.y, { width });
    doc.moveDown(0.5);
  }

  // ------------------------------------------------------------ page numbers --
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLOURS.muted)
      .text(
        `OpenFireWatch v${data.version} · ${t['page']} ${i + 1} ${t['of']} ${range.count}`,
        left,
        doc.page.height - 40,
        { width, align: 'center' },
      );
  }

  doc.end();
  return done;
}

/** Degrees → eight compass points, in the report's language. */
function compass(degrees: number, lang: Lang): string {
  const points =
    lang === 'de'
      ? ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
      : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}
