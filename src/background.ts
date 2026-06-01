import type { SiteConfig, SiteId, RequestResult } from './types';
import type BrowserPolyfill from 'webextension-polyfill';
import { ACTIONS, SITE_IDS_KEY, getSiteKey } from './shared';
import { AlarmService } from './services/AlarmService';
import { StorageService } from './services/StorageService';
import { getSiteIdFromAlarmName } from './utils/alarm';
import { parseHeaders, urlMatchesPattern } from './utils/request';

// Load webextension-polyfill for service worker (Chrome)
// Firefox loads it via manifest.json scripts array
declare function importScripts(...urls: string[]): void;
if (typeof importScripts === 'function') {
    importScripts('browser-polyfill.js');
}

// Use webextension-polyfill global
(function () {
const browser = (globalThis as unknown as { browser: typeof BrowserPolyfill }).browser;

console.log("Background script starting...");
// Global error handler
self.addEventListener('error', (event) => {
    console.error("Global error in background script:", event.error);
    event.preventDefault();
});

// Global promise rejection handler
self.addEventListener('unhandledrejection', (event) => {
    console.error("Unhandled promise rejection in background script:", event.reason);
    event.preventDefault();
});

// Constants
const MAX_LOG_LENGTH = 100;
const REQUEST_TIMEOUT = 30000;

// Configuration
let siteConfigs: SiteConfig[] = [];
const alarmService = new AlarmService(browser.alarms);
const storageService = new StorageService(browser.storage.sync);

// ============================================================================
// Storage Functions
// ============================================================================

async function syncSiteConfig(siteId: SiteId, overrides?: Partial<SiteConfig>): Promise<SiteConfig | null> {
    const storedSite = await storageService.loadSite(siteId);
    if (!storedSite) return null;

    const updatedSite: SiteConfig = {
        ...storedSite,
        ...overrides,
    };
    const siteIndex = siteConfigs.findIndex(s => s.id === siteId);
    if (siteIndex === -1) {
        siteConfigs.push(updatedSite);
    } else {
        siteConfigs[siteIndex] = updatedSite;
    }
    return updatedSite;
}

function upsertSiteConfig(site: SiteConfig): void {
    const siteIndex = siteConfigs.findIndex(s => s.id === site.id);
    if (siteIndex === -1) {
        siteConfigs.push(site);
    } else {
        siteConfigs[siteIndex] = site;
    }
}

function removeSiteConfig(siteId: SiteId): void {
    siteConfigs = siteConfigs.filter(site => site.id !== siteId);
}

// ============================================================================
// HTTP Request Functions
// ============================================================================

async function makeRequest(site: SiteConfig): Promise<RequestResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const headers = parseHeaders(site.headers);
        const requestOptions: RequestInit = {
            method: site.method,
            headers,
            credentials: 'include',
            signal: controller.signal,
        };

        if (site.body && ['POST', 'PUT', 'PATCH'].includes(site.method)) {
            requestOptions.body = site.body;
        }

        const response = await fetch(site.endpoint, requestOptions);
        const body = await response.text();
        clearTimeout(timeoutId);

        if (!response.ok) {
            return {
                success: false,
                statusCode: response.status,
                statusText: response.statusText,
                body,
                error: `HTTP error: ${response.status} ${response.statusText}`,
            };
        }

        return {
            success: true,
            statusCode: response.status,
            statusText: response.statusText,
            body,
        };
    } catch (error) {
        clearTimeout(timeoutId);
        let errorMsg = 'Unknown error occurred';
        if (error instanceof Error) {
            errorMsg = error.name === 'AbortError' 
                ? `Request timeout after ${REQUEST_TIMEOUT / 1000}s`
                : error.message;
        }
        return {
            success: false,
            statusCode: 0,
            statusText: '',
            body: '',
            error: errorMsg,
        };
    }
}

// ============================================================================
// Core Logic
// ============================================================================

async function loadConfig(): Promise<void> {
    siteConfigs = await storageService.loadSites();
    console.log("Loaded configuration:", siteConfigs);

    await alarmService.setupAlarms(siteConfigs);
    console.log("Alarms setup complete");
}

async function sendRequestForSite(site: SiteConfig): Promise<void> {
    // Get all tabs and manually match against the pattern
    let allTabs: any[] = [];
    try {
        allTabs = await browser.tabs.query({});
    } catch (error) {
        console.error("Failed to query tabs:", error);
        return;
    }
    const matchingTabs = allTabs.filter((tab: any) => tab.url && urlMatchesPattern(tab.url, site.urlPattern));

    console.log(`Found ${matchingTabs.length} tab(s) matching ${site.urlPattern}`);

    if (matchingTabs.length === 0) {
        console.log(`No tabs matching ${site.urlPattern}, skipping request`);
        return;
    }

    console.log(`Sending ${site.method} request to ${site.endpoint}`);

    try {
        const response = await makeRequest(site);

        const body = response.body?.substring(0, MAX_LOG_LENGTH) || '';
        console.log(`✓ Request successful (${response.statusCode}):`, body);

        // Update lastRun timestamp
        const timestamp = Date.now();
        await storageService.updateLastRun(site.id, timestamp);
        site.lastRun = timestamp;

        // Notify popup of the update
        try {
            await browser.runtime.sendMessage({
                action: ACTIONS.siteRun,
                siteId: site.id,
                lastRun: timestamp
            });
        } catch (error) {
            const errorMessage = String(error);
            if (!errorMessage.includes('Receiving end does not exist')) {
                console.error("Unexpected error notifying popup:", error);
            }
        }
    } catch (error) {
        console.error("✗ Error sending request:", error);
    }
}

// Listen for alarms
browser.alarms.onAlarm.addListener((alarm) => {
    const siteId = getSiteIdFromAlarmName(alarm.name);
    if (siteId === null) return;

    const site = siteConfigs.find(s => s.id === siteId);
    if (site) {
        console.log(`Alarm triggered for ${site.endpoint}`);
        sendRequestForSite(site);
    }
});

// Listen for messages from popup
browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response?: any) => void) => {
    console.log("Message received:", message);
    const { action, siteId } = message as { action: string; siteId?: SiteId };

    (async () => {
        try {
            if (action === ACTIONS.enableSite && siteId !== undefined) {
                const site = await syncSiteConfig(siteId, { enabled: true });
                if (site) {
                    await alarmService.createAlarm(site);
                    console.log(`Enabled alarm for site #${siteId}`);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Site not found' });
                }
            } else if (action === ACTIONS.disableSite && siteId !== undefined) {
                await syncSiteConfig(siteId, { enabled: false });
                await alarmService.clearAlarm(siteId);
                console.log(`Disabled alarm for site #${siteId}`);
                sendResponse({ success: true });
            } else if (action === ACTIONS.testRequest && siteId !== undefined) {
                const site = siteConfigs.find(s => s.id === siteId);
                if (site) {
                    try {
                        console.log(`Test request: ${site.method} ${site.endpoint}`);
                        const response = await makeRequest(site);
                        console.log(`Test result: ${response.statusCode}`);
                        sendResponse({
                            success: response.success,
                            status: response.statusCode,
                            body: response.body,
                            error: response.error
                        });
                    } catch (error) {
                        console.error("Test request error:", error);
                        sendResponse({
                            success: false,
                            status: 0,
                            body: '',
                            error: String(error)
                        });
                    }
                } else {
                    sendResponse({ success: false, error: 'Site not found' });
                }
            } else {
                sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error("Error handling message:", error);
            sendResponse({ success: false, error: String(error) });
        }
    })();

    return true; // Keep message channel open for async response
});

async function handleStorageChange(changes: { [key: string]: { oldValue?: unknown; newValue?: unknown } }, areaName: string): Promise<void> {
    if (areaName !== 'sync') return;

    if (changes[SITE_IDS_KEY]) {
        const change = changes[SITE_IDS_KEY];
        const oldIds = Array.isArray(change?.oldValue) ? (change.oldValue as SiteId[]) : [];
        const newIds = Array.isArray(change?.newValue) ? (change.newValue as SiteId[]) : [];

        if ((change?.oldValue !== undefined && !Array.isArray(change.oldValue)) ||
            (change?.newValue !== undefined && !Array.isArray(change.newValue))) {
            await loadConfig();
        } else {
            const oldSet = new Set(oldIds);
            const newSet = new Set(newIds);
            const changedKeys = new Set(Object.keys(changes));
            const removedIds = oldIds.filter(id => !newSet.has(id));
            const addedIds = newIds.filter(id => !oldSet.has(id));

            for (const removedId of removedIds) {
                if (changedKeys.has(getSiteKey(removedId))) {
                    continue;
                }
                const existingSite = siteConfigs.find(site => site.id === removedId);
                if (existingSite) {
                    removeSiteConfig(removedId);
                    await alarmService.updateAlarmForSite(existingSite, undefined);
                } else {
                    await alarmService.clearAlarm(removedId);
                }
            }

            for (const addedId of addedIds) {
                if (changedKeys.has(getSiteKey(addedId))) {
                    continue;
                }
                const newSite = await storageService.loadSite(addedId);
                if (newSite) {
                    upsertSiteConfig(newSite);
                    await alarmService.updateAlarmForSite(undefined, newSite);
                }
            }
        }
    }

    for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith('site:')) continue;
        const oldSite = change.oldValue as SiteConfig | undefined;
        const newSite = change.newValue as SiteConfig | undefined;

        if (newSite) {
            upsertSiteConfig(newSite);
        } else if (oldSite) {
            removeSiteConfig(String(oldSite.id));
        }

        await alarmService.updateAlarmForSite(oldSite, newSite);
    }
}

browser.storage.onChanged.addListener((changes: { [key: string]: { oldValue?: unknown; newValue?: unknown } }, areaName: string) => {
    handleStorageChange(changes, areaName).catch((error) => {
        console.error("Failed to handle storage change:", error);
    });
});

// Initialize
console.log("Message listener registered");
(async () => {
    try {
        await loadConfig();
        console.log("Background script initialized successfully");
    } catch (error) {
        console.error("Failed to initialize background script:", error);
    }
})();
})();
