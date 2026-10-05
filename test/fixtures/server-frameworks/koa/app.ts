import Koa from "koa";
import Router from "@koa/router";
import orders from "./orders";

const app = new Koa();
const api = new Router({ prefix: "/shop" });

api.use("/orders", orders.routes(), orders.allowedMethods());
app.use(api.routes());
