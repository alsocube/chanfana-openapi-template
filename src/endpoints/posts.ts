import { contentJson, OpenAPIRoute } from "chanfana";
import postgres from "postgres";
import { z } from "zod";
import { AppContext } from "../types";

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

type Post = z.infer<typeof postSchema>;

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
		const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 1 });

		try {
			const posts = await sql<Post[]>`
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
				FROM public.posts
			`;

			return posts;
		} finally {
			await sql.end({ timeout: 5 });
		}
	}
}
