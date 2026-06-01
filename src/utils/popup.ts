export function formatLastRun(timestamp?: number): string {
    if (!timestamp) return "";

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    if (seconds > 10) return `${seconds}s ago`;
    return "Just now";
}

export function getInitialFromUrl(url: string): string {
    if (!url) return "E";

    let cleaned = url.replace(/^[^:]*:\/\//, "");
    cleaned = cleaned.replace(/^www\./, "");

    return (cleaned[0] || "E").toUpperCase();
}
