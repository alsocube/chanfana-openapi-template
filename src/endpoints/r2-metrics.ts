import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const metricsSchema = z.object({
	success: z.boolean(),
	result: z.object({
		objectCount: z.number(),
		payloadSize: z.number(),
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

function parsePage(xml: string) {
	const sizes = [...xml.matchAll(/<Contents>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)].map(
		(match) => Number(match[1]),
	);
	const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
	const nextToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
	return { objectCount: sizes.length, payloadSize: sizes.reduce((sum, size) => sum + size, 0), isTruncated, nextToken };
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

		let objectCount = 0;
		let payloadSize = 0;
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
				objectCount += page.objectCount;
				payloadSize += page.payloadSize;
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

		return c.json(
			{
				success: true,
				result: { objectCount, payloadSize },
				errors: [],
				messages: [],
			},
			200,
		);
	}
}
