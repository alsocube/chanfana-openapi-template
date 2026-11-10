import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = path.join(__dirname, "..", "migrations");
const migrations = await readD1Migrations(migrationsPath);

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: "./wrangler.jsonc",
			},
			miniflare: {
				compatibilityFlags: ["experimental", "nodejs_compat"],
				bindings: {
					MIGRATIONS: migrations,
					R2_ACCOUNT_ID: "test-account",
					R2_ACCESS_KEY_ID: "test-access-key",
					R2_SECRET_ACCESS_KEY: "test-secret-key",
					R2_BUCKET_NAME: "test-bucket",
					CLOUDFLARE_ACCOUNT_ID: "test-account-id",
					CLOUDFLARE_API_TOKEN: "test-api-token",
				},
			},
		}),
	],
	esbuild: {
		target: "esnext",
	},
	test: {
		setupFiles: ["./tests/apply-migrations.ts"],
	},
});
