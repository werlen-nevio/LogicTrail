import { describe, expect, it } from "vitest";
import { buildCodeGraph } from "../src/analysis/code-graph.js";
import { Workspace } from "../src/analysis/workspace.js";
import { facts } from "./helpers.js";

/** Builds a one-file workspace and returns `kind:label` for every edge leaving `run()`. */
function classify(code: string, file = "src/run.ts"): string[] {
  const workspace = new Workspace([facts(code, file)], "/repo");
  const graph = buildCodeGraph(workspace);
  const run = [...graph.nodes.values()].find((node) => node.name === "run");
  if (!run) throw new Error("fixture must define run()");
  return graph
    .out(run.id)
    .map((edge) => `${edge.kind}:${graph.nodes.get(edge.to)?.label ?? edge.to}`);
}

describe("database adapters", () => {
  it("mongoose models", () => {
    expect(
      classify(`
        import mongoose from "mongoose";
        const User = mongoose.model("User", new mongoose.Schema({}));
        export async function run() { await User.findOne({}); await User.create({}); }
      `),
    ).toEqual(["reads:User.findOne", "writes:User.create"]);
  });

  it("sequelize define and class models", () => {
    expect(
      classify(`
        import { Sequelize, Model } from "sequelize";
        const sequelize = new Sequelize("sqlite::memory:");
        const Invoice = sequelize.define("Invoice", {});
        class Customer extends Model {}
        export async function run() { await Invoice.findAll(); await Customer.destroy({ where: {} }); }
      `),
    ).toEqual(["reads:Invoice.findAll", "writes:Customer.destroy"]);
  });

  it("typeorm repositories, including injected ones", () => {
    expect(
      classify(`
        import { DataSource, Repository } from "typeorm";
        const source = new DataSource({});
        const users = source.getRepository(User);
        class Service { constructor(private readonly orders: Repository<Order>) {} save() { return this.orders.save({}); } }
        export async function run() { await users.findOneBy({ id: 1 }); }
      `),
    ).toEqual(["reads:User.findOneBy"]);
    const workspace = new Workspace(
      [
        facts(`
          import { Repository } from "typeorm";
          export class Service { constructor(private readonly orders: Repository<Order>) {} run() { return this.orders.save({}); } }
        `),
      ],
      "/repo",
    );
    const graph = buildCodeGraph(workspace);
    const run = [...graph.nodes.values()].find((node) => node.name === "run");
    expect(graph.out(run?.id ?? "").map((edge) => graph.nodes.get(edge.to)?.label)).toEqual([
      "Order.save",
    ]);
  });

  it("knex, SQL drivers and redis", () => {
    expect(
      classify(`
        import knex from "knex";
        import { Pool } from "pg";
        import Redis from "ioredis";
        const db = knex({ client: "pg" });
        const pool = new Pool();
        const cache = new Redis();
        export async function run() {
          await db("accounts").where({ id: 1 }).first();
          await db("accounts").insert({ id: 2 });
          await pool.query("SELECT * FROM invoices WHERE id = $1", [1]);
          await cache.set("session:1", "x");
        }
      `),
    ).toEqual([
      "reads:accounts.first",
      "writes:accounts.insert",
      "reads:invoices.select",
      "writes:session.set",
    ]);
  });

  it("supabase tables, auth and storage", () => {
    expect(
      classify(`
        import { createClient } from "@supabase/supabase-js";
        const supabase = createClient("url", "key");
        export async function run() {
          await supabase.from("profiles").select("*").eq("id", 1);
          await supabase.from("profiles").update({ name: "x" });
          await supabase.auth.signInWithPassword({ email: "a", password: "b" });
        }
      `),
    ).toEqual([
      "reads:profiles.select",
      "writes:profiles.update",
      "calls:Supabase Auth: signInWithPassword",
    ]);
  });

  it("firestore and firebase auth", () => {
    expect(
      classify(`
        import { doc, getDoc, setDoc } from "firebase/firestore";
        import { signInWithEmailAndPassword } from "firebase/auth";
        export async function run(db, auth) {
          await getDoc(doc(db, "users", "1"));
          await setDoc(doc(db, "users", "1"), {});
          await signInWithEmailAndPassword(auth, "a", "b");
        }
      `),
    ).toEqual([
      "reads:users.getDoc",
      "writes:users.setDoc",
      "calls:Firebase Auth: signInWithEmailAndPassword",
    ]);
  });
});

describe("http, event and service adapters", () => {
  it("ky, got and swr", () => {
    expect(
      classify(`
        import ky from "ky";
        import useSWR from "swr";
        const api = ky.create({ prefixUrl: "https://api.example.com" });
        export function run() { ky.post("https://billing.example.com/charges"); api.get("users"); useSWR("/api/me"); }
      `),
    ).toEqual([
      "requests:POST billing.example.com/charges",
      "requests:GET api.example.com/users",
      "requests:GET /api/me",
    ]);
  });

  it("mitt, socket.io and generic emitters", () => {
    expect(
      classify(`
        import mitt from "mitt";
        import { io } from "socket.io-client";
        const bus = mitt();
        const socket = io();
        export function run(hub) { bus.emit("cart.updated"); socket.emit("chat:message"); hub.publish("audit"); }
      `),
    ).toEqual(["emits:cart.updated", "emits:chat:message", "emits:audit"]);
  });

  it("SDK clients without treating setup calls as operations", () => {
    expect(
      classify(`
        import sgMail from "@sendgrid/mail";
        import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
        import nodemailer from "nodemailer";
        const s3 = new S3Client({});
        const transport = nodemailer.createTransport({});
        export async function run() {
          sgMail.setApiKey("key");
          await sgMail.send({});
          await s3.send(new PutObjectCommand({ Bucket: "b" }));
          await transport.sendMail({});
        }
      `),
    ).toEqual(["calls:SendGrid: send", "calls:AWS S3: PutObjectCommand", "calls:SMTP: sendMail"]);
  });

  it("validation, token and password libraries", () => {
    expect(
      classify(`
        import { z } from "zod";
        import jwt from "jsonwebtoken";
        import argon2 from "argon2";
        const schema = z.object({});
        export async function run() { schema.parse({}); jwt.sign({}, "s"); await argon2.verify("h", "p"); }
      `),
    ).toEqual(["calls:schema.parse", "calls:jwt.sign", "calls:argon2.verify"]);
  });

  it("Next.js router navigation", () => {
    expect(
      classify(
        `
        import { useRouter } from "next/navigation";
        export function run() { const router = useRouter(); router.push("/welcome?first=1"); }
      `,
        "src/run.tsx",
      ),
    ).toEqual(["navigates:navigate /welcome"]);
  });
});
