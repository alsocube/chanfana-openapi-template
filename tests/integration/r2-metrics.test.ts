import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /r2/metrics", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the Cloudflare R2 usage response", async () => {
		const upstreamResponse = {
			success: true,
			result: { objectCount: 3, payloadSize: 1024 },
			errors: [],
			messages: [],
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(() =>
				Promise.resolve(
					new Response(JSON.stringify(upstreamResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);

		const response = await SELF.fetch("http://local.test/r2/metrics");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(upstreamResponse);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/test-account/r2/buckets/test-bucket/usage",
			{
				headers: {
					Authorization: "Bearer test-token",
					Accept: "application/json",
				},
			},
		);
	});

	it("returns a gateway error when Cloudflare rejects the request", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 10000, message: "Authentication error" }],
					}),
					{ status: 403 },
				),
			),
		);

		const response = await SELF.fetch("http://local.test/r2/metrics");
		const body = await response.json<{ success: boolean; errors: unknown[] }>();

		expect(response.status).toBe(502);
		expect(body.success).toBe(false);
		expect(body.errors).toEqual([
			{ code: 502, message: "The R2 metrics API returned an error" },
		]);
	});
});
