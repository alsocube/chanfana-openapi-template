import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const postSchema = z.object({
	post_id: z.unknown(),
	user_id: z.unknown(),
	display_name: z.unknown(),
	title: z.unknown(),
	contents: z.unknown(),
	created_at: z.unknown(),
	file_path: z.unknown(),
	updated_at: z.unknown(),
	file_name: z.unknown(),
});

function requestError(
	c: AppContext,
	status: 400 | 413 | 415,
	message: string,
) {
	return c.json(
		{
			success: false,
			errors: [{ code: status, message }],
		},
		status,
	);
}

export class PostsEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Posts"],
		summary: "List posts",
		operationId: "list-posts",
		responses: {
			"200": {
				description: "Posts from the PostgreSQL database",
				...contentJson(z.array(postSchema)),
			},
		},
	};

	public async handle(c: AppContext) {
		const { Client } = await import("pg");
		const client = new Client({
			connectionString: c.env.HYPERDRIVE.connectionString,
		});

		try {
			await client.connect();
			const { rows } = await client.query(`
				SELECT
					post_id,
					user_id,
					display_name,
					title,
					contents,
					created_at,
					file_path,
					updated_at,
					file_name
				FROM public.cms_posts
			`);

			return rows;
		} finally {
			await client.end();
		}
	}
}

export class CreatePostEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Posts"],
		summary: "Create a post with an image upload",
		operationId: "create-post",
		request: {
			body: {
				description: "Post fields and an image uploaded as multipart form data",
				content: {
					"multipart/form-data": {
						schema: {
							type: "object" as const,
							properties: {
								display_name: { type: "string" as const },
								title: { type: "string" as const },
								contents: { type: "string" as const },
								file: {
									type: "string" as const,
									format: "binary" as const,
									description: "Image file up to 10 MiB",
								},
							},
							required: ["display_name", "title", "contents", "file"],
						},
					},
				},
			},
		},
		responses: {
			"201": {
				description: "Post created",
				...contentJson(postSchema),
			},
			"400": { description: "Missing or invalid multipart fields" },
			"413": { description: "Image exceeds the 10 MiB size limit" },
			"415": { description: "Uploaded file is not a supported image" },
		},
	};

	public async handle(c: AppContext) {
		let formData: FormData;
		try {
			formData = await c.req.formData();
		} catch {
			return requestError(c, 400, "Expected multipart form data");
		}

		const displayName = formData.get("display_name");
		const title = formData.get("title");
		const contents = formData.get("contents");
		const uploadedFile = formData.get("file");

		if (
			typeof displayName !== "string" ||
			!displayName.trim() ||
			typeof title !== "string" ||
			!title.trim() ||
			typeof contents !== "string" ||
			!contents.trim() ||
			!(uploadedFile instanceof File) ||
			!uploadedFile.name
		) {
			return requestError(
				c,
				400,
				"Required fields are display_name, title, contents, and file",
			);
		}

		if (uploadedFile.size === 0) {
			return requestError(c, 400, "Uploaded image must not be empty");
		}
		if (uploadedFile.size > MAX_FILE_SIZE) {
			return requestError(c, 413, "Image must be 10 MiB or smaller");
		}
		const contentType = uploadedFile.type.toLowerCase();
		if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
			return requestError(c, 415, "Only raster image files are supported");
		}

		const objectKey = `posts/${crypto.randomUUID()}`;
		const { Client } = await import("pg");
		const client = new Client({
			connectionString: c.env.HYPERDRIVE.connectionString,
		});
		let objectUploaded = false;

		try {
			await client.connect();
			await c.env.POSTS_BUCKET.put(objectKey, uploadedFile.stream(), {
				httpMetadata: { contentType },
			});
			objectUploaded = true;

			const { rows } = await client.query(
				`
					INSERT INTO public.cms_posts (
						user_id,
						display_name,
						title,
						contents,
						file_path,
						file_name,
						created_at,
						updated_at
					)
					VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
					RETURNING
						post_id,
						user_id,
						display_name,
						title,
						contents,
						created_at,
						file_path,
						updated_at,
						file_name
				`,
				[
					1999,
					displayName,
					title,
					contents,
					objectKey,
					uploadedFile.name,
				],
			);

			if (!rows[0]) {
				throw new Error("Post insert did not return a created record");
			}

			return c.json(rows[0], 201);
		} catch (error) {
			if (objectUploaded) {
				try {
					await c.env.POSTS_BUCKET.delete(objectKey);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						"Post creation failed and the uploaded image could not be removed",
					);
				}
			}
			throw error;
		} finally {
			await client.end();
		}
	}
}
