# OpenAPI Template

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/chanfana-openapi-template)

![OpenAPI Template Preview](https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/91076b39-1f5b-46f6-7f14-536a6f183000/public)

<!-- dash-content-start -->

This is a Cloudflare Worker with OpenAPI 3.1 Auto Generation and Validation using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is an example project made to be used as a quick start into building OpenAPI compliant Workers that generates the
`openapi.json` schema automatically from code and validates the incoming request to the defined parameters or request body.

This template includes various endpoints, a D1 database, and integration tests using [Vitest](https://vitest.dev/) as examples. In endpoints, you will find [chanfana D1 AutoEndpoints](https://chanfana.com/endpoints/auto/d1) and a [normal endpoint](https://chanfana.com/endpoints/defining-endpoints) to serve as examples for your projects.

Besides being able to see the OpenAPI schema (openapi.json) in the browser, you can also extract the schema locally no hassle by running this command `npm run schema`.

<!-- dash-content-end -->

> [!IMPORTANT]
> When using C3 to create this project, select "no" when it asks if you want to deploy. You need to follow this project's [setup steps](https://github.com/cloudflare/templates/tree/main/openapi-template#setup-steps) before deploying.

## Getting Started

Outside of this repo, you can start a new project with this template using [C3](https://developers.cloudflare.com/pages/get-started/c3/) (the `create-cloudflare` CLI):

```bash
npm create cloudflare@latest -- --template=cloudflare/templates/openapi-template
```

A live public deployment of this template is available at [https://openapi-template.templates.workers.dev](https://openapi-template.templates.workers.dev)

## Setup Steps

1. Install the project dependencies with a package manager of your choice:
   ```bash
   npm install
   ```
2. Create a [D1 database](https://developers.cloudflare.com/d1/get-started/) with the name "openapi-template-db":
   ```bash
   npx wrangler d1 create openapi-template-db
   ```
   ...and update the `database_id` field in `wrangler.json` with the new database ID.
3. Run the following db migration to initialize the database (notice the `migrations` directory in this project):
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```
4. Deploy the project!
   ```bash
   npx wrangler deploy
   ```
5. Monitor your worker
   ```bash
   npx wrangler tail
   ```

## Posts endpoint

`GET /posts` reads posts from the `public.cms_posts` PostgreSQL table and returns a JSON array containing `post_id`, `user_id`, `display_name`, `title`, `contents`, `created_at`, `file_path`, `updated_at`, and `file_name`.

`POST /posts` accepts `multipart/form-data` with required `display_name`, `title`, `contents`, and `file` fields. It stores raster images up to 10 MiB in the `POSTS_BUCKET` R2 bucket under `posts/<generated-filename>`, preserving the uploaded file's extension. The `public.cms_posts` record uses the same generated basename for `file_name` and stores the full `https://cdn.simplycms.my.id/posts/<generated-filename>` URL in `file_path`; `user_id` is set to `1999`. The API returns the created post with status `201`.

`DELETE /posts` accepts a JSON body containing a positive integer `post_id`, removes the post and its image, and returns `204` when successful.

All API routes allow cross-origin browser requests from `https://www.simplycms.my.id` for `GET`, `POST`, and `DELETE` requests. `OPTIONS` preflight requests return `204` with the CORS headers. Other origins are not allowed.

## Login endpoint

`POST /login` accepts JSON containing either `email` or `username`, plus `password`. It authenticates the supplied identifier against `public.cms_users` and returns `user_id`, `username`, `email`, `remember_token`, and `access`.

Create the R2 bucket before deploying:

```bash
npx wrangler r2 bucket create simplycms
```

The R2 bucket binding is configured in `wrangler.jsonc` as `POSTS_BUCKET` and targets the `simplycms` bucket.

The Worker uses the `pg` client and connects to Supabase PostgreSQL through Cloudflare Hyperdrive. Create a Hyperdrive configuration with the Supabase connection string (use the actual database password; do not commit it), then add the returned ID to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "<your-hyperdrive-id>"
  }
]
```

The connection string should use the Supabase pooler host and database shown in your Supabase project settings. The checked-in `localConnectionString` is a development default for a local PostgreSQL instance; override it with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` if your local database uses a different connection string.

## Testing

This template includes integration tests using [Vitest](https://vitest.dev/). To run the tests locally:

```bash
npm run test
```

Test files are located in the `tests/` directory, with examples demonstrating how to test your endpoints and database interactions.

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. Integration tests are located in the `tests/` directory.
4. For more information read the [chanfana documentation](https://chanfana.com/), [Hono documentation](https://hono.dev/docs), and [Vitest documentation](https://vitest.dev/guide/).
