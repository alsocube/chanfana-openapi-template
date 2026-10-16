import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

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
