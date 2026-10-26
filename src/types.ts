import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];

declare global {
	interface Env {
		HYPERDRIVE: Hyperdrive;
		POSTS_BUCKET: R2Bucket;
	}
}
