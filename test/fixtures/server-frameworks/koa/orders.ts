import Router from "@koa/router";

const router = new Router();
const guards = [requireUser];

router.get("/:id", requireUser, async (ctx) => {
  ctx.body = await findOrder(ctx.params.id);
});
router.post("/", ...guards, createOrder);

async function requireUser(ctx, next) {
  await next();
}

async function findOrder(id: string) {
  return { id };
}

async function createOrder(ctx) {
  ctx.status = 201;
}

export default router;
