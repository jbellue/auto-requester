import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ACTIONS, SITE_IDS_KEY, getSiteKey } from "../src/shared";
import { getAlarmName } from "../src/utils/alarm";
import { createSite, createStorageMock, type StorageFixture, type StorageState } from "./test-utils";

type BrowserListeners = {
    onAlarm?: (alarm: { name: string }) => void;
    onMessage?: (message: { action: string; siteId?: string }, sender: unknown, sendResponse: (response?: any) => void) => boolean;
    onChanged?: (changes: { [key: string]: { oldValue?: unknown; newValue?: unknown } }, areaName: string) => void;
};

type SelfListeners = {
    error?: (event: { error: unknown; preventDefault: () => void }) => void;
    unhandledrejection?: (event: { reason: unknown; preventDefault: () => void }) => void;
};

const originalGlobals = {
    browser: (globalThis as any).browser,
    self: (globalThis as any).self,
    importScripts: (globalThis as any).importScripts,
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
};


function createBrowserMock(storageState: StorageState): {
    browser: any;
    listeners: BrowserListeners;
    storageFixture: StorageFixture;
} {
    const listeners: BrowserListeners = {};
    const storageFixture = createStorageMock(storageState);

    const alarms = {
        getAll: vi.fn().mockResolvedValue([]),
        clear: vi.fn().mockResolvedValue(true),
        create: vi.fn().mockResolvedValue(undefined),
        onAlarm: {
            addListener: vi.fn((callback: (alarm: { name: string }) => void) => {
                listeners.onAlarm = callback;
            }),
        },
    };

    const runtime = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: {
            addListener: vi.fn((callback: BrowserListeners["onMessage"]) => {
                if (callback) {
                    listeners.onMessage = callback;
                }
            }),
        },
    };

    const storage = {
        sync: storageFixture.storage,
        onChanged: {
            addListener: vi.fn((callback: BrowserListeners["onChanged"]) => {
                if (callback) {
                    listeners.onChanged = callback;
                }
            }),
        },
    };

    const tabs = {
        query: vi.fn().mockResolvedValue([]),
    };

    return {
        browser: {
            alarms,
            runtime,
            storage,
            tabs,
        },
        listeners,
        storageFixture,
    };
}

async function flushPromises(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setupBackground(
    storageState: StorageState,
    options: { withImportScripts?: boolean } = {}
): Promise<{
    browser: any;
    listeners: BrowserListeners;
    storageFixture: StorageFixture;
    selfListeners: SelfListeners;
}> {
    const { browser, listeners, storageFixture } = createBrowserMock(storageState);
    const { withImportScripts = true } = options;
    const selfListeners: SelfListeners = {};

    (globalThis as any).browser = browser;
    (globalThis as any).self = {
        addEventListener: vi.fn((event: string, handler: any) => {
            if (event === "error") {
                selfListeners.error = handler;
            }
            if (event === "unhandledrejection") {
                selfListeners.unhandledrejection = handler;
            }
        }),
    };
    if (withImportScripts) {
        (globalThis as any).importScripts = vi.fn();
    } else {
        delete (globalThis as any).importScripts;
    }

    await import("../src/background");
    await flushPromises();

    return { browser, listeners, storageFixture, selfListeners };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

afterEach(() => {
    if (originalGlobals.browser === undefined) {
        delete (globalThis as any).browser;
    } else {
        (globalThis as any).browser = originalGlobals.browser;
    }

    if (originalGlobals.self === undefined) {
        delete (globalThis as any).self;
    } else {
        (globalThis as any).self = originalGlobals.self;
    }

    if (originalGlobals.importScripts === undefined) {
        delete (globalThis as any).importScripts;
    } else {
        (globalThis as any).importScripts = originalGlobals.importScripts;
    }

    if (originalGlobals.fetch === undefined) {
        delete (globalThis as any).fetch;
    } else {
        globalThis.fetch = originalGlobals.fetch;
    }

    if (originalGlobals.AbortController === undefined) {
        delete (globalThis as any).AbortController;
    } else {
        globalThis.AbortController = originalGlobals.AbortController;
    }
});

describe("background script", () => {
    it("sets up alarms for enabled sites on init", async () => {
        const enabledSite = createSite("enabled", { checkInterval: 12, enabled: true });
        const disabledSite = createSite("disabled", { enabled: false });
        const { browser } = await setupBackground({
            [SITE_IDS_KEY]: [enabledSite.id, disabledSite.id],
            [getSiteKey(enabledSite.id)]: enabledSite,
            [getSiteKey(disabledSite.id)]: disabledSite,
        });

        expect(browser.alarms.getAll).toHaveBeenCalledTimes(1);
        expect(browser.alarms.create).toHaveBeenCalledTimes(1);
        expect(browser.alarms.create).toHaveBeenCalledWith(getAlarmName(enabledSite.id), {
            periodInMinutes: 12,
        });
    });

    it("handles global error events", async () => {
        const { selfListeners } = await setupBackground({});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const errorEvent = { error: new Error("Boom"), preventDefault: vi.fn() };
        const rejectionEvent = { reason: "Oops", preventDefault: vi.fn() };

        selfListeners.error?.(errorEvent);
        selfListeners.unhandledrejection?.(rejectionEvent);

        expect(errorEvent.preventDefault).toHaveBeenCalled();
        expect(rejectionEvent.preventDefault).toHaveBeenCalled();

        expect(errorSpy).toHaveBeenCalledWith("Global error in background script:", errorEvent.error);
        expect(errorSpy).toHaveBeenCalledWith("Unhandled promise rejection in background script:", rejectionEvent.reason);

        errorSpy.mockRestore();
    });

    it("skips importScripts when not available", async () => {
        const { browser } = await setupBackground({}, { withImportScripts: false });

        expect(browser.alarms.getAll).toHaveBeenCalledTimes(1);
    });

    it("handles enableSite messages", async () => {
        const site = createSite("site-1", { enabled: false, checkInterval: 7 });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.enableSite, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(browser.alarms.create).toHaveBeenCalledWith(getAlarmName(site.id), {
            periodInMinutes: 7,
        });
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("adds site to cache when enabling without cached entry", async () => {
        const site = createSite("site-cache-miss", { enabled: false, checkInterval: 6 });
        const { browser, listeners } = await setupBackground({
            [getSiteKey(site.id)]: site,
        });

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.enableSite, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(browser.alarms.create).toHaveBeenCalledWith(getAlarmName(site.id), {
            periodInMinutes: 6,
        });
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("handles disableSite messages", async () => {
        const site = createSite("site-2", { enabled: false });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.disableSite, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledWith(getAlarmName(site.id));
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("handles alarm trigger and updates last run", async () => {
        const site = createSite("site-3", { enabled: true, checkInterval: 5 });
        const expectedSite = { ...site, lastRun: 1234 };
        const { browser, listeners, storageFixture } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

        await import("../src/background");
        await flushPromises();

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.siteRun,
            siteId: site.id,
            lastRun: 1234,
        });
        expect(storageFixture.setCalls).toContainEqual({
            [getSiteKey(site.id)]: expectedSite,
        });

        nowSpy.mockRestore();
    });

    it("handles successful requests with no response body", async () => {
        const site = createSite("site-empty", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 204,
            statusText: "No Content",
            text: vi.fn().mockResolvedValue(undefined),
        } as any);

        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("includes request body for POST requests", async () => {
        const site = createSite("site-post", { method: "POST", body: "payload" });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: vi.fn().mockResolvedValue("ok"),
        } as any);
        globalThis.fetch = fetchSpy;
        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(fetchSpy).toHaveBeenCalledWith(site.endpoint, expect.objectContaining({
            body: "payload",
        }));
    });

    it("logs when sendRequestForSite fails unexpectedly", async () => {
        const site = createSite("site-err", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        globalThis.AbortController = class {
            constructor() {
                throw new Error("Abort constructor failed");
            }
        } as any;

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("✗ Error sending request:", expect.any(Error));

        errorSpy.mockRestore();
    });

    it("skips requests when no tabs match", async () => {
        const site = createSite("site-4", { urlPattern: "*://example.com/*" });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn();
        browser.tabs.query.mockResolvedValue([{ url: "https://other.com" }]);

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("ignores alarms that do not match our prefix", async () => {
        const { browser, listeners } = await setupBackground({});

        listeners.onAlarm?.({ name: "unrelated-alarm" });
        await flushPromises();

        expect(browser.tabs.query).not.toHaveBeenCalled();
    });

    it("skips alarms for sites that are not cached", async () => {
        const { browser, listeners } = await setupBackground({});

        globalThis.fetch = vi.fn();
        listeners.onAlarm?.({ name: getAlarmName("missing") });
        await flushPromises();

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("skips requests when tabs query fails", async () => {
        const site = createSite("site-5");
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn();
        browser.tabs.query.mockRejectedValue(new Error("Query failed"));

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("logs unexpected errors when notifying popup", async () => {
        const site = createSite("site-notify", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        browser.runtime.sendMessage.mockRejectedValue(new Error("Different error"));
        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("Unexpected error notifying popup:", expect.any(Error));

        errorSpy.mockRestore();
    });

    it("does not log when popup is not listening", async () => {
        const site = createSite("site-notify-missing", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        browser.runtime.sendMessage.mockRejectedValue(new Error("Receiving end does not exist"));
        browser.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(errorSpy).not.toHaveBeenCalledWith(
            "Unexpected error notifying popup:",
            expect.any(Error)
        );

        errorSpy.mockRestore();
    });

    it("handles enableSite when site is missing", async () => {
        const { listeners } = await setupBackground({});
        const sendResponse = vi.fn();

        listeners.onMessage?.({ action: ACTIONS.enableSite, siteId: "missing" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "Site not found" });
    });

    it("handles unknown messages", async () => {
        const { listeners } = await setupBackground({});
        const sendResponse = vi.fn();

        listeners.onMessage?.({ action: "unknown" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "Unknown action" });
    });

    it("returns not found for testRequest when site is missing", async () => {
        const { listeners } = await setupBackground({});
        const sendResponse = vi.fn();

        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: "missing" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "Site not found" });
    });

    it("returns error details when testRequest response is not ok", async () => {
        const site = createSite("site-6", { method: "POST" });
        const { listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Server Error",
            text: vi.fn().mockResolvedValue("fail"),
        } as any);

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            status: 500,
            body: "fail",
            error: "HTTP error: 500 Server Error",
        });
    });

    it("returns error details when testRequest throws", async () => {
        const site = createSite("site-7");
        const { listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            status: 0,
            body: "",
            error: "Network down",
        });
    });

    it("returns timeout details when testRequest aborts", async () => {
        const site = createSite("site-8");
        const { listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const abortError = new Error("aborted");
        abortError.name = "AbortError";
        globalThis.fetch = vi.fn().mockRejectedValue(abortError);

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            status: 0,
            body: "",
            error: "Request timeout after 30s",
        });
    });

    it("aborts requests after the timeout elapses", async () => {
        try {
            const site = createSite("site-timeout");
            const { listeners } = await setupBackground({
                [SITE_IDS_KEY]: [site.id],
                [getSiteKey(site.id)]: site,
            });

            vi.useFakeTimers();

            globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
                const signal = (options as RequestInit).signal as AbortSignal | undefined;
                return new Promise((_resolve, reject) => {
                    if (signal) {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    }
                });
            });

            const sendResponse = vi.fn();
            listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);

            await vi.runAllTimersAsync();
            for (let i = 0; i < 5; i += 1) {
                await Promise.resolve();
            }

            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                status: 0,
                body: "",
                error: "Request timeout after 30s",
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("returns unknown error details when testRequest throws non-errors", async () => {
        const site = createSite("site-unknown");
        const { listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn().mockRejectedValue("Boom");

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            status: 0,
            body: "",
            error: "Unknown error occurred",
        });
    });

    it("handles testRequest exceptions", async () => {
        const site = createSite("site-9");
        const { listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.AbortController = class {
            constructor() {
                throw new Error("Abort constructor failed");
            }
        } as any;

        const sendResponse = vi.fn();
        listeners.onMessage?.({ action: ACTIONS.testRequest, siteId: site.id }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            status: 0,
            body: "",
            error: "Error: Abort constructor failed",
        });
    });

    it("handles errors in message processing", async () => {
        const { browser, listeners } = await setupBackground({});
        const sendResponse = vi.fn();

        browser.storage.sync.get = vi.fn().mockRejectedValue(new Error("Storage error"));

        listeners.onMessage?.({ action: ACTIONS.enableSite, siteId: "site-err" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: "Error: Storage error",
        });
    });

    it("ignores non-sync storage changes", async () => {
        const { listeners } = await setupBackground({});

        listeners.onChanged?.({ any: { oldValue: 1, newValue: 2 } }, "local");
        await flushPromises();
    });

    it("reloads when site ids change to invalid values", async () => {
        const { browser, listeners } = await setupBackground({});

        browser.alarms.getAll.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: "bad", newValue: "still-bad" },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.getAll).toHaveBeenCalledTimes(1);
    });

    it("clears alarms when removed ids are missing", async () => {
        const { browser, listeners } = await setupBackground({});

        browser.alarms.clear.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: ["ghost"], newValue: [] },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledWith(getAlarmName("ghost"));
    });

    it("skips removed ids when the entry is part of the change set", async () => {
        const site = createSite("site-skip");
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browser.alarms.clear.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [site.id], newValue: [] },
            [getSiteKey(site.id)]: { oldValue: site, newValue: undefined },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledTimes(1);
    });

    it("updates alarms when ids are removed", async () => {
        const site = createSite("site-9");
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browser.alarms.clear.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [site.id], newValue: [] },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledWith(getAlarmName(site.id));
    });

    it("creates alarms when ids are added", async () => {
        const site = createSite("site-10", { checkInterval: 9 });
        const { browser, listeners } = await setupBackground({
            [getSiteKey(site.id)]: site,
        });

        browser.alarms.create.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [], newValue: [site.id] },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.create).toHaveBeenCalledWith(getAlarmName(site.id), {
            periodInMinutes: 9,
        });
    });

    it("skips new ids when site data is missing", async () => {
        const { browser, listeners } = await setupBackground({});

        browser.alarms.create.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [], newValue: ["missing-site"] },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.create).not.toHaveBeenCalled();
    });

    it("skips added ids when the entry is part of the change set", async () => {
        const site = createSite("site-skip-add", { checkInterval: 4 });
        const { browser, listeners } = await setupBackground({
            [getSiteKey(site.id)]: site,
        });

        browser.alarms.create.mockClear();
        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [], newValue: [site.id] },
            [getSiteKey(site.id)]: { oldValue: undefined, newValue: site },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.create).toHaveBeenCalledTimes(1);
    });

    it("updates alarms when a site entry changes", async () => {
        const oldSite = createSite("site-11", { enabled: true });
        const newSite = createSite("site-11", { enabled: false });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [oldSite.id],
            [getSiteKey(oldSite.id)]: oldSite,
        });

        browser.alarms.clear.mockClear();
        listeners.onChanged?.({
            [getSiteKey(oldSite.id)]: { oldValue: oldSite, newValue: newSite },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledWith(getAlarmName(oldSite.id));
    });

    it("removes alarms when a site entry is deleted", async () => {
        const oldSite = createSite("site-12", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [oldSite.id],
            [getSiteKey(oldSite.id)]: oldSite,
        });

        browser.alarms.clear.mockClear();
        listeners.onChanged?.({
            [getSiteKey(oldSite.id)]: { oldValue: oldSite, newValue: undefined },
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).toHaveBeenCalledWith(getAlarmName(oldSite.id));
    });

    it("removes cached sites when entries are deleted", async () => {
        const site = createSite("site-remove", { enabled: true });
        const { browser, listeners } = await setupBackground({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        globalThis.fetch = vi.fn();
        browser.tabs.query.mockResolvedValue([]);
        browser.tabs.query.mockClear();

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(browser.tabs.query).toHaveBeenCalledTimes(1);
        browser.tabs.query.mockClear();

        listeners.onChanged?.({
            [getSiteKey(site.id)]: { oldValue: site, newValue: undefined },
        }, "sync");
        await flushPromises();

        listeners.onAlarm?.({ name: getAlarmName(site.id) });
        await flushPromises();

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("ignores site change entries without old or new values", async () => {
        const { browser, listeners } = await setupBackground({});

        browser.alarms.clear.mockClear();
        browser.alarms.create.mockClear();

        listeners.onChanged?.({
            [getSiteKey("empty")]: {},
        }, "sync");
        await flushPromises();

        expect(browser.alarms.clear).not.toHaveBeenCalled();
        expect(browser.alarms.create).not.toHaveBeenCalled();
    });

    it("logs errors when storage change handling fails", async () => {
        const { browser, listeners } = await setupBackground({});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        browser.storage.sync.get = vi.fn().mockRejectedValue(new Error("Storage unavailable"));

        listeners.onChanged?.({
            [SITE_IDS_KEY]: { oldValue: [], newValue: ["site-bad"] },
        }, "sync");
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith(
            "Failed to handle storage change:",
            expect.any(Error)
        );

        errorSpy.mockRestore();
    });

    it("logs initialization errors when loadConfig fails", async () => {
        const { browser } = createBrowserMock({});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        browser.storage.sync.get = vi.fn().mockRejectedValue(new Error("Storage unavailable"));

        (globalThis as any).browser = browser;
        (globalThis as any).self = { addEventListener: vi.fn() };
        (globalThis as any).importScripts = vi.fn();

        await import("../src/background");
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith(
            "Failed to initialize background script:",
            expect.any(Error)
        );

        errorSpy.mockRestore();
    });
});
