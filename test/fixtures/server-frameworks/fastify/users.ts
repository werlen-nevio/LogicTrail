import type { FastifyInstance } from "fastify";
import { requireAuth } from "./auth";

export default async function users(fastify: FastifyInstance) {
  fastify.get("/:id", { preHandler: [requireAuth] }, getUser);
  fastify.route({ method: ["PUT", "PATCH"], url: "/:id", handler: updateUser });
}

async function getUser(request, reply) {
  return loadUser(request.params.id);
}

async function updateUser(request, reply) {
  return reply.code(204).send();
}

async function loadUser(id: string) {
  return { id };
}
