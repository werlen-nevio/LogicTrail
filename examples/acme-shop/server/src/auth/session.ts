import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { db } from "../lib/db.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/** Creates a session record that expires after two weeks. */
export async function createSession(userId: string, userAgent?: string) {
  const id = randomBytes(32).toString("hex");
  return db.session.create({
    data: { id, userId, userAgent, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

export async function destroySession(sessionId: string) {
  await db.session.delete({ where: { id: sessionId } });
}

/** Writes the session id to an HTTP-only cookie. */
export function setSessionCookie(res: Response, sessionId: string) {
  res.cookie("sid", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("sid");
}
