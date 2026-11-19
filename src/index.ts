import { ApiException, fromHono } from "chanfana";
import { Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import {
	CreatePostEndpoint,
	DeletePostEndpoint,
	PostsEndpoint,
	UpdatePostEndpoint,
} from "./endpoints/posts";
import { LoginEndpoint } from "./endpoints/login";
import { R2MetricsEndpoint } from "./endpoints/r2-metrics";
import { ObservabilityQueryEndpoint } from "./endpoints/observability";
import { getCorsHeaders } from "./utils/cors";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
	const corsHeaders = getCorsHeaders(c.req.header("Origin") ?? null);

	if (c.req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders });
	}

	await next();

	for (const [key, value] of Object.entries(corsHeaders)) {
		c.header(key, value);
	}
});

app.onError((err, c) => {
	if (err instanceof ApiException) {
		// If it's a Chanfana ApiException, let Chanfana handle the response
		return c.json(
			{ success: false, errors: err.buildResponse() },
			err.status as ContentfulStatusCode,
		);
	}

	console.error("Global error handler caught:", err); // Log the error if it's not known

	// For other errors, return a generic 500 response
	return c.json(
		{
			success: false,
			errors: [{ code: 7000, message: "Internal Server Error" }],
		},
		500,
	);
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
	schema: {
		info: {
			title: "My Awesome API",
			version: "2.0.0",
			description: "This is the documentation for my awesome API.",
		},
	},
});

// Register other endpoints
openapi.post("/login", LoginEndpoint);
openapi.get("/posts", PostsEndpoint);
openapi.post("/posts", CreatePostEndpoint);
openapi.put("/posts", UpdatePostEndpoint);
openapi.delete("/posts", DeletePostEndpoint);
openapi.get("/r2/metrics", R2MetricsEndpoint);
openapi.post("/observability/query", ObservabilityQueryEndpoint);

// Export the Hono app
export default app;
