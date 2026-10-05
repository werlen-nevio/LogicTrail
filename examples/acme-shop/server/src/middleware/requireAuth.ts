import type { NextFunction, Request, Response } from "express";
import { db } from "../lib/db.js";

/** Rejects requests without a valid session cookie. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies.sid;
  const session = sessionId
    ? await db.session.findUnique({ where: { id: sessionId }, include: { user: true } })
    : null;
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: "Not signed in" });
  }
  req.user = session.user;
  next();
}
