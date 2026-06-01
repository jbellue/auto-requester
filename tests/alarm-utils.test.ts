import { describe, expect, it } from "vitest";
import { ALARM_PREFIX, getAlarmName, getSiteIdFromAlarmName } from "../src/utils/alarm";

describe("alarm utils", () => {
    it("builds alarm names with the prefix", () => {
        expect(getAlarmName("abc123")).toBe(`${ALARM_PREFIX}abc123`);
    });

    it("extracts the site id from an alarm name", () => {
        expect(getSiteIdFromAlarmName(`${ALARM_PREFIX}site-9`)).toBe("site-9");
    });

    it("returns null for non-matching alarm names", () => {
        expect(getSiteIdFromAlarmName("other-prefix-site")).toBeNull();
    });

    it("returns null when the alarm name has no site id", () => {
        expect(getSiteIdFromAlarmName(ALARM_PREFIX)).toBeNull();
    });
});
