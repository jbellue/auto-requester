// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIONS, SITE_IDS_KEY, getSiteKey } from "../src/shared";
import type { SiteConfig } from "../src/types";
import { createSite, createStorageMock, type StorageState } from "./test-utils";

type RuntimeListeners = {
    onMessage?: (message: { action: string; siteId?: string; lastRun?: number }) => void;
};

type PopupSetupOptions = {
    sendMessageResult?: unknown;
    sendMessageError?: Error;
    tabsQueryResult?: Array<{ url?: string }>;
    tabsQueryError?: Error;
    storageGetImpl?: (keys: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
    storageSetImpl?: (items: Record<string, unknown>) => Promise<void>;
};


function setupDom(): void {
    document.documentElement.className = "";
    document.body.className = "";
    document.body.style.height = "";
    document.body.innerHTML = `
        <div id="status"></div>
        <div id="globalIndicator"></div>
        <div id="globalStatusText"></div>
        <div id="sitesContainer"></div>
        <button id="addSite"></button>
        <dialog id="newSiteModal"><div id="newSiteForm"></div><button id="closeNewSite"></button></dialog>
        <dialog id="testModal"></dialog>
        <dialog id="confirmModal">
            <h2 id="confirmTitle"></h2>
            <div id="confirmMessage"></div>
            <button id="confirmOk"></button>
            <button id="confirmCancel"></button>
            <span id="closeConfirm"></span>
        </dialog>
    `;

    const dialogs = document.querySelectorAll("dialog");
    dialogs.forEach((dialog) => {
        (dialog as any).showModal = vi.fn();
        (dialog as any).close = vi.fn();
    });
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
}

async function withCryptoOverride<T>(value: Crypto | undefined, callback: () => Promise<T>): Promise<T> {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
        value,
        configurable: true,
    });

    try {
        return await callback();
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "crypto", descriptor);
        } else {
            delete (globalThis as any).crypto;
        }
    }
}


function getNewSiteFormFields(): {
    form: HTMLFormElement;
    urlInput: HTMLInputElement;
    endpointInput: HTMLInputElement;
    methodSelect: HTMLSelectElement;
    intervalInput: HTMLInputElement;
    headersInput: HTMLTextAreaElement;
    bodyInput: HTMLTextAreaElement;
    enabledInput: HTMLInputElement;
} {
    const form = document.querySelector("#newSiteForm form") as HTMLFormElement;
    const urlInput = form.querySelector('input[id^="urlPattern-"]') as HTMLInputElement;
    const endpointInput = form.querySelector('input[id^="endpoint-"]') as HTMLInputElement;
    const methodSelect = form.querySelector('select[id^="method-"]') as HTMLSelectElement;
    const intervalInput = form.querySelector('input[id^="interval-"]') as HTMLInputElement;
    const headersInput = form.querySelector('textarea[id^="headers-"]') as HTMLTextAreaElement;
    const bodyInput = form.querySelector('textarea[id^="body-"]') as HTMLTextAreaElement;
    const enabledInput = form.querySelector('input[id^="enabled-"]') as HTMLInputElement;

    return { form, urlInput, endpointInput, methodSelect, intervalInput, headersInput, bodyInput, enabledInput };
}

async function setupPopup(storageState: StorageState, options: PopupSetupOptions = {}) {
    vi.resetModules();
    setupDom();

    const runtimeListeners: RuntimeListeners = {};
    const storageFixture = createStorageMock(storageState);

    if (options.storageGetImpl) {
        storageFixture.storage.get = options.storageGetImpl;
    }
    if (options.storageSetImpl) {
        storageFixture.storage.set = options.storageSetImpl;
    }

    const sendMessage = vi.fn();
    if (options.sendMessageError) {
        sendMessage.mockRejectedValue(options.sendMessageError);
    } else if (Object.prototype.hasOwnProperty.call(options, "sendMessageResult")) {
        sendMessage.mockResolvedValue(options.sendMessageResult);
    } else {
        sendMessage.mockResolvedValue(undefined);
    }

    const tabsQuery = vi.fn();
    if (options.tabsQueryError) {
        tabsQuery.mockRejectedValue(options.tabsQueryError);
    } else if (options.tabsQueryResult) {
        tabsQuery.mockResolvedValue(options.tabsQueryResult);
    } else {
        tabsQuery.mockResolvedValue([]);
    }

    const browserMock = {
        storage: {
            sync: storageFixture.storage,
        },
        runtime: {
            sendMessage,
            onMessage: {
                addListener: vi.fn((callback: RuntimeListeners["onMessage"]) => {
                    if (callback) {
                        runtimeListeners.onMessage = callback;
                    }
                }),
            },
        },
        tabs: {
            query: tabsQuery,
        },
    };

    vi.doMock("webextension-polyfill", () => ({
        __esModule: true,
        default: browserMock,
    }));

    await import("../src/popup");
    await flushPromises();

    return { browserMock, storageFixture, runtimeListeners };
}

describe("popup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders an empty state when there are no sites", async () => {
        await setupPopup({});

        const container = document.getElementById("sitesContainer");
        expect(container?.textContent).toContain("No sites configured yet");
    });

    it("returns early when status element is missing", async () => {
        await setupPopup({});
        document.getElementById("status")?.remove();

        const errorEvent = new Event("error") as any;
        errorEvent.error = new Error("Boom");
        errorEvent.preventDefault = vi.fn();
        window.dispatchEvent(errorEvent);

        expect(document.getElementById("status")).toBeNull();
        expect(errorEvent.preventDefault).toHaveBeenCalled();
    });

    it("renders site cards and global status", async () => {
        const site = createSite("site-1");
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const card = document.querySelector(".site-config");
        const url = document.querySelector(".site-url");
        const statusText = document.getElementById("globalStatusText");

        expect(card).not.toBeNull();
        expect(url?.textContent).toBe(site.urlPattern);
        expect(statusText?.textContent).toBe("1 active site");
    });

    it("renders a fallback URL when missing", async () => {
        const site = createSite("site-no-url", { urlPattern: "" });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const url = document.querySelector(".site-url");
        expect(url?.textContent).toBe("No URL pattern set");
    });

    it("pluralizes global status for multiple active sites", async () => {
        const siteA = createSite("site-a");
        const siteB = createSite("site-b");
        await setupPopup({
            [SITE_IDS_KEY]: [siteA.id, siteB.id],
            [getSiteKey(siteA.id)]: siteA,
            [getSiteKey(siteB.id)]: siteB,
        });

        const statusText = document.getElementById("globalStatusText");
        expect(statusText?.textContent).toBe("2 active sites");
    });

    it("renders inactive sites with disabled styling", async () => {
        const site = createSite("site-disabled", { enabled: false });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const card = document.querySelector(".site-config") as HTMLElement;
        const statusBadge = document.querySelector(".site-status") as HTMLElement;
        const enabledInput = document.getElementById(`enabled-${site.id}`) as HTMLInputElement;

        expect(card.classList.contains("disabled")).toBe(true);
        expect(statusBadge?.textContent).toBe("Inactive");
        expect(statusBadge?.classList.contains("inactive")).toBe(true);
        expect(enabledInput.checked).toBe(false);
    });

    it("returns early when global status elements are missing", async () => {
        const site = createSite("site-missing-status", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        document.getElementById("globalIndicator")?.remove();
        document.getElementById("globalStatusText")?.remove();

        const checkbox = document.getElementById(`enabled-${site.id}`) as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(document.getElementById("globalStatusText")).toBeNull();
    });

    it("uses crypto.randomUUID when available", async () => {
        const uuid = "uuid-string" as const;
        const randomUUID = vi.fn(() => uuid);
        const fakeCrypto: Crypto = {
            randomUUID: randomUUID as unknown as Crypto["randomUUID"],
            getRandomValues: <T extends ArrayBufferView>(array: T): T => array,
            subtle: {} as SubtleCrypto,
        };

        await withCryptoOverride(fakeCrypto, async () => {
            const { browserMock } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([]);

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            const fields = getNewSiteFormFields();
            expect(fields.urlInput.id).toBe(`urlPattern-${uuid}`);
            expect(randomUUID).toHaveBeenCalled();
        });
    });

    it("updates header when URL input changes", async () => {
        const site = createSite("site-url", { urlPattern: "*://example.com/*" });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const urlInput = document.getElementById(`urlPattern-${site.id}`) as HTMLInputElement;
        urlInput.value = "https://newsite.dev/path";
        urlInput.dispatchEvent(new Event("input"));

        const avatar = document.querySelector(".site-avatar");
        const urlSpan = document.querySelector(".site-url");

        expect(avatar?.textContent).toBe("N");
        expect(urlSpan?.textContent).toBe("https://newsite.dev/path");
    });

    it("shows fallback text when the URL pattern is cleared", async () => {
        const site = createSite("site-empty-url", { urlPattern: "*://example.com/*" });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const urlInput = document.getElementById(`urlPattern-${site.id}`) as HTMLInputElement;
        urlInput.value = "";
        urlInput.dispatchEvent(new Event("input"));

        const urlSpan = document.querySelector(".site-url");
        expect(urlSpan?.textContent).toBe("No URL pattern set");
    });

    it("handles missing header elements when URL input changes", async () => {
        const site = createSite("site-missing-header", { urlPattern: "*://example.com/*" });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        document.querySelector(".site-avatar")?.remove();
        document.querySelector(".site-url")?.remove();

        const urlInput = document.getElementById(`urlPattern-${site.id}`) as HTMLInputElement;
        urlInput.value = "https://newsite.dev/path";
        urlInput.dispatchEvent(new Event("input"));

        expect(document.querySelector(".site-avatar")).toBeNull();
        expect(document.querySelector(".site-url")).toBeNull();
    });

    it("skips URL input handling when the input is missing", async () => {
        const site = createSite("site-missing-url-input", { urlPattern: "*://example.com/*" });
        const originalQuerySelector = Element.prototype.querySelector;
        const querySpy = vi.spyOn(Element.prototype, "querySelector").mockImplementation(function (this: Element, selector: string) {
            if (selector === `#urlPattern-${site.id}` && this.tagName === "FORM") {
                return null;
            }
            return originalQuerySelector.call(this, selector);
        });

        try {
            await setupPopup({
                [SITE_IDS_KEY]: [site.id],
                [getSiteKey(site.id)]: site,
            });

            const avatar = document.querySelector(".site-avatar");
            const urlSpan = document.querySelector(".site-url");
            const previousAvatar = avatar?.textContent ?? "";
            const previousUrl = urlSpan?.textContent ?? "";

            const urlInput = document.getElementById(`urlPattern-${site.id}`) as HTMLInputElement;
            urlInput.value = "https://newsite.dev/path";
            urlInput.dispatchEvent(new Event("input"));

            expect(avatar?.textContent).toBe(previousAvatar);
            expect(urlSpan?.textContent).toBe(previousUrl);
        } finally {
            querySpy.mockRestore();
        }
    });

    it("toggles card and updates body height on header click", async () => {
        vi.useFakeTimers();
        try {
            const site = createSite("site-toggle", { enabled: true });
            await setupPopup({
                [SITE_IDS_KEY]: [site.id],
                [getSiteKey(site.id)]: site,
            });

            document.body.classList.remove("modal-open");
            document.documentElement.classList.remove("modal-open");

            const card = document.querySelector(".site-config") as HTMLElement;
            const header = document.querySelector(".site-header") as HTMLElement;

            expect(card.classList.contains("collapsed")).toBe(true);

            header.click();
            await vi.runAllTimersAsync();

            expect(card.classList.contains("collapsed")).toBe(false);
            expect(document.body.style.height).toBe("auto");
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not adjust body height when modal is open", async () => {
        vi.useFakeTimers();
        try {
            const site = createSite("site-toggle-modal", { enabled: true });
            await setupPopup({
                [SITE_IDS_KEY]: [site.id],
                [getSiteKey(site.id)]: site,
            });

            document.body.classList.add("modal-open");
            document.documentElement.classList.add("modal-open");
            document.body.style.height = "123px";

            const header = document.querySelector(".site-header") as HTMLElement;
            header.click();
            await vi.runAllTimersAsync();

            expect(document.body.style.height).toBe("123px");
        } finally {
            vi.useRealTimers();
        }
    });

    it("toggles collapsible sections", async () => {
        const site = createSite("site-collapse", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const section = document.querySelector(".collapsible-section") as HTMLElement;
        const header = section.querySelector(".collapsible-section-header") as HTMLElement;

        expect(section.classList.contains("collapsed")).toBe(true);
        header.click();
        expect(section.classList.contains("collapsed")).toBe(false);
    });

    it("toggles enabled state and updates status", async () => {
        const site = createSite("site-2", { enabled: true });
        const { browserMock, storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const checkbox = document.getElementById(`enabled-${site.id}`) as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.disableSite,
            siteId: site.id,
        });
        expect(storageFixture.setCalls.length).toBeGreaterThan(0);

        const statusText = document.getElementById("globalStatusText");
        expect(statusText?.textContent).toBe("No active sites");
    });

    it("auto-saves changes for existing sites", async () => {
        const site = createSite("site-save", { enabled: true });
        const { browserMock, storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const endpointInput = document.getElementById(`endpoint-${site.id}`) as HTMLInputElement;
        endpointInput.value = "https://example.com/changed";
        endpointInput.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(storageFixture.setCalls.length).toBeGreaterThan(0);
        expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.enableSite,
            siteId: site.id,
        });
    });

    it("does not auto-save changes for new sites", async () => {
        const { browserMock, storageFixture } = await setupPopup({});
        browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const fields = getNewSiteFormFields();
        fields.endpointInput.value = "https://example.com/changed";
        fields.endpointInput.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(storageFixture.setCalls.length).toBe(0);
    });

    it("updates the header when URL is cleared on save", async () => {
        const site = createSite("site-update-url", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const urlInput = document.getElementById(`urlPattern-${site.id}`) as HTMLInputElement;
        urlInput.value = "";
        urlInput.dispatchEvent(new Event("change"));
        await flushPromises();

        const urlSpan = document.querySelector(".site-url");
        expect(urlSpan?.textContent).toBe("No URL pattern set");
    });

    it("skips updating the header when the card is missing", async () => {
        const site = createSite("site-no-card", { enabled: true });
        const { storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const endpointInput = document.getElementById(`endpoint-${site.id}`) as HTMLInputElement;
        const card = document.querySelector(".site-config");
        card?.remove();

        endpointInput.value = "https://example.com/changed";
        endpointInput.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(storageFixture.setCalls.length).toBeGreaterThan(0);
    });

    it("handles missing header elements when saving", async () => {
        const site = createSite("site-missing-elements", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const card = document.querySelector(".site-config") as HTMLElement;
        card.querySelector(".site-avatar")?.remove();
        card.querySelector(".site-url")?.remove();
        card.querySelector(".site-status")?.remove();

        const checkbox = document.getElementById(`enabled-${site.id}`) as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(card.classList.contains("disabled")).toBe(true);
    });

    it("skips auto-save when the site no longer exists", async () => {
        const site = createSite("site-missing");
        const { storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const endpointInput = document.getElementById(`endpoint-${site.id}`) as HTMLInputElement;
        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;

        removeButton.click();
        await flushPromises();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        const setCallsAfterRemoval = storageFixture.setCalls.length;

        endpointInput.value = "https://example.com/late";
        endpointInput.dispatchEvent(new Event("change"));
        await flushPromises();

        expect(storageFixture.setCalls.length).toBe(setCallsAfterRemoval);
    });

    it("shows test results when clicking the test button", async () => {
        const site = createSite("site-3", { enabled: true });
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        }, {
            sendMessageResult: { success: true, status: 200, body: "ok" },
        });

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(testModal as any, "showModal");

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.click();
        await flushPromises();

        expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.testRequest,
            siteId: site.id,
        });
        expect(showModalSpy).toHaveBeenCalled();
        expect(testButton.disabled).toBe(false);
    });

    it("closes the test modal via the close button", async () => {
        const site = createSite("site-close-modal", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        }, {
            sendMessageResult: { success: true, status: 200, body: "ok" },
        });

        const testModal = document.getElementById("testModal") as HTMLDialogElement;

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.click();
        await flushPromises();

        const closeButton = document.getElementById("closeModal") as HTMLElement;
        closeButton.click();

        expect((testModal as any).close).toHaveBeenCalled();
    });

    it("returns early when the test modal is missing", async () => {
        const site = createSite("site-no-modal", { enabled: true });
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        }, {
            sendMessageResult: { success: true, status: 200, body: "ok" },
        });

        document.getElementById("testModal")?.remove();

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.click();
        await flushPromises();

        expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.testRequest,
            siteId: site.id,
        });
        expect(testButton.disabled).toBe(false);
    });

    it("handles test requests when the button is missing", async () => {
        const site = createSite("site-no-button", { enabled: true });
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        }, {
            sendMessageResult: { success: true, status: 200, body: "ok" },
        });

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(testModal as any, "showModal");

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.remove();
        testButton.click();
        await flushPromises();

        expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
            action: ACTIONS.testRequest,
            siteId: site.id,
        });
        expect(showModalSpy).toHaveBeenCalled();
    });

    it("truncates long response bodies", async () => {
        const site = createSite("site-long", { enabled: true });
        const longBody = "x".repeat(600);
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        }, {
            sendMessageResult: { success: true, status: 200, body: longBody },
        });

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(testModal as any, "showModal");

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.click();
        await flushPromises();

        expect(showModalSpy).toHaveBeenCalled();
        expect(testModal.innerHTML).toContain("...");
    });

    it("shows an error modal when test request fails", async () => {
        const site = createSite("site-test-error", { enabled: true });
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browserMock.runtime.sendMessage.mockRejectedValue(new Error("Network down"));

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(testModal as any, "showModal");

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        testButton.click();
        await flushPromises();

        expect(showModalSpy).toHaveBeenCalled();
        expect(testButton.disabled).toBe(false);
    });

    it("removes a site after confirming", async () => {
        const site = createSite("site-4", { enabled: true });
        const { storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const confirmModal = document.getElementById("confirmModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(confirmModal as any, "showModal");

        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
        removeButton.click();
        await flushPromises();

        expect(showModalSpy).toHaveBeenCalled();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        expect(storageFixture.removeCalls).toContain(getSiteKey(site.id));
        const container = document.getElementById("sitesContainer");
        expect(container?.textContent).toContain("No sites configured yet");
    });

    it("closes the confirm modal via cancel and close buttons", async () => {
        const site = createSite("site-confirm-close", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const confirmModal = document.getElementById("confirmModal") as HTMLDialogElement;
        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;

        removeButton.click();
        await flushPromises();

        const cancelButton = document.getElementById("confirmCancel") as HTMLButtonElement;
        cancelButton.click();

        expect((confirmModal as any).close).toHaveBeenCalledTimes(1);

        removeButton.click();
        await flushPromises();

        const closeButton = document.getElementById("closeConfirm") as HTMLElement;
        closeButton.click();

        expect((confirmModal as any).close).toHaveBeenCalledTimes(2);
    });

    it("returns early when the container is missing during render", async () => {
        const site = createSite("site-missing-container", { enabled: true });
        await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const container = document.getElementById("sitesContainer") as HTMLElement;
        container.id = "sitesContainer-removed";

        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
        removeButton.click();
        await flushPromises();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        expect(document.getElementById("sitesContainer")).toBeNull();
    });

    it("returns early when confirm modal elements are missing", async () => {
        const site = createSite("site-no-confirm", { enabled: true });
        const { storageFixture } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const confirmModal = document.getElementById("confirmModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(confirmModal as any, "showModal");

        document.getElementById("confirmOk")?.remove();

        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
        removeButton.click();
        await flushPromises();

        expect(showModalSpy).not.toHaveBeenCalled();
        expect(storageFixture.removeCalls.length).toBe(0);
    });

    it("does not remove when the site matches the new-site id", async () => {
        const uuid = "00000000-0000-4000-8000-000000000000" as const;
        const site = createSite(uuid);
        const cryptoObj = globalThis.crypto as Crypto | undefined;
        const randomUUIDSpy = cryptoObj?.randomUUID
            ? vi.spyOn(cryptoObj, "randomUUID").mockReturnValue(uuid)
            : undefined;

        const getRandomValuesSpy = !randomUUIDSpy && cryptoObj?.getRandomValues
            ? vi.spyOn(cryptoObj, "getRandomValues").mockImplementation((arr) => {
                const bytes = arr as Uint8Array;
                bytes.fill(0);
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                return arr;
            })
            : undefined;

        if (getRandomValuesSpy) {
            site.id = uuid;
        }

        try {
            const { storageFixture, browserMock } = await setupPopup({
                [SITE_IDS_KEY]: [site.id],
                [getSiteKey(site.id)]: site,
            });

            browserMock.tabs.query.mockResolvedValue([]);
            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
            removeButton.click();
            await flushPromises();

            const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
            confirmOk.click();
            await flushPromises();

            expect(storageFixture.removeCalls.length).toBe(0);
        } finally {
            randomUUIDSpy?.mockRestore();
            getRandomValuesSpy?.mockRestore();
        }
    });

    it("does not show empty state when a new site is being added", async () => {
        const site = createSite("site-existing");
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browserMock.tabs.query.mockResolvedValue([]);
        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
        removeButton.click();
        await flushPromises();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        const container = document.getElementById("sitesContainer");
        expect(container?.textContent).not.toContain("No sites configured yet");
    });

    it("skips showing the new site modal when elements are missing", async () => {
        const { browserMock } = await setupPopup({});
        browserMock.tabs.query.mockResolvedValue([]);

        document.getElementById("newSiteModal")?.remove();

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        expect(document.documentElement.classList.contains("modal-open")).toBe(false);
        expect(document.body.classList.contains("modal-open")).toBe(false);
    });

    it("skips inserting the form when it is missing", async () => {
        const { browserMock } = await setupPopup({});
        browserMock.tabs.query.mockResolvedValue([]);

        const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(modal as any, "showModal");
        const formContainer = document.getElementById("newSiteForm") as HTMLElement;
        const originalQuerySelector = HTMLElement.prototype.querySelector;
        const querySpy = vi.spyOn(HTMLElement.prototype, "querySelector").mockImplementation(function (this: HTMLElement, selector: string) {
            if (selector === "form" && this.classList.contains("site-config")) {
                return null;
            }
            return originalQuerySelector.call(this, selector);
        });

        try {
            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            expect(formContainer.innerHTML).toBe("");
            expect(showModalSpy).toHaveBeenCalled();
        } finally {
            querySpy.mockRestore();
        }
    });

    it("opens the new site modal with active tab info", async () => {
        const { browserMock } = await setupPopup({});
        browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/page" }]);

        const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
        const showModalSpy = vi.spyOn(modal as any, "showModal");

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const fields = getNewSiteFormFields();
        expect(showModalSpy).toHaveBeenCalled();
        expect(fields.urlInput.value).toBe("https://example.com/page");
        expect(fields.endpointInput.value).toBe("https://example.com/api/keep-alive");
    });

    it("keeps the default endpoint when tab URL is invalid", async () => {
        const { browserMock } = await setupPopup({});
        browserMock.tabs.query.mockResolvedValue([{ url: "invalid-url" }]);

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const fields = getNewSiteFormFields();
        expect(fields.endpointInput.value).toBe("https://example.com/api/refresh");
    });

    it("logs when active tab query fails", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const { browserMock } = await setupPopup({});
        browserMock.tabs.query.mockRejectedValue(new Error("Query failed"));

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("Could not query active tab:", expect.any(Error));
        errorSpy.mockRestore();
    });

    it("submits a new site form and stores the site", async () => {
        vi.useFakeTimers();
        try {
            const { browserMock, storageFixture } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            const fields = getNewSiteFormFields();
            fields.urlInput.value = "https://example.com/path";
            fields.endpointInput.value = "https://example.com/api/keep-alive";
            fields.methodSelect.value = "POST";
            fields.intervalInput.value = "10";
            fields.headersInput.value = "X-Test: 1";
            fields.bodyInput.value = "payload";
            fields.enabledInput.checked = true;

            fields.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.runAllTimersAsync();
            await flushPromises();

            const addedCall = storageFixture.setCalls.find((call) => call[SITE_IDS_KEY]);
            expect(addedCall).toBeTruthy();

            const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
            expect((modal as any).close).toHaveBeenCalled();
            expect((document.getElementById("newSiteForm") as HTMLElement).innerHTML).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    it("defaults method and interval when new site values are missing", async () => {
        vi.useFakeTimers();
        try {
            const { browserMock, storageFixture } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            const fields = getNewSiteFormFields();
            const siteId = fields.urlInput.id.replace("urlPattern-", "");

            fields.urlInput.value = "";
            fields.endpointInput.value = "";
            fields.methodSelect.value = "";
            fields.intervalInput.value = "";
            fields.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.runAllTimersAsync();
            await flushPromises();

            const savedCall = storageFixture.setCalls.find((call) => call[getSiteKey(siteId)]);
            const savedSite = savedCall?.[getSiteKey(siteId)] as SiteConfig | undefined;

            expect(savedSite?.urlPattern).toBe("");
            expect(savedSite?.endpoint).toBe("");
            expect(savedSite?.method).toBe("POST");
            expect(savedSite?.checkInterval).toBe(5);
        } finally {
            vi.useRealTimers();
        }
    });

    it("shows an error when creating a site fails", async () => {
        const error = new Error("Save failed");
        const { browserMock } = await setupPopup({}, {
            storageSetImpl: vi.fn().mockRejectedValue(error),
        });
        browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const fields = getNewSiteFormFields();
        fields.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(document.getElementById("status")?.textContent).toContain("Error creating site");
    });

    it("closes the new site modal on backdrop click", async () => {
        vi.useFakeTimers();
        try {
            const { browserMock } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

            const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
            vi.spyOn(modal, "getBoundingClientRect").mockReturnValue({
                top: 0,
                left: 0,
                width: 100,
                height: 100,
                right: 100,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => "",
            });

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            modal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 50 }));
            await vi.runAllTimersAsync();
            await flushPromises();

            expect((modal as any).close).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("closes the new site modal even when the form container is missing", async () => {
        vi.useFakeTimers();
        try {
            const { browserMock } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            document.getElementById("newSiteForm")?.remove();

            (document.getElementById("closeNewSite") as HTMLButtonElement).click();
            await vi.runAllTimersAsync();
            await flushPromises();

            expect(document.documentElement.classList.contains("modal-open")).toBe(false);
            expect(document.body.classList.contains("modal-open")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the new site modal open when clicking inside", async () => {
        vi.useFakeTimers();
        try {
            const { browserMock } = await setupPopup({});
            browserMock.tabs.query.mockResolvedValue([{ url: "https://example.com/path" }]);

            const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
            vi.spyOn(modal, "getBoundingClientRect").mockReturnValue({
                top: 0,
                left: 0,
                width: 100,
                height: 100,
                right: 100,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => "",
            });

            (document.getElementById("addSite") as HTMLButtonElement).click();
            await flushPromises();

            modal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }));
            await vi.runAllTimersAsync();
            await flushPromises();

            expect((modal as any).close).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("closes test and confirm modals on backdrop click", async () => {
        await setupPopup({});

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const confirmModal = document.getElementById("confirmModal") as HTMLDialogElement;

        vi.spyOn(testModal, "getBoundingClientRect").mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => "",
        });
        vi.spyOn(confirmModal, "getBoundingClientRect").mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => "",
        });

        testModal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 50 }));
        confirmModal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 50 }));

        expect((testModal as any).close).toHaveBeenCalled();
        expect((confirmModal as any).close).toHaveBeenCalled();
    });

    it("ignores clicks on non-dialog targets in the test modal", async () => {
        const handlers: Array<(event: any) => void> = [];
        const originalAdd = HTMLDialogElement.prototype.addEventListener;
        const addSpy = vi.spyOn(HTMLDialogElement.prototype, "addEventListener").mockImplementation(function (
            this: HTMLDialogElement,
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions
        ) {
            if (this.id === "testModal" && type === "click" && typeof listener === "function") {
                handlers.push(listener);
            }
            return originalAdd.call(this, type, listener, options);
        });

        await setupPopup({});
        addSpy.mockRestore();

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        expect(handlers.length).toBeGreaterThan(0);

        handlers[0].call(testModal, { target: { tagName: "DIV" } } as any);

        expect((testModal as any).close).not.toHaveBeenCalled();
    });

    it("handles inside clicks for test and confirm modals", async () => {
        await setupPopup({});

        const testModal = document.getElementById("testModal") as HTMLDialogElement;
        const confirmModal = document.getElementById("confirmModal") as HTMLDialogElement;

        const testRectSpy = vi.spyOn(testModal, "getBoundingClientRect").mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => "",
        });
        const confirmRectSpy = vi.spyOn(confirmModal, "getBoundingClientRect").mockReturnValue({
            top: 0,
            left: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => "",
        });

        const clientXDescriptor = Object.getOwnPropertyDescriptor(MouseEvent.prototype, "clientX");
        const clientYDescriptor = Object.getOwnPropertyDescriptor(MouseEvent.prototype, "clientY");

        Object.defineProperty(MouseEvent.prototype, "clientX", {
            configurable: true,
            get: () => 50,
        });
        Object.defineProperty(MouseEvent.prototype, "clientY", {
            configurable: true,
            get: () => 50,
        });

        try {
            testModal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            confirmModal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        } finally {
            if (clientXDescriptor) {
                Object.defineProperty(MouseEvent.prototype, "clientX", clientXDescriptor);
            } else {
                delete (MouseEvent.prototype as any).clientX;
            }

            if (clientYDescriptor) {
                Object.defineProperty(MouseEvent.prototype, "clientY", clientYDescriptor);
            } else {
                delete (MouseEvent.prototype as any).clientY;
            }
        }
        expect(testRectSpy).toHaveBeenCalled();
        expect(confirmRectSpy).toHaveBeenCalled();
    });

    it("updates last run when background sends a siteRun message", async () => {
        const site = createSite("site-5", { enabled: true, lastRun: 1000 });
        const { runtimeListeners } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const before = document.querySelector(".last-run")?.textContent || "";

        runtimeListeners.onMessage?.({
            action: ACTIONS.siteRun,
            siteId: site.id,
            lastRun: Date.now() - 60000,
        });
        await flushPromises();

        const after = document.querySelector(".last-run")?.textContent || "";
        expect(after).not.toBe("");
        expect(after).not.toBe(before);
    });

    it("ignores siteRun updates when the card is missing", async () => {
        const site = createSite("site-missing-card", { enabled: true });
        const { runtimeListeners } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        document.querySelector(`[data-site-id="${site.id}"]`)?.remove();

        runtimeListeners.onMessage?.({
            action: ACTIONS.siteRun,
            siteId: site.id,
            lastRun: Date.now(),
        });
        await flushPromises();

        expect(document.querySelector(`[data-site-id="${site.id}"]`)).toBeNull();
    });

    it("ignores siteRun messages when no card exists", async () => {
        const { runtimeListeners } = await setupPopup({});

        runtimeListeners.onMessage?.({
            action: ACTIONS.siteRun,
            siteId: "missing",
            lastRun: Date.now(),
        });
        await flushPromises();

        expect(document.querySelector(".last-run")).toBeNull();
    });

    it("ignores non-siteRun messages", async () => {
        const { runtimeListeners } = await setupPopup({});

        runtimeListeners.onMessage?.({
            action: "other",
            siteId: "site-unknown",
            lastRun: Date.now(),
        });
        await flushPromises();

        expect(document.querySelector(".last-run")).toBeNull();
    });

    it("ignores siteRun messages without a lastRun", async () => {
        const site = createSite("site-no-last", { enabled: true, lastRun: Date.now() - 60000 });
        const { runtimeListeners } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const before = document.querySelector(".last-run")?.textContent || "";

        runtimeListeners.onMessage?.({
            action: ACTIONS.siteRun,
            siteId: site.id,
            lastRun: 0,
        });
        await flushPromises();

        const after = document.querySelector(".last-run")?.textContent || "";
        expect(after).toBe(before);
    });

    it("returns early when testing a missing site", async () => {
        const site = createSite("site-missing-test", { enabled: true });
        const { browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        const testButton = document.querySelector(".test-request") as HTMLButtonElement;
        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;

        removeButton.click();
        await flushPromises();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        testButton.click();
        await flushPromises();

        expect(browserMock.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("shows error banners for global window errors", async () => {
        vi.useFakeTimers();
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
            await setupPopup({});

            const errorEvent = new Event("error") as any;
            errorEvent.error = new Error("Boom");
            errorEvent.preventDefault = vi.fn();
            window.dispatchEvent(errorEvent);

            const rejectionEvent = new Event("unhandledrejection") as any;
            rejectionEvent.reason = "Oops";
            rejectionEvent.preventDefault = vi.fn();
            window.dispatchEvent(rejectionEvent);

            const status = document.getElementById("status");
            expect(status?.textContent).toContain("An unexpected error occurred");

            await vi.runAllTimersAsync();

            expect(status?.style.display).toBe("none");

            expect(errorSpy).toHaveBeenCalledWith("Global error:", errorEvent.error);
            expect(errorSpy).toHaveBeenCalledWith("Unhandled promise rejection:", rejectionEvent.reason);
        } finally {
            errorSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it("shows a load error when initialization fails", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        await setupPopup({}, {
            storageGetImpl: vi.fn().mockRejectedValue(new Error("Storage down")),
        });

        const status = document.getElementById("status");
        expect(status?.textContent).toContain("Failed to load sites");

        expect(errorSpy).toHaveBeenCalledWith("Failed to initialize:", expect.any(Error));
        errorSpy.mockRestore();
    });

    it("closes the new site modal when the dialog element is missing", async () => {
        const uuid = "00000000-0000-4000-8000-000000000000" as const;
        const site = createSite(uuid);
        const cryptoObj = globalThis.crypto as Crypto | undefined;
        const randomUUIDSpy = cryptoObj?.randomUUID
            ? vi.spyOn(cryptoObj, "randomUUID").mockReturnValue(uuid)
            : undefined;

        const { storageFixture, browserMock } = await setupPopup({
            [SITE_IDS_KEY]: [site.id],
            [getSiteKey(site.id)]: site,
        });

        browserMock.tabs.query.mockResolvedValue([]);
        (document.getElementById("addSite") as HTMLButtonElement).click();
        await flushPromises();

        const modal = document.getElementById("newSiteModal") as HTMLDialogElement;
        modal.id = "newSiteModal-removed";

        (document.getElementById("closeNewSite") as HTMLButtonElement).click();
        await flushPromises();

        const removeButton = document.querySelector(".remove-site") as HTMLButtonElement;
        removeButton.click();
        await flushPromises();

        const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
        confirmOk.click();
        await flushPromises();

        expect(storageFixture.removeCalls).toContain(getSiteKey(site.id));

        randomUUIDSpy?.mockRestore();
    });
});
