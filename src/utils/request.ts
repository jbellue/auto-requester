export function parseHeaders(headersString: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const trimmed = headersString.trim();

    if (!trimmed) return headers;

    trimmed.split("\n").forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            const colonIndex = trimmedLine.indexOf(":");
            if (colonIndex > 0) {
                const key = trimmedLine.substring(0, colonIndex).trim();
                const value = trimmedLine.substring(colonIndex + 1).trim();
                headers[key] = value;
            }
        }
    });

    return headers;
}

export function urlMatchesPattern(url: string, pattern: string): boolean {
    let regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");

    regexPattern = "^" + regexPattern + "$";

    const regex = new RegExp(regexPattern);
    return regex.test(url);
}
