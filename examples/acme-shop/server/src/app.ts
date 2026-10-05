import express from "express";
import authRouter from "./routes/auth.js";
import ordersRouter from "./routes/orders.js";
import productsRouter from "./routes/products.js";
import webhooksRouter from "./routes/webhooks.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.use("/api/webhooks", webhooksRouter);
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/orders", requireAuth, ordersRouter);
app.use("/api/products", productsRouter);
app.use(errorHandler);
