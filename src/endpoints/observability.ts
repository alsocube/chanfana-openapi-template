import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const queryRequestSchema = z.record(z.unknown());
const queryResponseSchema = z.record(z.unknown());

export class ObservabilityQueryEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Observability"],
		summary: "Run a Workers Observability telemetry query",
		operationId: "run-observability-query",
		request: {
			body: {
				content: {
					"application/json": {
						schema: queryRequestSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Workers Observability telemetry query result",
				...contentJson(queryResponseSchema),
			},
			"400": { description: "Invalid query request" },
			"500": { description: "Observability configuration is incomplete" },
			"502": { description: "Workers Observability request failed" },
		},
	};

	public async handle(c: AppContext) {
		const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = c.env;
		if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
			console.error("Observability configuration is incomplete");
			return c.json(
				{
					success: false,
					errors: [{ code: 500, message: "Observability is not configured" }],
				},
				500,
			);
		}

		let requestBody: unknown;
		try {
			requestBody = await c.req.json();
		} catch {
			return c.json(
				{
					success: false,
					errors: [{ code: 400, message: "Expected a JSON body" }],
				},
				400,
			);
		}

		const parsedRequest = queryRequestSchema.safeParse(requestBody);
		if (!parsedRequest.success) {
			return c.json(
				{
					success: false,
					errors: [{ code: 400, message: "Expected a JSON object" }],
				},
				400,
			);
		}

		const upstreamUrl =
			"https://api.cloudflare.com/client/v4/accounts/" +
			encodeURIComponent(CLOUDFLARE_ACCOUNT_ID) +
			"/workers/observability/telemetry/query";

		try {
			const response = await fetch(upstreamUrl, {
				method: "POST",
				headers: {
					Authorization: "Bearer " + CLOUDFLARE_API_TOKEN,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(parsedRequest.data),
			});

			if (!response.ok) {
				throw new Error(`Cloudflare API request failed with status ${response.status}`);
			}

			return c.json(await response.json(), 200);
		} catch (error) {
			console.error("Workers Observability request failed", error);
			return c.json(
				{
					success: false,
					errors: [{ code: 502, message: "Unable to retrieve observability data" }],
				},
				502,
			);
		}
	}
}
