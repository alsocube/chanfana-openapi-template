import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];

declare global {
	interface Env {
		HYPERDRIVE: Hyperdrive;
		POSTS_BUCKET: R2Bucket;
		R2_ACCOUNT_ID: string;
		R2_ACCESS_KEY_ID: string;
		R2_SECRET_ACCESS_KEY: string;
		R2_BUCKET_NAME: string;
	}
}
