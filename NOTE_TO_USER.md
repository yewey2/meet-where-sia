# Shared plans: one setup step remains

The collaboration code is designed to work without Google Maps or LTA keys. Exact MRT/LRT station names and Singapore coordinates continue to work with the app's bundled/public data.

## Before shared plans work on Vercel

1. Open the **meet-where-sia** project in Vercel.
2. Go to **Storage** / **Marketplace** and create an **Upstash Redis** database on its free plan.
3. Connect it to this project. Choose a Singapore/nearby region if offered.
4. Confirm Vercel added `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the code also accepts the older `KV_REST_API_URL` / `KV_REST_API_TOKEN` names).
5. Redeploy the project. No values belong in Git and no manual copying into source files is needed.

This store is unavoidable for reliable group editing: Vercel Functions do not provide a durable writable filesystem. Redis is used only for shared-plan JSON, password hashes, short-lived rate limits, and 30-day sessions.

As of 26 July 2026, the Upstash free plan includes 256 MB and 500,000 commands per month. This app combines authenticated reads into one command and checks for friends’ updates every 20 seconds while the page is visible. Free databases may be archived after a period of inactivity; Upstash sends warning emails and provides a restore path from its console.

## How access works

- The plan creator is the owner.
- The owner adds each friend's name and email and assigns a temporary password of at least 10 characters.
- Share the plan link and temporary password privately (different password per person).
- Each friend signs in using their own email and can change their password.
- The owner can rename or delete the plan, add/remove friends, and reset a friend's password.
- Passwords are salted scrypt hashes; plaintext passwords are never stored.

There is deliberately no "password based on email" rule because such passwords are predictable. There is also no email-sending or password-reset provider; owner-managed temporary passwords keep the service footprint to Vercel plus one managed Redis integration.
