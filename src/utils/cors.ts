const ALLOWED_ORIGIN = "https://www.simplycms.my.id";

const CORS_HEADERS = {
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
};

export function getCorsHeaders(origin: string | null): Record<string, string> {
	if (origin !== ALLOWED_ORIGIN) {
		return {};
	}

	return {
		...CORS_HEADERS,
		"Access-Control-Allow-Origin": ALLOWED_ORIGIN,
		Vary: "Origin",
	};
}
