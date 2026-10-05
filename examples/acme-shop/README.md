# acme-shop (LogicTrail sample app)

A small but realistic full-stack shop used by LogicTrail's tests and demos:

- `client/` - React + React Router, `fetch` and an `axios` instance
- `server/` - Express API with Prisma, bcrypt sessions, Redis rate limiting,
  Stripe payments and webhooks, a BullMQ email queue, Resend and an event bus

It is static-analysis fixture code: dependencies are not installed and it is
not meant to be run. Try it with:

```bash
npx logictrail "how does login work?" --root examples/acme-shop
npx logictrail "how does checkout work?" --root examples/acme-shop
npx logictrail "what happens when a payment fails?" --root examples/acme-shop
```
