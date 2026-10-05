import bcrypt from "bcrypt";

const ROUNDS = 12;

/** Compares a plain-text password with the stored bcrypt hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}
