import browser from 'webextension-polyfill';
import type { SiteConfig, SiteId, TestResponse, RequestResult } from './types';
import { ACTIONS } from './shared';
import { StorageService } from './services/StorageService';
import { formatLastRun, getInitialFromUrl } from './utils/popup';
import { validateSiteConfig } from './utils/validation';

// Constants
const STATUS_DISPLAY_DURATION = 3000;

// Global state
let sites: SiteConfig[] = [];
let newSiteId: SiteId | null = null;
const storageService = new StorageService(browser.storage.sync);

function createSiteId(): SiteId {
    return crypto.randomUUID();
}

// ============================================================================
// Background Communication
// ============================================================================

async function testSiteRequest(siteId: SiteId): Promise<TestResponse> {
    return await browser.runtime.sendMessage({
        action: ACTIONS.testRequest,
        siteId
    }) as TestResponse;
}

async function toggleSiteAlarm(siteId: SiteId, enabled: boolean): Promise<void> {
    const action = enabled ? ACTIONS.enableSite : ACTIONS.disableSite;
    await browser.runtime.sendMessage({ action, siteId });
}

// ============================================================================
// Utility Functions
// ============================================================================

function showError(message: string, autoHide = true): void {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;

    statusDiv.textContent = message;
    statusDiv.className = 'status error';
    statusDiv.style.display = 'block';

    if (autoHide) {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, STATUS_DISPLAY_DURATION);
    }
}

function updateGlobalStatus(): void {
    const indicator = document.getElementById('globalIndicator');
    const statusText = document.getElementById('globalStatusText');
    if (!indicator || !statusText) return;

    const activeCount = sites.filter(s => s.enabled).length;

    if (activeCount === 0) {
        indicator.classList.remove('active');
        statusText.textContent = 'No active sites';
    } else {
        indicator.classList.add('active');
        statusText.textContent = `${activeCount} active site${activeCount !== 1 ? 's' : ''}`;
    }
}

// ============================================================================
// Modal Functions
// ============================================================================

function showTestResultModal(endpoint: string, result: RequestResult): void {
    const modal = document.getElementById('testModal') as HTMLDialogElement;
    if (!modal) return;

    const statusClass = result.success ? 'success' : 'error';
    const statusText = result.success ? '✓ Success' : '✗ Failed';

    const content = document.createElement('div');
    content.className = 'modal-content';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    const h2 = document.createElement('h2');
    h2.id = 'modalTitle';
    h2.textContent = 'Test Result';
    const closeSpan = document.createElement('span');
    closeSpan.className = 'modal-close';
    closeSpan.id = 'closeModal';
    closeSpan.setAttribute('role', 'button');
    closeSpan.setAttribute('tabindex', '0');
    closeSpan.setAttribute('aria-label', 'Close modal');
    closeSpan.textContent = '×';
    closeSpan.addEventListener('click', () => modal.close());
    modalHeader.appendChild(h2);
    modalHeader.appendChild(closeSpan);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const endpointDiv = document.createElement('div');
    const endpointStrong = document.createElement('strong');
    endpointStrong.textContent = 'Endpoint:';
    endpointDiv.appendChild(endpointStrong);
    endpointDiv.append(` ${endpoint}`);
    modalBody.appendChild(endpointDiv);

    const statusDiv = document.createElement('div');
    statusDiv.className = 'test-status';
    const statusStrong = document.createElement('strong');
    statusStrong.textContent = 'Status:';
    const statusBadge = document.createElement('span');
    statusBadge.className = `test-status-badge ${statusClass}`;
    statusBadge.textContent = statusText;
    statusDiv.appendChild(statusStrong);
    statusDiv.append(' ');
    statusDiv.appendChild(statusBadge);
    if (result.statusCode) {
        const codeSpan = document.createElement('span');
        codeSpan.textContent = ` ${result.statusCode} ${result.statusText || ''}`;
        statusDiv.appendChild(codeSpan);
    }
    modalBody.appendChild(statusDiv);

    if (result.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'test-error';
        const errorStrong = document.createElement('strong');
        errorStrong.textContent = 'Error:';
        errorDiv.appendChild(errorStrong);
        errorDiv.append(` ${result.error}`);
        modalBody.appendChild(errorDiv);
    }

    if (result.body) {
        const truncatedBody = result.body.length > 500
            ? result.body.substring(0, 500) + '...'
            : result.body;
        const bodySection = document.createElement('div');
        bodySection.className = 'test-body-section';
        const bodyStrong = document.createElement('strong');
        bodyStrong.textContent = 'Response Body:';
        const pre = document.createElement('pre');
        pre.className = 'test-body';
        pre.textContent = truncatedBody;
        bodySection.appendChild(bodyStrong);
        bodySection.appendChild(pre);
        modalBody.appendChild(bodySection);
    }

    content.appendChild(modalHeader);
    content.appendChild(modalBody);
    modal.replaceChildren(content);

    modal.showModal();
}

function showConfirmModal(title: string, message: string, onConfirm: () => void): void {
    const modal = document.getElementById('confirmModal') as HTMLDialogElement;
    const titleElement = document.getElementById('confirmTitle');
    const messageElement = document.getElementById('confirmMessage');
    const okButton = document.getElementById('confirmOk');
    const cancelButton = document.getElementById('confirmCancel');
    const closeButton = document.getElementById('closeConfirm');

    if (!modal || !titleElement || !messageElement || !okButton || !cancelButton || !closeButton) return;

    titleElement.textContent = title;
    messageElement.textContent = message;

    // Remove any existing listeners by cloning
    const newOkButton = okButton.cloneNode(true) as HTMLButtonElement;
    const newCancelButton = cancelButton.cloneNode(true) as HTMLButtonElement;
    const newCloseButton = closeButton.cloneNode(true) as HTMLElement;

    okButton.replaceWith(newOkButton);
    cancelButton.replaceWith(newCancelButton);
    closeButton.replaceWith(newCloseButton);

    newOkButton.addEventListener('click', () => {
        modal.close();
        onConfirm();
    });

    newCancelButton.addEventListener('click', () => modal.close());
    newCloseButton.addEventListener('click', () => modal.close());

    modal.showModal();
}


// ============================================================================
// Site Card Rendering
// ============================================================================


function renderSiteCardHeader(site: SiteConfig, isNew = false): HTMLElement {
    const statusType = isNew ? 'pending' : (site.enabled ? 'active' : 'inactive');
    const statusText = isNew ? 'Unsaved' : (site.enabled ? 'Active' : 'Inactive');
    const avatarClass = isNew ? 'pending' : (site.enabled ? 'active' : 'inactive');
    const header = document.createElement('div');
    header.className = 'site-header';
    const siteInfo = document.createElement('div');
    siteInfo.className = 'site-info';

    const avatar = document.createElement('div');
    avatar.className = `site-avatar ${avatarClass}`;
    avatar.textContent = getInitialFromUrl(site.urlPattern);

    const infoDiv = document.createElement('div');

    const siteUrl = document.createElement('div');
    siteUrl.className = 'site-url';
    siteUrl.textContent = site.urlPattern || 'No URL pattern set';

    const siteMeta = document.createElement('div');
    siteMeta.className = 'site-meta';

    const statusSpan = document.createElement('span');
    statusSpan.className = `site-status ${statusType}`;
    statusSpan.textContent = statusText;
    siteMeta.appendChild(statusSpan);

    if (site.lastRun && !isNew) {
        const lastRunSpan = document.createElement('span');
        lastRunSpan.className = 'last-run';
        lastRunSpan.textContent = formatLastRun(site.lastRun);
        siteMeta.appendChild(lastRunSpan);
    }

    infoDiv.appendChild(siteUrl);
    infoDiv.appendChild(siteMeta);
    siteInfo.appendChild(avatar);
    siteInfo.appendChild(infoDiv);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'collapsible-toggle';
    toggleBtn.setAttribute('aria-label', 'Toggle details');
    toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 11L3 6h10z"/></svg>';

    header.appendChild(siteInfo);
    header.appendChild(toggleBtn);
    // Attach expand/collapse event ONCE here
    header.addEventListener('click', () => {
        const card = header.parentElement;
        if (card) {
            card.classList.toggle('collapsed');
            if (!document.body.classList.contains('modal-open')) {
                setTimeout(() => {
                    const bodyHeight = document.body.scrollHeight;
                    document.body.style.height = bodyHeight + 'px';
                    setTimeout(() => {
                        document.body.style.height = 'auto';
                    }, 10);
                }, 300);
            }
        }
    });
    return header;
}

function renderSiteCardForm(site: SiteConfig, isNew = false): HTMLFormElement {
    const form = document.createElement('form');
    // Static template — no expressions; all dynamic values set via DOM below
    form.innerHTML = `
        <div class="form-group">
            <label class="js-lbl-url">URL Pattern (supports * wildcard)</label>
            <input type="text" class="js-url-pattern" placeholder="*://example.com/*" required />
        </div>
        <div class="form-group">
            <label class="js-lbl-endpoint">Endpoint URL</label>
            <input type="url" class="js-endpoint" placeholder="https://example.com/api/keep-alive" required />
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="js-lbl-method">HTTP Method</label>
                <select class="js-method">
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                    <option>PATCH</option>
                </select>
            </div>
            <div class="form-group">
                <label class="js-lbl-interval">Check Interval (minutes)</label>
                <input type="number" class="js-interval" min="1" max="60" required />
            </div>
        </div>
        <div class="collapsible-section collapsed">
            <div class="collapsible-section-header">
                <span class="collapsible-section-label-text">Headers (optional)</span>
                <button type="button" class="collapsible-section-toggle" aria-label="Toggle headers">
                    <svg width="12" height="12" viewBox="0 0 16 16">
                        <path fill="currentColor" d="M8 11L3 6h10z"/>
                    </svg>
                </button>
            </div>
            <div class="collapsible-content">
                <textarea class="js-headers" rows="3" placeholder="Content-Type: application/json"></textarea>
            </div>
        </div>
        <div class="collapsible-section collapsed">
            <div class="collapsible-section-header">
                <span class="collapsible-section-label-text">Request Body (optional)</span>
                <button type="button" class="collapsible-section-toggle" aria-label="Toggle body">
                    <svg width="12" height="12" viewBox="0 0 16 16">
                        <path fill="currentColor" d="M8 11L3 6h10z"/>
                    </svg>
                </button>
            </div>
            <div class="collapsible-content">
                <textarea class="js-body" rows="4" placeholder='{"key": "value"}'></textarea>
            </div>
        </div>
        <div class="form-footer">
            <label class="toggle-container">
                <span>Enabled</span>
                <label class="toggle-switch">
                    <input type="checkbox" class="js-enabled" />
                    <span class="slider"></span>
                </label>
            </label>
            <div class="button-group">
                <button type="button" class="button-secondary test-request">
                    <span>🧪</span><span>Test</span>
                </button>
            </div>
        </div>
    `;

    // Wire up IDs (needed by setupSiteCardEventListeners and label accessibility)
    const urlInput = form.querySelector('.js-url-pattern') as HTMLInputElement;
    const endpointInput = form.querySelector('.js-endpoint') as HTMLInputElement;
    const methodSelect = form.querySelector('.js-method') as HTMLSelectElement;
    const intervalInput = form.querySelector('.js-interval') as HTMLInputElement;
    const headersTextarea = form.querySelector('.js-headers') as HTMLTextAreaElement;
    const bodyTextarea = form.querySelector('.js-body') as HTMLTextAreaElement;
    const enabledCheckbox = form.querySelector('.js-enabled') as HTMLInputElement;
    const testBtn = form.querySelector('.test-request') as HTMLButtonElement;

    urlInput.id = `urlPattern-${site.id}`;
    (form.querySelector('.js-lbl-url') as HTMLLabelElement).htmlFor = `urlPattern-${site.id}`;
    endpointInput.id = `endpoint-${site.id}`;
    (form.querySelector('.js-lbl-endpoint') as HTMLLabelElement).htmlFor = `endpoint-${site.id}`;
    methodSelect.id = `method-${site.id}`;
    (form.querySelector('.js-lbl-method') as HTMLLabelElement).htmlFor = `method-${site.id}`;
    intervalInput.id = `interval-${site.id}`;
    (form.querySelector('.js-lbl-interval') as HTMLLabelElement).htmlFor = `interval-${site.id}`;
    headersTextarea.id = `headers-${site.id}`;
    bodyTextarea.id = `body-${site.id}`;
    enabledCheckbox.id = `enabled-${site.id}`;
    testBtn.dataset.id = site.id;

    // Set values
    urlInput.value = site.urlPattern;
    endpointInput.value = site.endpoint;
    methodSelect.value = site.method;
    intervalInput.value = String(site.checkInterval);
    headersTextarea.value = site.headers;
    bodyTextarea.value = site.body;
    enabledCheckbox.checked = site.enabled;

    // Add the save or remove button
    const buttonGroup = form.querySelector('.button-group') as HTMLElement;
    if (isNew) {
        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'button-primary';
        saveBtn.textContent = 'Save';
        buttonGroup.appendChild(saveBtn);
    } else {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'button-danger remove-site';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.id = site.id;
        buttonGroup.appendChild(removeBtn);
    }

    return form;
}

function setupCollapsibleSections(form: HTMLFormElement) {
    form.querySelectorAll('.collapsible-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.collapsible-section');
            section?.classList.toggle('collapsed');
        });
    });
}

function setupSiteCardEventListeners(card: HTMLElement, form: HTMLFormElement, site: SiteConfig, isNew = false) {
    // (header expand/collapse handled in renderSiteCardHeader)
    // Collapsible sections
    setupCollapsibleSections(form);
    // Handle URL pattern input to update header in real-time
    const urlInput = form.querySelector(`#urlPattern-${site.id}`) as HTMLInputElement;
    if (urlInput) {
        urlInput.addEventListener('input', () => {
            const avatar = card.querySelector('.site-avatar');
            const urlSpan = card.querySelector('.site-url');
            if (avatar) {
                avatar.textContent = getInitialFromUrl(urlInput.value);
            }
            if (urlSpan) {
                urlSpan.textContent = urlInput.value || 'No URL pattern set';
            }
        });
    }
    // Handle form changes (auto-save for existing sites)
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', async () => {
            if (!isNew) {
                await saveSiteFromForm(site.id);
            }
        });
    });
    // Handle form submit (for new sites)
    if (isNew) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createSite(site.id);
        });
    }
    // Handle test button
    const testBtn = form.querySelector('.test-request');
    testBtn?.addEventListener('click', () => testRequest(site.id));
    // Handle remove button
    const removeBtn = form.querySelector('.remove-site');
    removeBtn?.addEventListener('click', () => {
        showConfirmModal(
            'Remove Site',
            'Are you sure you want to remove this site configuration?',
            () => removeSite(site.id)
        );
    });
}

function createSiteCard(site: SiteConfig, isNew = false, isExpanded = false): HTMLElement {
    const card = document.createElement('div');
    card.className = 'site-config' + 
        (!site.enabled && !isNew ? ' disabled' : '') +
        (!isExpanded ? ' collapsed' : '');
    card.dataset.siteId = String(site.id);
    const header = renderSiteCardHeader(site, isNew);
    const details = document.createElement('div');
    details.className = 'site-details';
    const form = renderSiteCardForm(site, isNew);
    setupSiteCardEventListeners(card, form, site, isNew);
    details.appendChild(form);
    card.appendChild(header);
    card.appendChild(details);
    return card;
}

function getSiteFromForm(siteId: SiteId): Partial<SiteConfig> {
    const urlPattern = (document.getElementById(`urlPattern-${siteId}`) as HTMLInputElement)?.value;
    const endpoint = (document.getElementById(`endpoint-${siteId}`) as HTMLInputElement)?.value;
    const method = (document.getElementById(`method-${siteId}`) as HTMLSelectElement)?.value as any;
    const checkInterval = parseInt((document.getElementById(`interval-${siteId}`) as HTMLInputElement)?.value);
    const headers = (document.getElementById(`headers-${siteId}`) as HTMLTextAreaElement)?.value || '';
    const body = (document.getElementById(`body-${siteId}`) as HTMLTextAreaElement)?.value || '';
    const enabled = (document.getElementById(`enabled-${siteId}`) as HTMLInputElement)?.checked;

    return { urlPattern, endpoint, method, checkInterval, headers, body, enabled };
}

async function saveSiteFromForm(siteId: SiteId): Promise<void> {
    const updates = getSiteFromForm(siteId);
    const siteIndex = sites.findIndex(s => s.id === siteId);
    if (siteIndex === -1) return;
    // Only apply values that were actually read from DOM (skip undefined/NaN from missing elements)
    const definedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined && !Number.isNaN(v as number))
    ) as Partial<SiteConfig>;
    const merged = { ...sites[siteIndex], ...definedUpdates };
    const errors = validateSiteConfig(merged);
    if (errors.length > 0) {
        showError(errors.join(' '));
    }
    // Update local state
    sites[siteIndex] = merged;
    // Save to storage
    await storageService.saveSite(sites[siteIndex]);
    // Update alarm if needed
    await toggleSiteAlarm(siteId, sites[siteIndex].enabled);
    // Update UI
    const cardElement = document.querySelector(`[data-site-id="${siteId}"]`) as HTMLElement;
    if (cardElement) {
        updateSiteCardHeader(cardElement, sites[siteIndex]);
    }
    updateGlobalStatus();
}

async function createSite(tempId: SiteId): Promise<void> {
    try {
        const formData = getSiteFromForm(tempId);
        const newSite: SiteConfig = {
            id: tempId,
            urlPattern: formData.urlPattern || '',
            endpoint: formData.endpoint || '',
            method: formData.method || 'POST',
            checkInterval: formData.checkInterval || 5,
            headers: formData.headers || '',
            body: formData.body || '',
            enabled: formData.enabled ?? true
        };
        const errors = validateSiteConfig(newSite);
        if (errors.length > 0) {
            showError(errors.join(' '));
        }
        // Add to sites and save
        sites.push(newSite);
        await storageService.addSite(newSite);
        // Clear new site flag
        newSiteId = null;
        // Close modal
        closeNewSiteModal();
        // Re-render
        renderSites();
    } catch (error) {
        showError(`✗ Error creating site: ${error}`);
    }
}

function updateSiteCardHeader(cardElement: HTMLElement, site: SiteConfig): void {
    const avatar = cardElement.querySelector('.site-avatar');
    const urlSpan = cardElement.querySelector('.site-url');
    const statusBadge = cardElement.querySelector('.site-status');
    const lastRunSpan = cardElement.querySelector('.last-run');

    if (avatar) {
        avatar.className = `site-avatar ${site.enabled ? 'active' : 'inactive'}`;
        avatar.textContent = getInitialFromUrl(site.urlPattern);
    }

    if (urlSpan) {
        urlSpan.textContent = site.urlPattern || 'No URL pattern set';
    }

    if (statusBadge) {
        statusBadge.className = `site-status ${site.enabled ? 'active' : 'inactive'}`;
        statusBadge.textContent = site.enabled ? 'Active' : 'Inactive';
    }

    if (lastRunSpan && site.lastRun) {
        lastRunSpan.textContent = formatLastRun(site.lastRun);
    }

    // Update card disabled state
    if (site.enabled) {
        cardElement.classList.remove('disabled');
    } else {
        cardElement.classList.add('disabled');
    }
}

// ============================================================================
// Site Management
// ============================================================================

function renderSites(): void {
    const container = document.getElementById('sitesContainer');
    if (!container) return;

    container.replaceChildren();

    if (sites.length === 0 && newSiteId === null) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📭</div>
                <p><strong>No sites configured yet</strong></p>
            </div>
        `;
        return;
    }

    sites.forEach(site => {
        container.appendChild(createSiteCard(site, false, false));
    });

    updateGlobalStatus();
}

async function addNewSite(): Promise<void> {
    let urlPattern = '*://*.example.com/*';
    let endpoint = 'https://example.com/api/refresh';

    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].url) {
            urlPattern = tabs[0].url;
            try {
                const url = new URL(tabs[0].url);
                endpoint = `${url.origin}/api/keep-alive`;
            } catch (e) {
                // Keep defaults
            }
        }
    } catch (error) {
        console.error("Could not query active tab:", error);
    }

    const tempSite: SiteConfig = {
        id: createSiteId(),
        urlPattern,
        endpoint,
        method: 'POST',
        headers: '',
        body: '',
        checkInterval: 5,
        enabled: true
    };

    newSiteId = tempSite.id;

    // Show fullscreen modal
    const modal = document.getElementById('newSiteModal') as HTMLDialogElement;
    const formContainer = document.getElementById('newSiteForm');

    if (modal && formContainer) {
        // Create the form card (without the wrapper card styling)
        const card = createSiteCard(tempSite, true, true);
        const form = card.querySelector('form');

        if (form) {
            formContainer.innerHTML = '';
            formContainer.appendChild(form);
        }

        // Expand body for fullscreen modal
        document.body.style.height = ''; // Clear any inline height from Firefox workaround
        document.documentElement.classList.add('modal-open');
        document.body.classList.add('modal-open');

        modal.showModal();
    }
}

function closeNewSiteModal(): void {
    const modal = document.getElementById('newSiteModal') as HTMLDialogElement;
    if (modal) {
        modal.classList.add('closing');

        // Wait for animation to complete before actually closing
        setTimeout(() => {
            modal.close();
            modal.classList.remove('closing');

            // Restore body height
            document.documentElement.classList.remove('modal-open');
            document.body.classList.remove('modal-open');

            const formContainer = document.getElementById('newSiteForm');
            if (formContainer) {
                formContainer.innerHTML = '';
            }

            newSiteId = null;
        }, 200); // Match animation duration
    } else {
        newSiteId = null;
    }
}

async function removeSite(siteId: SiteId): Promise<void> {
    // Check if it's a new unsaved site
    if (siteId === newSiteId) {
        newSiteId = null;
        renderSites();
        return;
    }

    // Remove from array
    sites = sites.filter(s => s.id !== siteId);
    await storageService.removeSite(siteId);

    // Re-render
    renderSites();
}

async function testRequest(siteId: SiteId): Promise<void> {
    const site = sites.find(s => s.id === siteId);
    if (!site) return;

    const btn = document.querySelector<HTMLButtonElement>(`.test-request[data-id="${siteId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span><span>Testing...</span>';
    }

    try {
        const response = await testSiteRequest(siteId);
        const result: RequestResult = {
            success: response.success,
            statusCode: response.status,
            body: response.body,
            error: response.error
        };
        showTestResultModal(site.endpoint, result);
    } catch (error) {
        const result: RequestResult = {
            success: false,
            error: String(error)
        };
        showTestResultModal(site.endpoint, result);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>🧪</span><span>Test</span>';
        }
    }
}

// ============================================================================
// Initialization
// ============================================================================

// Global error handlers
window.addEventListener('error', (event) => {
    console.error("Global error:", event.error);
    showError('✗ An unexpected error occurred');
    event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
    console.error("Unhandled promise rejection:", event.reason);
    showError('✗ An unexpected error occurred');
    event.preventDefault();
});

// Setup event listeners
document.getElementById('addSite')?.addEventListener('click', addNewSite);

// New site modal close handlers
document.getElementById('closeNewSite')?.addEventListener('click', closeNewSiteModal);

function addBackdropClickHandler(elementId: string, onClose: () => void): void {
    document.getElementById(elementId)?.addEventListener('click', (e) => {
        const dialog = e.target as HTMLDialogElement;
        if (dialog.tagName === 'DIALOG') {
            const rect = dialog.getBoundingClientRect();
            const isInDialog = (
                rect.top <= e.clientY &&
                e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX &&
                e.clientX <= rect.left + rect.width
            );
            if (!isInDialog) {
                onClose();
            }
        }
    });
}

addBackdropClickHandler('newSiteModal', closeNewSiteModal);

// Modal backdrop click to close
addBackdropClickHandler('testModal', () => (document.getElementById('testModal') as HTMLDialogElement).close());
addBackdropClickHandler('confirmModal', () => (document.getElementById('confirmModal') as HTMLDialogElement).close());

// Listen for updates from background script
browser.runtime.onMessage.addListener((message: any) => {
    if (message.action === ACTIONS.siteRun && message.siteId !== undefined && message.lastRun) {
        const site = sites.find(s => String(s.id) === String(message.siteId));
        if (site) {
            site.lastRun = message.lastRun;
            const card = document.querySelector(`[data-site-id="${site.id}"]`);
            if (card) {
                updateSiteCardHeader(card as HTMLElement, site);
            }
        }
    }
});

// Initialize
(async () => {
    try {
        sites = await storageService.loadSites();
        renderSites();
    } catch (error) {
        console.error("Failed to initialize:", error);
        showError('✗ Failed to load sites', false);
    }
})();
