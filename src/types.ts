// Type aliases for better type safety
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type Timestamp = number; // milliseconds since epoch
export type UrlPattern = string; // e.g., "*://*.example.com/*"

export type SiteId = string;

export interface SiteConfig {
    id: SiteId;
    urlPattern: UrlPattern;
    endpoint: string;
    method: HttpMethod;
    headers: string; // JSON string or newline-separated headers
    body: string;
    checkInterval: number; // minutes (1-60)
    enabled: boolean;
    lastRun?: Timestamp;
}

export interface ValidationError {
    field: string;
    message: string;
}

export interface StorageData {
    siteIds?: SiteId[];
}

export interface BackgroundResponse {
    success: boolean;
    error?: string;
}

export interface TestResponse {
    success: boolean;
    status?: number;
    body?: string;
    error?: string;
}

export interface Alarm {
    name: string;
    scheduledTime?: number;
    periodInMinutes?: number;
}

// Additional utility types
export type StatusType = 'success' | 'error' | 'warning';

export interface RequestResult {
    success: boolean;
    statusCode?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
    error?: string;
}
