import { Hono } from "hono";
import books from "./books";

const app = new Hono().basePath("/v1");

app.use("*", timing);
app.get("/status", (c) => c.json({ ok: true }));
app.route("/books", books);

async function timing(c, next) {
  await next();
}

export default app;
