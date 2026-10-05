import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis.js";

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

/** Allows at most five login attempts per IP and minute. */
export async function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = `login-attempts:${req.ip}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  if (attempts > MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many login attempts" });
  }
  next();
}
