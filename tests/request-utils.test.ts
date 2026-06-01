import { describe, expect, it } from "vitest";
import { parseHeaders, urlMatchesPattern } from "../src/utils/request";

describe("request utils", () => {
    describe("parseHeaders", () => {
        it("returns empty object for blank input", () => {
            expect(parseHeaders("\n  \n")).toEqual({});
        });

        it("parses multiple headers with trimming", () => {
            const headers = parseHeaders("Content-Type: application/json\nX-Test:  value  ");

            expect(headers).toEqual({
                "Content-Type": "application/json",
                "X-Test": "value",
            });
        });

        it("skips blank lines between headers", () => {
            const headers = parseHeaders("X-Test: 1\n\nY-Test: 2");

            expect(headers).toEqual({
                "X-Test": "1",
                "Y-Test": "2",
            });
        });

        it("ignores lines without a valid key", () => {
            const headers = parseHeaders("NoColonLine\n:bad\nX-Test: yes");

            expect(headers).toEqual({
                "X-Test": "yes",
            });
        });

        it("keeps colons inside values", () => {
            const headers = parseHeaders("X-Trace: part1:part2");

            expect(headers).toEqual({
                "X-Trace": "part1:part2",
            });
        });
    });

    describe("urlMatchesPattern", () => {
        it("matches wildcard scheme and path", () => {
            expect(urlMatchesPattern("https://example.com/path", "*://example.com/*")).toBe(true);
            expect(urlMatchesPattern("http://example.com/", "*://example.com/*")).toBe(true);
        });

        it("matches subdomains with wildcard", () => {
            expect(urlMatchesPattern("https://api.example.com/foo", "*://*.example.com/*")).toBe(true);
        });

        it("does not match when pattern is exact", () => {
            expect(urlMatchesPattern("https://example.com/path/extra", "https://example.com/path")).toBe(false);
        });

        it("treats dots as literal characters", () => {
            expect(urlMatchesPattern("https://example.com/file.json", "https://example.com/file.json")).toBe(true);
            expect(urlMatchesPattern("https://example.com/fileXjson", "https://example.com/file.json")).toBe(false);
        });
    });
});
