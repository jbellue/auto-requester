import type { SiteConfig, SiteId } from "../types";
import { SITE_IDS_KEY, getSiteKey, loadSitesFromStorage } from "../shared";
import type { SyncStorage } from "../shared";
export type { SyncStorage };

export class StorageService {
    private readonly storage: SyncStorage;

    constructor(storage: SyncStorage) {
        this.storage = storage;
    }

    async loadSites(): Promise<SiteConfig[]> {
        return loadSitesFromStorage(this.storage);
    }

    async loadSite(siteId: SiteId): Promise<SiteConfig | null> {
        const siteKey = getSiteKey(siteId);
        const data = await this.storage.get(siteKey);
        const site = data[siteKey] as SiteConfig | undefined;
        return site ?? null;
    }

    async getSiteIds(): Promise<SiteId[]> {
        const data = await this.storage.get(SITE_IDS_KEY);
        const siteIds = data[SITE_IDS_KEY];
        return Array.isArray(siteIds) ? (siteIds as SiteId[]) : [];
    }

    async saveSite(site: SiteConfig): Promise<void> {
        await this.storage.set({ [getSiteKey(site.id)]: site });
    }

    async addSite(site: SiteConfig): Promise<void> {
        const siteIds = await this.getSiteIds();
        if (!siteIds.includes(site.id)) {
            siteIds.push(site.id);
        }
        await this.storage.set({
            [SITE_IDS_KEY]: siteIds,
            [getSiteKey(site.id)]: site,
        });
    }

    async removeSite(siteId: SiteId): Promise<void> {
        const siteIds = await this.getSiteIds();
        const updatedIds = siteIds.filter((id) => id !== siteId);
        await this.storage.set({ [SITE_IDS_KEY]: updatedIds });
        await this.storage.remove(getSiteKey(siteId));
    }

    async updateLastRun(siteId: SiteId, timestamp: number): Promise<void> {
        const site = await this.loadSite(siteId);
        if (!site) {
            return;
        }
        site.lastRun = timestamp;
        await this.storage.set({ [getSiteKey(siteId)]: site });
    }
}
