import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createPostImagePath } from "../../src/endpoints/posts";

describe("post image paths", () => {
	it("uses the generated filename in the R2 key and CDN URL", () => {
		const imagePath = createPostImagePath("original.PNG");

		expect(imagePath.fileName).toMatch(/^[0-9a-f-]+\.png$/);
		expect(imagePath.objectKey).toBe(`posts/${imagePath.fileName}`);
		expect(imagePath.filePath).toBe(
			`https://cdn.simplycms.my.id/${imagePath.objectKey}`,
		);
	});
});

describe("POST /posts", () => {
	it("allows contents to be omitted", async () => {
		const formData = new FormData();
		formData.set("display_name", "Test user");
		formData.set("title", "Test post");
		formData.set("file", new File(["image"], "image.png", { type: "image/png" }));

		const response = await SELF.fetch("http://local.test/posts", {
			method: "POST",
			body: formData,
		});

		expect(response.status).toBe(201);
	});

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
