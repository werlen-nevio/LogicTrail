import { app } from "./app.js";
import "./events/handlers.js";
import "./jobs/emailWorker.js";
import { logger } from "./lib/logger.js";

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  logger.info(`acme-shop API listening on :${port}`);
});
