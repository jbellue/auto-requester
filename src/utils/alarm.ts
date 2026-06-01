import type { SiteId } from "../types";

export const ALARM_PREFIX = "auto-requester-alarm_";

export function getAlarmName(siteId: SiteId): string {
    return `${ALARM_PREFIX}${siteId}`;
}

export function getSiteIdFromAlarmName(alarmName: string): SiteId | null {
    if (!alarmName.startsWith(ALARM_PREFIX)) return null;
    const siteId = alarmName.slice(ALARM_PREFIX.length);
    return siteId ? siteId : null;
}
