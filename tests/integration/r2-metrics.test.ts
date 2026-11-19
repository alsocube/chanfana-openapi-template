import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /r2/metrics", () => {
	afterEach(async () => {
		await env.POSTS_BUCKET.delete(["one.txt", "two.txt"]);
		vi.restoreAllMocks();
	});

	it("lists the configured R2 bucket and calculates its metrics", async () => {
		await env.POSTS_BUCKET.put("one.txt", new Uint8Array(1024));
		await env.POSTS_BUCKET.put("two.txt", new Uint8Array(2048));

		const response = await SELF.fetch("http://local.test/r2/metrics");
		const body = await response.json<{
			success: boolean;
			result: {
				objectCount: number;
				payloadSize: number;
				averageObjectSize: number;
				largestObject: { key: string; size: number };
				newestObject: { key: string; size: number; lastModified: string };
				oldestObject: { key: string; size: number; lastModified: string };
				zeroByteObjectCount: number;
				sizeByExtension: Record<string, number>;
				countByExtension: Record<string, number>;
				sizeByPrefix: Record<string, number>;
				topLargestObjects: Array<{ key: string; size: number }>;
				ageDistribution: Record<string, number>;
			};
			errors: unknown[];
			messages: unknown[];
		}>();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.result).toMatchObject({
			objectCount: 2,
			payloadSize: 3072,
			averageObjectSize: 1536,
			largestObject: { key: "two.txt", size: 2048 },
			zeroByteObjectCount: 0,
			sizeByExtension: { ".txt": 3072 },
			countByExtension: { ".txt": 2 },
			sizeByPrefix: { "(root)": 3072 },
			topLargestObjects: [
				{ key: "two.txt", size: 2048 },
				{ key: "one.txt", size: 1024 },
			],
		});
		expect(body.result.newestObject).toMatchObject({ key: "two.txt", size: 2048 });
		expect(body.result.oldestObject).toMatchObject({ key: "one.txt", size: 1024 });
		expect(body.result.ageDistribution.lessThanOneDay).toBe(2);
		expect(body.errors).toEqual([]);
		expect(body.messages).toEqual([]);
	});

	it("returns a gateway error when R2 rejects the request", async () => {
		vi.spyOn(env.POSTS_BUCKET, "list").mockRejectedValue(
			new Error("R2 list failed"),
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
