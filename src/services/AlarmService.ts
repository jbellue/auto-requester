import type { Alarm, SiteConfig, SiteId } from "../types";
import { ALARM_PREFIX, getAlarmName } from "../utils/alarm";

export type AlarmsApi = {
    getAll: () => Promise<Alarm[]>;
    clear: (name: string) => Promise<boolean>;
    create: (name: string, alarmInfo: { periodInMinutes?: number }) => Promise<void>;
};

export class AlarmService {
    private readonly alarms: AlarmsApi;

    constructor(alarms: AlarmsApi) {
        this.alarms = alarms;
    }

    async setupAlarms(sites: SiteConfig[]): Promise<void> {
        await this.clearAlarmsWithPrefix();

        const enabledSites = sites.filter((site) => site.enabled);
        await Promise.all(
            enabledSites.map((site) =>
                this.alarms.create(getAlarmName(site.id), { periodInMinutes: site.checkInterval })
            )
        );
    }

    async createAlarm(site: SiteConfig): Promise<void> {
        await this.alarms.create(getAlarmName(site.id), {
            periodInMinutes: site.checkInterval,
        });
    }

    async clearAlarm(siteId: SiteId): Promise<void> {
        await this.alarms.clear(getAlarmName(siteId));
    }

    async updateAlarmForSite(oldSite: SiteConfig | undefined, newSite: SiteConfig | undefined): Promise<void> {
        if (!newSite) {
            if (oldSite?.id) {
                await this.alarms.clear(getAlarmName(String(oldSite.id)));
            }
            return;
        }

        const wasEnabled = oldSite?.enabled ?? false;
        const isEnabled = newSite.enabled;

        if (!wasEnabled && isEnabled) {
            await this.alarms.create(getAlarmName(newSite.id), {
                periodInMinutes: newSite.checkInterval,
            });
            console.log(`Created alarm for site ${newSite.id} (${newSite.checkInterval} min)`);
            return;
        }

        if (wasEnabled && !isEnabled) {
            await this.alarms.clear(getAlarmName(newSite.id));
            console.log(`Cleared alarm for site ${newSite.id}`);
            return;
        }

        if (isEnabled && oldSite && oldSite.checkInterval !== newSite.checkInterval) {
            await this.alarms.create(getAlarmName(newSite.id), {
                periodInMinutes: newSite.checkInterval,
            });
            console.log(`Updated alarm for site ${newSite.id} (${newSite.checkInterval} min)`);
        }
    }

    private async clearAlarmsWithPrefix(): Promise<void> {
        const allAlarms = await this.alarms.getAll();
        for (const alarm of allAlarms) {
            if (alarm.name.startsWith(ALARM_PREFIX)) {
                await this.alarms.clear(alarm.name);
            }
        }
    }
}
