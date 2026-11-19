import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const metricsSchema = z.object({
	success: z.boolean(),
	result: z.object({
		objectCount: z.number(),
		payloadSize: z.number(),
		averageObjectSize: z.number(),
		largestObject: z
			.object({ key: z.string(), size: z.number() })
			.nullable(),
		newestObject: z
			.object({ key: z.string(), size: z.number(), lastModified: z.string() })
			.nullable(),
		oldestObject: z
			.object({ key: z.string(), size: z.number(), lastModified: z.string() })
			.nullable(),
		zeroByteObjectCount: z.number(),
		sizeByExtension: z.record(z.number()),
		countByExtension: z.record(z.number()),
		sizeByPrefix: z.record(z.number()),
		topLargestObjects: z.array(z.object({ key: z.string(), size: z.number() })),
		ageDistribution: z.object({
			lessThanOneDay: z.number(),
			oneToThirtyDays: z.number(),
			thirtyToThreeSixtyFiveDays: z.number(),
			overThreeSixtyFiveDays: z.number(),
		}),
	}),
	errors: z.array(z.unknown()).optional(),
	messages: z.array(z.unknown()).optional(),
});

type ListedObject = {
	key: string;
	size: number;
	lastModified?: string;
};

function extensionFor(key: string) {
	const fileName = key.slice(key.lastIndexOf("/") + 1);
	const extension = fileName.includes(".")
		? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
		: "";
	return extension ? `.${extension}` : "(none)";
}

function prefixFor(key: string) {
	const separator = key.indexOf("/");
	return separator === -1 ? "(root)" : key.slice(0, separator);
}

function ageBucket(lastModified: string | undefined, now: number) {
	if (!lastModified) {
		return undefined;
	}
	const ageInDays = (now - Date.parse(lastModified)) / 86_400_000;
	if (!Number.isFinite(ageInDays) || ageInDays < 0) {
		return undefined;
	}
	if (ageInDays < 1) return "lessThanOneDay";
	if (ageInDays < 30) return "oneToThirtyDays";
	if (ageInDays < 365) return "thirtyToThreeSixtyFiveDays";
	return "overThreeSixtyFiveDays";
}

export class R2MetricsEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["R2"],
		summary: "Get R2 bucket metrics",
		operationId: "get-r2-metrics",
		responses: {
			"200": {
				description: "R2 bucket metrics calculated from the bound R2 bucket",
				...contentJson(metricsSchema),
			},
			"502": { description: "R2 bucket metrics request failed" },
			"500": { description: "R2 metrics configuration is incomplete" },
		},
	};

	public async handle(c: AppContext) {
		if (!c.env.POSTS_BUCKET) {
			console.error("R2 metrics configuration is incomplete");
			return c.json(
				{
					success: false,
					errors: [{ code: 500, message: "R2 metrics are not configured" }],
				},
				500,
			);
		}

		const objects: ListedObject[] = [];
		let cursor: string | undefined;

		try {
			do {
				const page = await c.env.POSTS_BUCKET.list({
					limit: 1000,
					cursor,
				});
				objects.push(
					...page.objects.map((object) => ({
						key: object.key,
						size: object.size,
						lastModified: object.uploaded.toISOString(),
					})),
				);
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
		} catch (error) {
			console.error("R2 bucket metrics request failed", error);
			return c.json(
				{
					success: false,
					errors: [{ code: 502, message: "Unable to retrieve R2 bucket metrics" }],
				},
				502,
			);
		}

		const now = Date.now();
		const sizeByExtension: Record<string, number> = {};
		const countByExtension: Record<string, number> = {};
		const sizeByPrefix: Record<string, number> = {};
		const ageDistribution = {
			lessThanOneDay: 0,
			oneToThirtyDays: 0,
			thirtyToThreeSixtyFiveDays: 0,
			overThreeSixtyFiveDays: 0,
		};
		let zeroByteObjectCount = 0;
		let newestObject: ListedObject | undefined;
		let oldestObject: ListedObject | undefined;

		for (const object of objects) {
			const extension = extensionFor(object.key);
			sizeByExtension[extension] = (sizeByExtension[extension] ?? 0) + object.size;
			countByExtension[extension] = (countByExtension[extension] ?? 0) + 1;
			const prefix = prefixFor(object.key);
			sizeByPrefix[prefix] = (sizeByPrefix[prefix] ?? 0) + object.size;
			if (object.size === 0) zeroByteObjectCount++;

			const bucket = ageBucket(object.lastModified, now);
			if (bucket) ageDistribution[bucket]++;
			if (object.lastModified) {
				if (
					!newestObject ||
					Date.parse(object.lastModified) > Date.parse(newestObject.lastModified!)
				) {
					newestObject = object;
				}
				if (
					!oldestObject ||
					Date.parse(object.lastModified) < Date.parse(oldestObject.lastModified!)
				) {
					oldestObject = object;
				}
			}
		}

		const payloadSize = objects.reduce((sum, object) => sum + object.size, 0);
		const largestObjects = [...objects]
			.sort((left, right) => right.size - left.size)
			.slice(0, 10)
			.map(({ key, size }) => ({ key, size }));

		return c.json(
			{
				success: true,
				result: {
					objectCount: objects.length,
					payloadSize,
					averageObjectSize: objects.length ? payloadSize / objects.length : 0,
					largestObject: largestObjects[0] ?? null,
					newestObject: newestObject
						? {
								key: newestObject.key,
								size: newestObject.size,
								lastModified: newestObject.lastModified!,
							}
						: null,
					oldestObject: oldestObject
						? {
								key: oldestObject.key,
								size: oldestObject.size,
								lastModified: oldestObject.lastModified!,
							}
						: null,
					zeroByteObjectCount,
					sizeByExtension,
					countByExtension,
					sizeByPrefix,
					topLargestObjects: largestObjects,
					ageDistribution,
				},
				errors: [],
				messages: [],
			},
			200,
		);
	}
}
