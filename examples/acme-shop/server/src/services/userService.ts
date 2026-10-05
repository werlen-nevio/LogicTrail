import { db } from "../lib/db.js";

export interface PublicUser {
  id: string;
  email: string;
}

/** Looks up a user by their (case-insensitive) email address. */
export async function findUserByEmail(email: string) {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

/** Stores a failed login attempt so rate limiting and audits can see it. */
export async function recordFailedLogin(email: string, ip?: string) {
  await db.loginAttempt.create({ data: { email, ip } });
}

export function toPublicUser(user: { id: string; email: string }): PublicUser {
  return { id: user.id, email: user.email };
}
