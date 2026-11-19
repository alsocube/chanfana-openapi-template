import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const POSTS_CDN_URL = "https://cdn.simplycms.my.id";

export function createPostImagePath(originalFileName: string) {
	const extension =
		originalFileName.match(/\.[a-z0-9]{1,10}$/i)?.[0].toLowerCase() ?? "";
	const fileName = `${crypto.randomUUID()}${extension}`;
	const objectKey = `posts/${fileName}`;

	return {
		fileName,
		objectKey,
		filePath: `${POSTS_CDN_URL}/${objectKey}`,
	};
}

export class DeletePostEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Posts"],
		summary: "Delete a post",
		operationId: "delete-post",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							post_id: z.number().int().positive(),
						}),
					},
				},
			},
		},
		responses: {
			"204": { description: "Post deleted" },
			"400": { description: "Missing or invalid post_id" },
			"404": { description: "Post not found" },
		},
	};

	public async handle(c: AppContext) {
		let body: { post_id?: unknown };
		try {
			body = await c.req.json<{ post_id?: unknown }>();
		} catch {
			return requestError(c, 400, "Expected a JSON body with a positive post_id");
		}

		const postId = z.number().int().positive().safeParse(body.post_id);
		if (!postId.success) {
			return requestError(c, 400, "post_id must be a positive integer");
		}

		const { Client } = await import("pg");
		const client = new Client({
			connectionString: c.env.HYPERDRIVE.connectionString,
		});

		try {
			await client.connect();
			await client.query("BEGIN");
			const { rows } = await client.query(
				"SELECT file_name FROM public.cms_posts WHERE post_id = $1 FOR UPDATE",
				[postId.data],
			);

			if (!rows[0]) {
				await client.query("ROLLBACK");
				return c.json(
					{
						success: false,
						errors: [{ code: 404, message: "Post not found" }],
					},
					404,
				);
			}

			const fileName = rows[0].file_name;
			if (typeof fileName === "string" && fileName) {
				await c.env.POSTS_BUCKET.delete(`posts/${fileName}`);
			}
			await client.query("DELETE FROM public.cms_posts WHERE post_id = $1", [
				postId.data,
			]);
			await client.query("COMMIT");
			return new Response(null, { status: 204 });
		} catch (error) {
			try {
				await client.query("ROLLBACK");
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					"Post deletion failed and the transaction could not be rolled back",
				);
			}
			throw error;
		} finally {
			await client.end();
		}
	}
}

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

export class UpdatePostEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Posts"],
		summary: "Update a post",
		operationId: "update-post",
		request: {
			body: {
				description: "Post fields and an optional replacement image",
				content: {
					"multipart/form-data": {
						schema: {
							type: "object" as const,
							properties: {
								post_id: { type: "string" as const },
								display_name: { type: "string" as const },
								title: { type: "string" as const },
								contents: { type: "string" as const, nullable: true },
								file: {
									type: "string" as const,
									format: "binary" as const,
									description: "Replacement raster image up to 10 MiB",
								},
							},
							required: ["post_id"],
						},
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Post updated",
				...contentJson(postSchema),
			},
			"400": { description: "Missing or invalid multipart fields" },
			"404": { description: "Post not found" },
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

		const postIdValue = formData.get("post_id");
		const displayNameValue = formData.get("display_name");
		const titleValue = formData.get("title");
		const contentsValue = formData.get("contents");
		const uploadedFile = formData.get("file");

		const postId = z.coerce
			.number()
			.int()
			.positive()
			.safeParse(postIdValue);
		if (!postId.success) {
			return requestError(c, 400, "post_id must be a positive integer");
		}

		const displayName =
			displayNameValue === null ? undefined : displayNameValue;
		const title = titleValue === null ? undefined : titleValue;
		const contents =
			contentsValue === null ? undefined : contentsValue;

		if (
			(displayName !== undefined &&
				(typeof displayName !== "string" || !displayName.trim())) ||
			(title !== undefined &&
				(typeof title !== "string" || !title.trim())) ||
			(contents !== undefined && typeof contents !== "string")
		) {
			return requestError(
				c,
				400,
				"display_name, title, and contents must be strings when provided",
			);
		}
		if (
			displayName !== undefined &&
			typeof displayName === "string" &&
			!displayName.trim()
		) {
			return requestError(c, 400, "display_name must not be empty");
		}
		if (
			title !== undefined &&
			typeof title === "string" &&
			!title.trim()
		) {
			return requestError(c, 400, "title must not be empty");
		}

		if (
			displayName === undefined &&
			title === undefined &&
			contents === undefined &&
			!(uploadedFile instanceof File)
		) {
			return requestError(c, 400, "Provide at least one field or image to update");
		}

		let replacement:
			| { fileName: string; objectKey: string; filePath: string; file: File }
			| undefined;
		if (uploadedFile !== null) {
			if (!(uploadedFile instanceof File) || !uploadedFile.name) {
				return requestError(c, 400, "Uploaded file must be a valid image");
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
			replacement = {
				...createPostImagePath(uploadedFile.name),
				file: uploadedFile,
			};
		}

		const { Client } = await import("pg");
		const client = new Client({
			connectionString: c.env.HYPERDRIVE.connectionString,
		});
		let replacementUploaded = false;
		let committed = false;

		try {
			await client.connect();
			await client.query("BEGIN");
			const { rows: existingRows } = await client.query(
				`
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
					WHERE post_id = $1
					FOR UPDATE
				`,
				[postId.data],
			);

			if (!existingRows[0]) {
				await client.query("ROLLBACK");
				return c.json(
					{
						success: false,
						errors: [{ code: 404, message: "Post not found" }],
					},
					404,
				);
			}

			if (replacement) {
				await c.env.POSTS_BUCKET.put(
					replacement.objectKey,
					replacement.file.stream(),
					{ httpMetadata: { contentType: replacement.file.type.toLowerCase() } },
				);
				replacementUploaded = true;
			}

			const { rows } = await client.query(
				`
					UPDATE public.cms_posts
					SET
						display_name = COALESCE($2, display_name),
						title = COALESCE($3, title),
						contents = CASE WHEN $7 THEN NULLIF($4, '') ELSE contents END,
						file_path = COALESCE($5, file_path),
						file_name = COALESCE($6, file_name),
						updated_at = NOW()
					WHERE post_id = $1
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
					postId.data,
					displayName,
					title,
					contents,
					replacement?.filePath,
					replacement?.fileName,
					contents !== undefined,
				],
			);

			if (!rows[0]) {
				throw new Error("Post update did not return an updated record");
			}

			await client.query("COMMIT");
			committed = true;

			if (
				replacement &&
				typeof existingRows[0].file_name === "string" &&
				existingRows[0].file_name &&
				existingRows[0].file_name !== replacement.fileName
			) {
				try {
					await c.env.POSTS_BUCKET.delete(`posts/${existingRows[0].file_name}`);
				} catch (cleanupError) {
					console.warn(
						"Post updated but the previous image could not be removed",
						cleanupError,
					);
				}
			}

			return c.json(rows[0], 200);
		} catch (error) {
			if (!committed) {
				try {
					await client.query("ROLLBACK");
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						"Post update failed and the transaction could not be rolled back",
					);
				}
			}
			if (replacementUploaded && replacement) {
				try {
					await c.env.POSTS_BUCKET.delete(replacement.objectKey);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						"Post update failed and the uploaded image could not be removed",
					);
				}
			}
			throw error;
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
								contents: { type: "string" as const, nullable: true },
								file: {
									type: "string" as const,
									format: "binary" as const,
									description: "Image file up to 10 MiB",
								},
							},
							required: ["display_name", "title", "file"],
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
				(contents !== null &&
					(typeof contents !== "string" || !contents.trim())) ||
			!(uploadedFile instanceof File) ||
			!uploadedFile.name
		) {
			return requestError(
				c,
				400,
				"Required fields are display_name, title, and file; contents may be null",
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

		const { fileName, objectKey, filePath } = createPostImagePath(
			uploadedFile.name,
		);
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
					filePath,
					fileName,
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
