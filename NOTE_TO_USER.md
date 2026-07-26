# Shared plans: one setup step remains

The collaboration code is designed to work without Google Maps or LTA keys. Exact MRT/LRT station names and Singapore coordinates continue to work with the app's bundled/public data.

## Before shared plans work on Vercel

1. Open the **meet-where-sia** project in Vercel.
2. Go to **Storage** / **Marketplace** and create an **Upstash Redis** database on its free plan.
3. Connect it to this project. Choose a Singapore/nearby region if offered.
4. Confirm Vercel added a REST URL and matching writable REST token. The code accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_KV_REST_API_URL` / `UPSTASH_REDIS_KV_REST_API_TOKEN`, and the older `KV_REST_API_URL` / `KV_REST_API_TOKEN` names.

   The read-only token and Redis-protocol URL are not substitutes: shared plans need Redis write operations.
5. Redeploy the project. No values belong in Git and no manual copying into source files is needed.

This store is unavoidable for reliable group editing: Vercel Functions do not provide a durable writable filesystem. Redis is used only for shared-plan JSON, password hashes, short-lived rate limits, and 30-day sessions.

As of 26 July 2026, the Upstash free plan includes 256 MB and 500,000 commands per month. This app combines authenticated reads into one command and checks for friends’ updates every 20 seconds while the page is visible. Free databases may be archived after a period of inactivity; Upstash sends warning emails and provides a restore path from its console.

## How access works

- The plan creator is the owner.
- Anyone with the shared link can view participant names and locations without signing in.
- Friends can join with a username and password of at least 6 characters; joining creates exactly one participant that only they can edit.
- If the owner already added a participant, the owner can explicitly attach a username and temporary password to that participant.
- Friends never need to provide an email address.
- The owner can rename or delete the plan, add/remove participants, open or close self-joining, create/remove contributor access, and reset passwords.
- Passwords remain salted scrypt hashes; plaintext passwords are never stored.

A shared link is intentionally a public read-only link, so it should stay within the intended group. Prefer MRT stations or approximate locations rather than home addresses. There is no email-sending or password-reset provider; owner-managed temporary passwords keep the service footprint to Vercel plus one managed Redis integration.
