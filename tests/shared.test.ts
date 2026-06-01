import { describe, expect, it } from "vitest";
import { getSiteKey, loadSitesFromStorage, SITE_IDS_KEY } from "../src/shared";
import { createSite, createStorageMock } from "./test-utils";

describe("shared storage helpers", () => {
    it("generates stable site keys", () => {
        expect(getSiteKey("abc123")).toBe("site:abc123");
    });

    it("returns empty array when no site ids exist", async () => {
        const { storage, setCalls } = createStorageMock({});
        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([]);
        expect(setCalls).toEqual([]);
    });

    it("returns empty array when site ids is not an array", async () => {
        const { storage, setCalls } = createStorageMock({
            [SITE_IDS_KEY]: "not-an-array",
        });
        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([]);
        expect(setCalls).toEqual([]);
    });

    it("returns empty array when site ids is empty", async () => {
        const { storage, setCalls } = createStorageMock({
            [SITE_IDS_KEY]: [],
        });
        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([]);
        expect(setCalls).toEqual([]);
    });

    it("loads sites in the same order as ids", async () => {
        const siteA = createSite("a");
        const siteB = createSite("b", { endpoint: "https://example.com/other" });
        const { storage, setCalls } = createStorageMock({
            [SITE_IDS_KEY]: [siteA.id, siteB.id],
            [getSiteKey(siteA.id)]: siteA,
            [getSiteKey(siteB.id)]: siteB,
        });

        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([siteA, siteB]);
        expect(setCalls).toEqual([]);
    });

    it("removes missing ids from storage", async () => {
        const siteA = createSite("a");
        const { storage, setCalls } = createStorageMock({
            [SITE_IDS_KEY]: ["a", "missing"],
            [getSiteKey(siteA.id)]: siteA,
        });

        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([siteA]);
        expect(setCalls).toEqual([{ [SITE_IDS_KEY]: ["a"] }]);
    });

    it("removes all ids when none of the site keys exist", async () => {
        const { storage, setCalls } = createStorageMock({
            [SITE_IDS_KEY]: ["missing-a", "missing-b"],
        });

        const sites = await loadSitesFromStorage(storage);

        expect(sites).toEqual([]);
        expect(setCalls).toEqual([{ [SITE_IDS_KEY]: [] }]);
    });
});
