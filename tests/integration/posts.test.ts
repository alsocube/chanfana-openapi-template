import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /posts", () => {
	it("requires all post fields and an image", async () => {
		const formData = new FormData();
		formData.set("title", "Test post");

		const response = await SELF.fetch("http://local.test/posts", {
			method: "POST",
			body: formData,
		});
		const body = await response.json<{ success: boolean; errors: unknown[] }>();

		expect(response.status).toBe(400);
		expect(body.success).toBe(false);
		expect(body.errors).toHaveLength(1);
	});

	it("rejects non-image files", async () => {
		const formData = new FormData();
		formData.set("display_name", "Test user");
		formData.set("title", "Test post");
		formData.set("contents", "Test contents");
		formData.set("file", new File(["text"], "notes.txt", { type: "text/plain" }));

		const response = await SELF.fetch("http://local.test/posts", {
			method: "POST",
			body: formData,
		});

		expect(response.status).toBe(415);
	});

	it("rejects images larger than 10 MiB", async () => {
		const formData = new FormData();
		formData.set("display_name", "Test user");
		formData.set("title", "Test post");
		formData.set("contents", "Test contents");
		formData.set(
			"file",
			new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
				type: "image/png",
			}),
		);

		const response = await SELF.fetch("http://local.test/posts", {
			method: "POST",
			body: formData,
		});

		expect(response.status).toBe(413);
	});
});
