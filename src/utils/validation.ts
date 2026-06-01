// Shared validation logic for SiteConfig
import type { SiteConfig } from '../types';

export function isValidUrlPattern(pattern: string): boolean {
    // Basic check: must not be empty (wildcard not required)
    return typeof pattern === 'string' && pattern.trim().length > 0;
}

export function isValidEndpoint(endpoint: string): boolean {
    try {
        new URL(endpoint);
        return true;
    } catch {
        return false;
    }
}

export function isValidInterval(interval: number): boolean {
    return Number.isInteger(interval) && interval >= 1 && interval <= 60;
}

export function validateSiteConfig(config: Partial<SiteConfig>): string[] {
    const errors: string[] = [];
    if (!isValidUrlPattern(config.urlPattern || '')) {
        errors.push('Invalid URL pattern.');
    }
    if (!isValidEndpoint(config.endpoint || '')) {
        errors.push('Invalid endpoint URL.');
    }
    if (!isValidInterval(Number(config.checkInterval))) {
        errors.push('Interval must be between 1 and 60 minutes.');
    }
    // Optionally add more checks (headers, method, etc.)
    return errors;
}
