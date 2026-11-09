import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const cloudflareApiResponseSchema = z.object({
	success: z.boolean(),
	result: z.unknown().nullable(),
	errors: z.array(z.unknown()).optional(),
	messages: z.array(z.unknown()).optional(),
});

export class R2MetricsEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["R2"],
		summary: "Get R2 bucket metrics",
		operationId: "get-r2-metrics",
		responses: {
			"200": {
				description: "Cloudflare R2 bucket usage metrics",
				...contentJson(cloudflareApiResponseSchema),
			},
			"502": { description: "Cloudflare R2 metrics API request failed" },
			"500": { description: "R2 metrics configuration is incomplete" },
		},
	};

	public async handle(c: AppContext) {
		const { R2_ACCOUNT_ID, R2_API_TOKEN, R2_BUCKET_NAME } = c.env;
		if (!R2_ACCOUNT_ID || !R2_API_TOKEN || !R2_BUCKET_NAME) {
			console.error("R2 metrics configuration is incomplete");
			return c.json(
				{
					success: false,
					errors: [{ code: 500, message: "R2 metrics are not configured" }],
				},
				500,
			);
		}

		const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(R2_ACCOUNT_ID)}/r2/buckets/${encodeURIComponent(R2_BUCKET_NAME)}/usage`;

		let response: Response;
		try {
			response = await fetch(endpoint, {
				headers: {
					Authorization: `Bearer ${R2_API_TOKEN}`,
					Accept: "application/json",
				},
			});
		} catch (error) {
			console.error("R2 metrics API request failed", error);
			return c.json(
				{
					success: false,
					errors: [{ code: 502, message: "Unable to reach the R2 metrics API" }],
				},
				502,
			);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			console.error("R2 metrics API returned invalid JSON", error);
			return c.json(
				{
					success: false,
					errors: [{ code: 502, message: "Invalid response from the R2 metrics API" }],
				},
				502,
			);
		}

		const parsedPayload = cloudflareApiResponseSchema.safeParse(payload);
		if (!response.ok || !parsedPayload.success || !parsedPayload.data.success) {
			console.error("R2 metrics API returned an error", {
				status: response.status,
				payload,
			});
			return c.json(
				{
					success: false,
					errors: [{ code: 502, message: "The R2 metrics API returned an error" }],
				},
				502,
			);
		}

		return c.json(parsedPayload.data, 200);
	}
}
