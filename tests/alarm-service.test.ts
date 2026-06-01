import { describe, expect, it } from "vitest";
import { AlarmService, type AlarmsApi } from "../src/services/AlarmService";
import { ALARM_PREFIX, getAlarmName } from "../src/utils/alarm";
import type { Alarm } from "../src/types";
import { createSite } from "./test-utils";

type AlarmCreateCall = {
    name: string;
    alarmInfo: { periodInMinutes?: number };
};

function createServiceFixture(initialAlarms: Alarm[] = []): {
    service: AlarmService;
    createCalls: AlarmCreateCall[];
    clearCalls: string[];
    setAlarms: (alarms: Alarm[]) => void;
} {
    let alarmsList = initialAlarms;
    const createCalls: AlarmCreateCall[] = [];
    const clearCalls: string[] = [];

    const alarms: AlarmsApi = {
        getAll: async () => alarmsList,
        clear: async (name) => {
            clearCalls.push(name);
            return true;
        },
        create: async (name, alarmInfo) => {
            createCalls.push({ name, alarmInfo });
        },
    };

    return {
        service: new AlarmService(alarms),
        createCalls,
        clearCalls,
        setAlarms: (alarms) => {
            alarmsList = alarms;
        },
    };
}

describe("AlarmService", () => {
    it("setupAlarms clears prefixed alarms and creates for enabled sites", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture([
            { name: `${ALARM_PREFIX}old-1` },
            { name: "other-alarm" },
        ]);

        const enabledSite = createSite("enabled", { checkInterval: 10, enabled: true });
        const disabledSite = createSite("disabled", { enabled: false });

        await service.setupAlarms([enabledSite, disabledSite]);

        expect(clearCalls).toEqual([`${ALARM_PREFIX}old-1`]);
        expect(createCalls).toEqual([
            { name: getAlarmName(enabledSite.id), alarmInfo: { periodInMinutes: 10 } },
        ]);
    });

    it("createAlarm schedules an alarm for the site", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const site = createSite("site-create", { checkInterval: 12 });

        await service.createAlarm(site);

        expect(createCalls).toEqual([
            { name: getAlarmName(site.id), alarmInfo: { periodInMinutes: 12 } },
        ]);
        expect(clearCalls).toEqual([]);
    });

    it("clearAlarm clears the site alarm", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();

        await service.clearAlarm("site-clear");

        expect(createCalls).toEqual([]);
        expect(clearCalls).toEqual([getAlarmName("site-clear")]);
    });

    it("updateAlarmForSite creates when enabling", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const oldSite = createSite("site-1", { enabled: false });
        const newSite = createSite("site-1", { enabled: true, checkInterval: 15 });

        await service.updateAlarmForSite(oldSite, newSite);

        expect(createCalls).toEqual([
            { name: getAlarmName(newSite.id), alarmInfo: { periodInMinutes: 15 } },
        ]);
        expect(clearCalls).toEqual([]);
    });

    it("updateAlarmForSite creates when old site is missing", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const newSite = createSite("site-1", { enabled: true, checkInterval: 18 });

        await service.updateAlarmForSite(undefined, newSite);

        expect(createCalls).toEqual([
            { name: getAlarmName(newSite.id), alarmInfo: { periodInMinutes: 18 } },
        ]);
        expect(clearCalls).toEqual([]);
    });

    it("updateAlarmForSite clears when disabling", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const oldSite = createSite("site-2", { enabled: true });
        const newSite = createSite("site-2", { enabled: false });

        await service.updateAlarmForSite(oldSite, newSite);

        expect(createCalls).toEqual([]);
        expect(clearCalls).toEqual([getAlarmName(newSite.id)]);
    });

    it("updateAlarmForSite updates when interval changes", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const oldSite = createSite("site-3", { enabled: true, checkInterval: 5 });
        const newSite = createSite("site-3", { enabled: true, checkInterval: 20 });

        await service.updateAlarmForSite(oldSite, newSite);

        expect(createCalls).toEqual([
            { name: getAlarmName(newSite.id), alarmInfo: { periodInMinutes: 20 } },
        ]);
        expect(clearCalls).toEqual([]);
    });

    it("updateAlarmForSite does nothing when interval is unchanged", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const oldSite = createSite("site-3", { enabled: true, checkInterval: 5 });
        const newSite = createSite("site-3", { enabled: true, checkInterval: 5 });

        await service.updateAlarmForSite(oldSite, newSite);

        expect(createCalls).toEqual([]);
        expect(clearCalls).toEqual([]);
    });

    it("updateAlarmForSite clears when removed", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();
        const oldSite = createSite("site-4", { enabled: true });

        await service.updateAlarmForSite(oldSite, undefined);

        expect(createCalls).toEqual([]);
        expect(clearCalls).toEqual([getAlarmName(oldSite.id)]);
    });

    it("updateAlarmForSite does nothing when both sites are missing", async () => {
        const { service, createCalls, clearCalls } = createServiceFixture();

        await service.updateAlarmForSite(undefined, undefined);

        expect(createCalls).toEqual([]);
        expect(clearCalls).toEqual([]);
    });
});
