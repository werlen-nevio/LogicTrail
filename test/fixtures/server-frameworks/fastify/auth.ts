export async function requireAuth(request, reply) {
  if (!request.headers.authorization) return reply.code(401).send();
}
