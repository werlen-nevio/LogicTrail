import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Validates the request body against a zod schema. */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid request", issues: result.error.issues });
    }
    req.body = result.data;
    next();
  };
}
