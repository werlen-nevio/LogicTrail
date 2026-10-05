import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  logger.error(err);
  res.status(500).json({ error: "Internal server error" });
}
