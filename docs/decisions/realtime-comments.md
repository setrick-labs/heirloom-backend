# Real-time for comments and reactions

**Status:** Decided — stay with polling. Revisit on the trigger below.
**Date:** 2026-08-18

## The question

Comments and reactions are on `staleTime: 0` with refetch-on-focus. Should a
WebSocket or SSE push replace those fetches?

## What's actually here today

- One NestJS instance. `docker-compose.yml` runs Postgres and nothing else —
  no Redis, no broker, no pub/sub of any kind.
- `@nestjs/schedule` is present (the gift-unlock cron). No `@nestjs/websockets`.
- `NotificationService` is a **stub**. No email, no SMS, and no push
  notifications are wired anywhere.
- Family groups are small and bounded, so per-room connection counts would
  genuinely be tiny — the premise in favour of this is sound.

## Decision

Keep polling. Do not build a socket layer yet.

## Why

**1. The connection is asleep exactly when it matters.**
This is the decisive point, and it's specific to mobile rather than a general
argument against sockets. iOS and Android suspend sockets within seconds of
backgrounding. A push channel therefore only delivers while the app is
foregrounded — which means it only helps when two family members are looking
at *the same photo at the same moment*. For a synchronous chat app that's the
common case. For an app whose premise is asynchronous family memory — someone
uploads from a wedding, others react that evening — it's the rare one.

**2. Push notifications are the same feature, and they're not built.**
"Priya commented on your photo" is the thing that actually reaches a family
member, and it works precisely when a socket doesn't. Push subsumes most of
the value here and is a prerequisite for the app regardless. Building sockets
first would be solving the smaller half of the problem, and `NotificationService`
would still be a stub afterwards.

**3. Polling is close to free at this shape.**
Reaction summaries and comment lists for one photo are small payloads, and
they're only fetched for the target currently on screen — not for a whole
grid. The cost of the current approach is a handful of requests per photo
view, not a background poll loop.

**4. A socket layer is not one dependency.**
It's connection lifecycle, an auth handshake that can't reuse the existing
`JwtAuthGuard` unchanged, reconnect/backoff on a flaky mobile network, and —
the moment the API runs on more than one instance — a Redis adapter to route
events between them. That's real infrastructure to carry for a case that
mostly can't fire.

## What we do instead, now

Nothing new. The existing behaviour already covers the realistic cases:

- `staleTime: 0` on `comments` and `reactions` (see `keys.ts`).
- Refetch on focus via `focusManager`, so returning to a photo re-reads it.
- Optimistic mutations (`lib/query/mutations.ts`), which make *your own*
  comment and reaction instant — the latency that users actually feel.

## Revisit when any of these becomes true

- Push notifications are live, and the gap between "notified" and "sees the
  update in-app" is a real complaint.
- A feature ships that is genuinely synchronous — a live "watching together"
  view, or typing indicators.
- Telemetry shows comment/reaction polling is a meaningful share of requests.

## Retrofit cost, so this decision is reversible cheaply

Low, and deliberately kept that way. Everything reads through
`lib/query/options.ts` and writes through `lib/query/mutations.ts`. A push
layer would land as `queryClient.setQueryData` / `invalidateQueries` calls
against the same keys — no screen and no component changes. SSE would be the
first thing to try (one-directional, reuses HTTP auth, no new broker) before
reaching for WebSockets.
