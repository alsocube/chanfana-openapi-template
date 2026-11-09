import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /r2/metrics", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists the configured R2 bucket and calculates its metrics", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((input) => {
				const url = new URL(input.toString());
				expect(url.origin).toBe(
					"https://test-account.r2.cloudflarestorage.com",
				);
				expect(url.pathname).toBe("/test-bucket");
				expect(url.searchParams.get("list-type")).toBe("2");
				return Promise.resolve(
					new Response(
						`<?xml version="1.0" encoding="UTF-8"?>
						<ListBucketResult>
							<IsTruncated>false</IsTruncated>
							<Contents><Key>one.txt</Key><Size>1024</Size></Contents>
							<Contents><Key>two.txt</Key><Size>2048</Size></Contents>
						</ListBucketResult>`,
						{ status: 200, headers: { "Content-Type": "application/xml" } },
					),
				);
			});

		const response = await SELF.fetch("http://local.test/r2/metrics");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			result: { objectCount: 2, payloadSize: 3072 },
			errors: [],
			messages: [],
		});
		expect(fetchMock).toHaveBeenCalledOnce();
		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
		expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(headers.Authorization).toMatch(
			/^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request,/,
		);
	});

	it("returns a gateway error when R2 rejects the request", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(() =>
			Promise.resolve(new Response("AccessDenied", { status: 403 })),
		);

		const response = await SELF.fetch("http://local.test/r2/metrics");
		const body = await response.json<{ success: boolean; errors: unknown[] }>();

		expect(response.status).toBe(502);
		expect(body.success).toBe(false);
		expect(body.errors).toEqual([
			{ code: 502, message: "Unable to retrieve R2 bucket metrics" },
		]);
	});
});
