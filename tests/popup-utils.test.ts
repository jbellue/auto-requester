import { describe, expect, it, vi } from "vitest";
import { formatLastRun, getInitialFromUrl } from "../src/utils/popup";

describe("popup utils", () => {
    it("formats last run timestamps", () => {
        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100000);

        expect(formatLastRun()).toBe("");
        expect(formatLastRun(100000 - 5000)).toBe("Just now");
        expect(formatLastRun(100000 - 12000)).toBe("12s ago");
        expect(formatLastRun(100000 - 2 * 60 * 1000)).toBe("2m ago");
        expect(formatLastRun(100000 - 3 * 60 * 60 * 1000)).toBe("3h ago");
        expect(formatLastRun(100000 - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");

        nowSpy.mockRestore();
    });

    it("extracts initials from URLs", () => {
        expect(getInitialFromUrl("")).toBe("E");
        expect(getInitialFromUrl("https://example.com/path")).toBe("E");
        expect(getInitialFromUrl("http://www.test.com/path")).toBe("T");
        expect(getInitialFromUrl("*://site.local/path")).toBe("S");
        expect(getInitialFromUrl("http://")).toBe("E");
    });
});
