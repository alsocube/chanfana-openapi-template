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

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

function toHex(value: ArrayBuffer) {
	return [...new Uint8Array(value)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function sha256(value: string) {
	return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function createAuthorization(
	url: URL,
	accessKeyId: string,
	secretAccessKey: string,
	date: Date,
) {
	const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, "");
	const dateStamp = amzDate.slice(0, 8);
	const region = "auto";
	const service = "s3";
	const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
	const payloadHash = await sha256("");
	const canonicalQueryString = [...url.searchParams.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
	const canonicalHeaders =
		`host:${url.host}\n` +
		`x-amz-content-sha256:${payloadHash}\n` +
		`x-amz-date:${amzDate}\n`;
	const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
	const canonicalRequest = [
		"GET",
		url.pathname,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		await sha256(canonicalRequest),
	].join("\n");
	const dateKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
	const regionKey = await hmac(dateKey, region);
	const serviceKey = await hmac(regionKey, service);
	const signingKey = await hmac(serviceKey, "aws4_request");
	const signature = toHex(await hmac(signingKey, stringToSign));

	return {
		Authorization:
			`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
			`SignedHeaders=${signedHeaders}, Signature=${signature}`,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amzDate,
	};
}

type ListedObject = {
	key: string;
	size: number;
	lastModified?: string;
};

function decodeXml(value: string) {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function parsePage(xml: string) {
	const objects: ListedObject[] = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
		.map((match) => {
			const contents = match[1];
			const key = contents.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
			const size = contents.match(/<Size>(\d+)<\/Size>/)?.[1];
			const lastModified = contents.match(
				/<LastModified>([\s\S]*?)<\/LastModified>/,
			)?.[1];
			if (key === undefined || size === undefined) {
				return undefined;
			}
			const object: ListedObject = {
				key: decodeXml(key),
				size: Number(size),
			};
			if (lastModified) object.lastModified = decodeXml(lastModified);
			return object;
		})
		.filter((object): object is ListedObject => object !== undefined);
	const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
	const nextToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
	return { objects, isTruncated, nextToken };
}

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
				description: "R2 bucket metrics calculated from its S3 object listing",
				...contentJson(metricsSchema),
			},
			"502": { description: "R2 S3 metrics request failed" },
			"500": { description: "R2 metrics configuration is incomplete" },
		},
	};

	public async handle(c: AppContext) {
		const {
			R2_ACCOUNT_ID,
			R2_ACCESS_KEY_ID,
			R2_SECRET_ACCESS_KEY,
			R2_BUCKET_NAME,
		} = c.env;
		if (
			!R2_ACCOUNT_ID ||
			!R2_ACCESS_KEY_ID ||
			!R2_SECRET_ACCESS_KEY ||
			!R2_BUCKET_NAME
		) {
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
		let continuationToken: string | undefined;

		try {
			do {
				const url = new URL(
					`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(R2_BUCKET_NAME)}`,
				);
				url.searchParams.set("list-type", "2");
				if (continuationToken) {
					url.searchParams.set("continuation-token", continuationToken);
				}
				const response = await fetch(url, {
					headers: await createAuthorization(
						url,
						R2_ACCESS_KEY_ID,
						R2_SECRET_ACCESS_KEY,
						new Date(),
					),
				});
				if (!response.ok) {
					throw new Error(`S3 request failed with status ${response.status}`);
				}
				const page = parsePage(await response.text());
				objects.push(...page.objects);
				continuationToken = page.isTruncated ? page.nextToken : undefined;
				if (page.isTruncated && !continuationToken) {
					throw new Error("S3 response was truncated without a continuation token");
				}
			} while (continuationToken);
		} catch (error) {
			console.error("R2 S3 metrics request failed", error);
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
