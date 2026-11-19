import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];

declare global {
	interface Env {
		HYPERDRIVE: Hyperdrive;
		POSTS_BUCKET: R2Bucket;
		CLOUDFLARE_ACCOUNT_ID: string;
		CLOUDFLARE_API_TOKEN: string;
	}
}
