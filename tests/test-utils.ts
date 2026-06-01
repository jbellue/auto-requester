import type { SiteConfig } from "../src/types";

export type StorageState = Record<string, unknown>;

export type StorageFixture = {
    storage: {
        get: (keys: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
    };
    setCalls: StorageState[];
    removeCalls: Array<string | string[]>;
};

export function createSite(id: string, overrides: Partial<SiteConfig> = {}): SiteConfig {
    return {
        id,
        urlPattern: "*://example.com/*",
        endpoint: "https://example.com/api/keep-alive",
        method: "GET",
        headers: "",
        body: "",
        checkInterval: 5,
        enabled: true,
        ...overrides,
    };
}

export function createStorageMock(initial: StorageState): StorageFixture {
    const state: StorageState = { ...initial };
    const setCalls: StorageState[] = [];
    const removeCalls: Array<string | string[]> = [];

    const storage = {
        get: async (keys: string | string[] | Record<string, unknown> | null) => {
            if (keys === null) {
                return { ...state };
            }
            if (typeof keys === "string") {
                return { [keys]: state[keys] };
            }
            if (Array.isArray(keys)) {
                const result: StorageState = {};
                for (const key of keys) {
                    result[key] = state[key];
                }
                return result;
            }
            const result: StorageState = {};
            for (const key of Object.keys(keys)) {
                result[key] = state[key];
            }
            return result;
        },
        set: async (items: Record<string, unknown>) => {
            setCalls.push(items);
            Object.assign(state, items);
        },
        remove: async (keys: string | string[]) => {
            removeCalls.push(keys);
            const keysArray = typeof keys === "string" ? [keys] : keys;
            for (const key of keysArray) {
                delete state[key];
            }
        },
    };

    return { storage, setCalls, removeCalls };
}
