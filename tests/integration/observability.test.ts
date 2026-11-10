import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("POST /observability/query", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards the query to Workers Observability", async () => {
		const query = {
			queryId: "adhoc-query",
			timeframe: { from: 1_700_000_000_000, to: 1_700_003_600_000 },
			view: "events",
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				expect(input.toString()).toBe(
					"https://api.cloudflare.com/client/v4/accounts/test-account-id/workers/observability/telemetry/query",
				);
				expect(init?.method).toBe("POST");
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-api-token",
				);
				expect(await new Response(init?.body).json()).toEqual(query);
				return new Response(JSON.stringify({ success: true, result: { rows: [] } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			});

		const response = await SELF.fetch("http://local.test/observability/query", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(query),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			result: { rows: [] },
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("returns a gateway error when Cloudflare rejects the query", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Unauthorized", { status: 401 }),
		);

		const response = await SELF.fetch("http://local.test/observability/query", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ queryId: "adhoc-query" }),
		});
		const body = await response.json<{ success: boolean; errors: unknown[] }>();

		expect(response.status).toBe(502);
		expect(body).toEqual({
			success: false,
			errors: [{ code: 502, message: "Unable to retrieve observability data" }],
		});
	});

	it("rejects non-object JSON bodies", async () => {
		const response = await SELF.fetch("http://local.test/observability/query", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(["not", "an", "object"]),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			success: false,
			errors: [{ code: 400, message: "Expected a JSON object" }],
		});
	});
});
