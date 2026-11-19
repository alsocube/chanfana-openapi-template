const ALLOWED_ORIGINS = new Set([
    "http://localhost:5173",
    "https://www.simplycms.my.id",
    "https://simplycms.my.id",
]);

const CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
};

export function getCorsHeaders(origin: string | null): Record<string, string> {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return {};
    }

    return {
        ...CORS_HEADERS,
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
    };
}