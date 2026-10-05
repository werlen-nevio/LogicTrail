import { Hono } from "hono";

const books = new Hono();

books.get("/", listBooks);
books.post("/:id/reviews", validateReview, (c) => saveReview(c));

function listBooks(c) {
  return c.json([]);
}

async function validateReview(c, next) {
  await next();
}

async function saveReview(c) {
  return c.json({ saved: true }, 201);
}

export default books;
