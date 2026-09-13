# Making rules fire with the tab closed

Everything below exists for one sentence: **a stop you set on your laptop
should fire while the laptop is shut.**

That cannot be done from a browser, and it cannot be done from a dev server on
your machine. It needs three things that are always on: somewhere to keep the
rules, somewhere to run the code, and something to poke it on a schedule. All
three are free.

---

## 1. A database — Neon

1. Go to **neon.tech**, sign in, create a project. Free tier.
2. Copy the **pooled** connection string. It looks like
   `postgresql://user:pass@ep-something-pooler.region.aws.neon.tech/neondb?sslmode=require`
3. Put it in `apps/web/.env.local`:

       DATABASE_URL=postgresql://...

4. Create the tables, once:

       psql "$DATABASE_URL" -f apps/web/lib/db/schema.sql

   No `psql`? Paste the contents of that file into Neon's SQL Editor in the
   browser and run it.

**Until this exists nothing changes.** cipher keeps rules in the browser and
watches them in the open tab, exactly as before, and says so on every rule.

## 2. A password for the worker

`/api/tick` is the endpoint that executes trades. It **refuses every request**
until this is set — an open endpoint that trades is not a thing to ship by
accident.

    CRON_SECRET=<a long random string>

Generate one with `openssl rand -hex 32`, or any password manager.

## 3. Somewhere always on — Vercel

1. Push this repo to GitHub.
2. **vercel.com** → New Project → import the repo. It detects Next.js.
3. Add every variable from `apps/web/.env.local` in Vercel's
   Settings → Environment Variables:

       NEXT_PUBLIC_PRIVY_APP_ID
       PRIVY_APP_SECRET
       DATABASE_URL
       CRON_SECRET
       ANTHROPIC_API_KEY        (optional — the model fallback)

4. Deploy. Note the URL, e.g. `https://cipher.vercel.app`.
5. In the **Privy dashboard**, add that URL to the allowed domains, or Google
   sign-in will fail on it.

## 4. Something to poke it — the schedule

`vercel.json` has a daily cron as a backstop. **Vercel's free plan allows one
cron per day**, which is useless for a stop loss, so the real schedule comes
from outside.

**cron-job.org** — free, one-minute resolution:

- URL: `https://your-app.vercel.app/api/tick`
- Schedule: every 1 minute
- Method: GET
- Header: `Authorization: Bearer <your CRON_SECRET>`

Cloudflare Workers' Cron Triggers do the same thing on their free plan if you
prefer to keep it in one account.

---

## What you get, and what you do not

**Get:** a rule armed on any device fires within a minute of its price,
whether or not anything is open. The Alerts panel says *"Watched on the
server, tab open or not."* Fills appear on every device.

**Do not:** second-by-second firing. The worker samples once a minute, so a
rule fires within a minute of its price rather than within a second. That is
honest for majors and wrong for a token launch, where a minute is the whole
move. The upgrade is a Cloudflare Durable Object holding a live websocket and
calling the same `/api/tick` logic on every tick — the engine, the execution
seam and the queries do not change, only what invokes them.

**And when the worker stops**, the Alerts panel says *"Rules are not being
watched right now"* rather than going quiet. It reads the heartbeat the worker
writes on every run. Uptime cannot be promised, so it is reported.

---

## Checking it works

    curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/tick

Expect `{"ok":true,"markets":0,"fired":[],...}` on an empty database. Arm a
rule in the app, close every tab, wait a minute, run it again — `fired` should
name the rule, and the fill is there when you open the app on any device.
