import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];

declare global {
	interface Env {
		HYPERDRIVE: Hyperdrive;
		POSTS_BUCKET: R2Bucket;
		R2_ACCOUNT_ID: string;
		R2_API_TOKEN: string;
		R2_BUCKET_NAME: string;
	}
}
