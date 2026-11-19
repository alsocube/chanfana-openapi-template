import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createPostImagePath } from "../../src/endpoints/posts";

const FRONTEND_ORIGIN = "https://www.simplycms.my.id";

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

describe("CORS for /posts", () => {
	it("allows the frontend origin on GET and POST responses", async () => {
		const getResponse = await SELF.fetch("http://local.test/posts", {
			headers: { Origin: FRONTEND_ORIGIN },
		});
		const postResponse = await SELF.fetch("http://local.test/posts", {
			method: "POST",
			headers: { Origin: FRONTEND_ORIGIN },
			body: new FormData(),
		});
		const putResponse = await SELF.fetch("http://local.test/posts", {
			method: "PUT",
			headers: { Origin: FRONTEND_ORIGIN },
			body: new FormData(),
		});

		expect(getResponse.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
		);
		expect(postResponse.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
		);
		expect(putResponse.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
		);
	});

	it("handles POST and PUT preflight requests for the frontend origin", async () => {
		const response = await SELF.fetch("http://local.test/posts", {
			method: "OPTIONS",
			headers: {
				Origin: FRONTEND_ORIGIN,
				"Access-Control-Request-Method": "PUT",
				"Access-Control-Request-Headers": "content-type",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
		);
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
			"PUT",
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
			"Content-Type",
		);
	});

	it("does not grant CORS access to other origins", async () => {
		const response = await SELF.fetch("http://local.test/posts", {
			method: "OPTIONS",
			headers: {
				Origin: "https://other.example",
				"Access-Control-Request-Method": "GET",
			},
		});

		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
	});
});

describe("CORS for all routes", () => {
	it("handles login preflight requests for the frontend origin", async () => {
		const response = await SELF.fetch("http://local.test/login", {
			method: "OPTIONS",
			headers: {
				Origin: FRONTEND_ORIGIN,
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
		);
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
			"POST",
		);
	});

	it("adds CORS headers to login responses", async () => {
		const response = await SELF.fetch("http://local.test/login", {
			method: "POST",
			headers: {
				Origin: FRONTEND_ORIGIN,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "missing@example.com", password: "secret" }),
		});

		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			FRONTEND_ORIGIN,
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

describe("PUT /posts", () => {
	it("requires a positive post_id", async () => {
		const formData = new FormData();
		formData.set("post_id", "0");
		formData.set("title", "Updated post");

		const response = await SELF.fetch("http://local.test/posts", {
			method: "PUT",
			body: formData,
		});
		const body = await response.json<{ success: boolean; errors: unknown[] }>();

		expect(response.status).toBe(400);
		expect(body.success).toBe(false);
		expect(body.errors).toHaveLength(1);
	});

	it("requires at least one field or image to update", async () => {
		const formData = new FormData();
		formData.set("post_id", "1");

		const response = await SELF.fetch("http://local.test/posts", {
			method: "PUT",
			body: formData,
		});

		expect(response.status).toBe(400);
	});

	it("rejects non-image replacement files", async () => {
		const formData = new FormData();
		formData.set("post_id", "1");
		formData.set("file", new File(["text"], "notes.txt", { type: "text/plain" }));

		const response = await SELF.fetch("http://local.test/posts", {
			method: "PUT",
			body: formData,
		});

		expect(response.status).toBe(415);
	});

	it("rejects replacement images larger than 10 MiB", async () => {
		const formData = new FormData();
		formData.set("post_id", "1");
		formData.set(
			"file",
			new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
				type: "image/png",
			}),
		);

		const response = await SELF.fetch("http://local.test/posts", {
			method: "PUT",
			body: formData,
		});

		expect(response.status).toBe(413);
	});
});
