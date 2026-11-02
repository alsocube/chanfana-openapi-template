import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

const loginRequestSchema = z.object({
	email: z.string().email().optional(),
	username: z.string().min(1).optional(),
	password: z.string().min(1),
}).refine((value) => value.email || value.username, {
	message: "email or username is required",
});

const loginResponseSchema = z.object({
	user_id: z.unknown(),
	username: z.unknown(),
	email: z.unknown(),
	remember_token: z.unknown(),
	access: z.unknown(),
});

export class LoginEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Authentication"],
		summary: "Log in",
		operationId: "login",
		request: {
			body: {
				content: {
					"application/json": {
						schema: loginRequestSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Authenticated user",
				...contentJson(loginResponseSchema),
			},
			"400": { description: "Invalid login request" },
			"401": { description: "Invalid credentials" },
		},
	};

	public async handle(c: AppContext) {
		let requestBody: unknown;
		try {
			requestBody = await c.req.json();
		} catch {
			return c.json(
				{
					success: false,
					errors: [{ code: 400, message: "Expected a JSON body" }],
				},
				400,
			);
		}

		const parsedRequest = loginRequestSchema.safeParse(requestBody);
		if (!parsedRequest.success) {
			return c.json(
				{
					success: false,
					errors: [{ code: 400, message: "email or username and password are required" }],
				},
				400,
			);
		}

		const identifier = parsedRequest.data.email ?? parsedRequest.data.username;
		const identifierColumn = parsedRequest.data.email ? "email" : "username";
		const { Client } = await import("pg");
		const client = new Client({
			connectionString: c.env.HYPERDRIVE.connectionString,
		});

		try {
			await client.connect();
			const { rows } = await client.query(
				`
					SELECT user_id, username, email, remember_token, access
					FROM public.cms_users
					WHERE ${identifierColumn} = $1 AND password = $2
					LIMIT 1
				`,
				[identifier, parsedRequest.data.password],
			);

			if (!rows[0]) {
				return c.json(
					{
						success: false,
						errors: [{ code: 401, message: "Invalid credentials" }],
					},
					401,
				);
			}

			const user = rows[0];
			if (!user.remember_token) {
				user.remember_token = crypto.randomUUID();
				await client.query(
					"UPDATE public.cms_users SET remember_token = $1 WHERE user_id = $2",
					[user.remember_token, user.user_id],
				);
			}

			return c.json(
				{
					user_id: user.user_id,
					username: user.username,
					email: user.email,
					remember_token: user.remember_token,
					access: user.access,
				},
				200,
			);
		} finally {
			await client.end();
		}
	}
}
