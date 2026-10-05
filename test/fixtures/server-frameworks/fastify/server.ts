import Fastify from "fastify";
import users from "./users";

const app = Fastify({ logger: true });

app.get("/health", async (request, reply) => ({ ok: true }));
app.register(users, { prefix: "/api/users" });
app.register(
  async (instance) => {
    instance.post("/login", login);
  },
  { prefix: "/api/auth" },
);

async function login(request, reply) {
  return reply.send({ token: "demo" });
}
