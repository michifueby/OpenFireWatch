/**
 * ReportService — everything the system knows, gathered for one document.
 *
 * The live map answers questions one at a time; a meeting needs them answered
 * at once, on paper, dated and quotable. This service only COLLECTS — it
 * calls the same services the API serves and hands a typed bundle to the
 * renderer. No query in here is new: a report that computed its own numbers
 * could disagree with the screens it summarises, and a report that disagrees
 * with the system it describes is worse than no report.
 */

import { Injectable } from '@nestjs/common';

import { AlertHistoryEntry, AlertHistoryService } from '../alerts/alert-history.service';
import { QueryAlertsDto } from '../alerts/query-alerts.dto';
import { ConditionsService, CurrentConditions } from '../conditions/conditions.service';
import { ForecastService, ForecastSnapshot } from '../forecast/forecast.service';
import { HistoryService, ZoneHistory } from '../history/history.service';
import { IncidentEntry, IncidentSummary, IncidentsService } from '../incidents/incidents.service';
import { SensorService, SensorStatus } from '../sensors/sensor.service';
import { APP_VERSION, GIT_REVISION } from '../version';

export interface ReportData {
  generatedAt: string;
  version: string;
  revision: string;
  conditions: CurrentConditions;
  openCriticals: AlertHistoryEntry[];
  forecast: ForecastSnapshot;
  seasons: ZoneHistory[];
  incidents: IncidentEntry[];
  incidentSummary: IncidentSummary;
  sensors: SensorStatus[];
}

@Injectable()
export class ReportService {
  constructor(
    private readonly conditions: ConditionsService,
    private readonly alerts: AlertHistoryService,
    private readonly forecast: ForecastService,
    private readonly history: HistoryService,
    private readonly incidents: IncidentsService,
    private readonly sensors: SensorService,
  ) {}

  async collect(): Promise<ReportData> {
    // Parallel on purpose: six independent reads, and a report request should
    // not take six round trips longer than it must.
    const [conditions, openCriticals, forecast, seasons, incidentList, sensors] =
      await Promise.all([
        this.conditions.current(),
        this.alerts.find(
          Object.assign(new QueryAlertsDto(), {
            criticalOnly: true,
            unacknowledgedOnly: true,
            sinceHours: 168,
            limit: 20,
          }),
        ),
        this.forecast.current(),
        this.history.summary(),
        this.incidents.list(),
        this.sensors.findAll(),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      revision: GIT_REVISION,
      conditions,
      openCriticals,
      forecast,
      seasons: seasons.zones,
      incidents: incidentList.incidents,
      incidentSummary: incidentList.summary,
      sensors,
    };
  }
}
