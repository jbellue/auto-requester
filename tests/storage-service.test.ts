import { describe, expect, it } from "vitest";
import { StorageService } from "../src/services/StorageService";
import { SITE_IDS_KEY, getSiteKey } from "../src/shared";
import { createSite, createStorageMock } from "./test-utils";

describe("StorageService", () => {
    it("returns empty site ids when missing or invalid", async () => {
        const fixtureEmpty = createStorageMock({});
        const serviceEmpty = new StorageService(fixtureEmpty.storage);

        expect(await serviceEmpty.getSiteIds()).toEqual([]);

        const fixtureInvalid = createStorageMock({ [SITE_IDS_KEY]: "nope" });
        const serviceInvalid = new StorageService(fixtureInvalid.storage);

        expect(await serviceInvalid.getSiteIds()).toEqual([]);
    });

    it("loads a site or returns null", async () => {
        const site = createSite("site-1");
        const fixture = createStorageMock({ [getSiteKey(site.id)]: site });
        const service = new StorageService(fixture.storage);

        expect(await service.loadSite(site.id)).toEqual(site);
        expect(await service.loadSite("missing")).toBeNull();
    });

    it("loads sites from storage", async () => {
        const site = createSite("site-1");
        const fixture = createStorageMock({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });
        const service = new StorageService(fixture.storage);

        expect(await service.loadSites()).toEqual([site]);
    });

    it("saves a site by key", async () => {
        const site = createSite("site-1");
        const fixture = createStorageMock({});
        const service = new StorageService(fixture.storage);

        await service.saveSite(site);

        expect(fixture.setCalls).toEqual([{ [getSiteKey(site.id)]: site }]);
    });

    it("adds a site and records the id", async () => {
        const fixture = createStorageMock({});
        const service = new StorageService(fixture.storage);
        const site = createSite("site-2");

        await service.addSite(site);

        expect(fixture.setCalls).toEqual([
            { [SITE_IDS_KEY]: [site.id], [getSiteKey(site.id)]: site },
        ]);
    });

    it("does not duplicate ids when adding", async () => {
        const site = createSite("site-3");
        const fixture = createStorageMock({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });
        const service = new StorageService(fixture.storage);

        await service.addSite(site);

        expect(fixture.setCalls).toEqual([
            { [SITE_IDS_KEY]: [site.id], [getSiteKey(site.id)]: site },
        ]);
    });

    it("removes a site id and key", async () => {
        const site = createSite("site-4");
        const fixture = createStorageMock({
            [SITE_IDS_KEY]: [site.id, "other"],
            [getSiteKey(site.id)]: site,
        });
        const service = new StorageService(fixture.storage);

        await service.removeSite(site.id);

        expect(fixture.setCalls).toEqual([{ [SITE_IDS_KEY]: ["other"] }]);
        expect(fixture.removeCalls).toEqual([getSiteKey(site.id)]);
    });

    it("updates last run when site exists", async () => {
        const site = createSite("site-5");
        const fixture = createStorageMock({ [getSiteKey(site.id)]: site });
        const service = new StorageService(fixture.storage);

        await service.updateLastRun(site.id, 12345);

        expect(fixture.setCalls).toEqual([
            { [getSiteKey(site.id)]: { ...site, lastRun: 12345 } },
        ]);
    });

    it("does nothing when updating last run for missing site", async () => {
        const fixture = createStorageMock({});
        const service = new StorageService(fixture.storage);

        await service.updateLastRun("missing", 12345);

        expect(fixture.setCalls).toEqual([]);
    });
});
