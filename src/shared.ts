import type { SiteConfig, SiteId } from './types';

export const SITE_IDS_KEY = 'siteIds';
const SITE_KEY_PREFIX = 'site:';


export const ACTIONS = {
    enableSite: 'enableSite',
    disableSite: 'disableSite',
    testRequest: 'testRequest',
    siteRun: 'siteRun',
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];

export type SyncStorage = {
    get: (keys: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
};

export function getSiteKey(siteId: SiteId): string {
    return `${SITE_KEY_PREFIX}${siteId}`;
}

export async function loadSitesFromStorage(storage: SyncStorage): Promise<SiteConfig[]> {
    const data = await storage.get(SITE_IDS_KEY);
    const siteIds = data[SITE_IDS_KEY] as SiteId[] | undefined;

    if (!Array.isArray(siteIds) || siteIds.length === 0) {
        return [];
    }

    const siteKeys = siteIds.map(getSiteKey);
    const sitesData = await storage.get(siteKeys);
    const sitesFromKeys: SiteConfig[] = [];
    const missingIds: SiteId[] = [];

    for (const id of siteIds) {
        const site = sitesData[getSiteKey(id)] as SiteConfig | undefined;
        if (site) {
            sitesFromKeys.push(site);
        } else {
            missingIds.push(id);
        }
    }

    if (missingIds.length > 0) {
        const filteredIds = siteIds.filter(id => !missingIds.includes(id));
        await storage.set({ [SITE_IDS_KEY]: filteredIds });
    }

    return sitesFromKeys;
}
