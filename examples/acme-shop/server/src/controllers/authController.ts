import type { Request, Response } from "express";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
} from "../auth/session.js";
import { verifyPassword } from "../auth/password.js";
import { authEvents } from "../events/bus.js";
import { findUserByEmail, recordFailedLogin, toPublicUser } from "../services/userService.js";

export const authController = {
  /** Authenticates email + password and starts a cookie-based session. */
  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) {
      await recordFailedLogin(email, req.ip);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(email, req.ip);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const session = await createSession(user.id, req.headers["user-agent"]);
    setSessionCookie(res, session.id);
    authEvents.emit("user.loggedIn", { userId: user.id });

    return res.json({ user: toPublicUser(user) });
  },

  async logout(req: Request, res: Response) {
    await destroySession(req.cookies.sid);
    clearSessionCookie(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    res.json({ user: toPublicUser(req.user) });
  },
};
