import type { ArgFact } from "../../indexer/facts.js";
import {
  identifierArg,
  isConstructed,
  isPackage,
  packageValue,
  stringArg,
  stringOrTemplateArg,
  type Classification,
  type FrameworkAdapter,
} from "./types.js";

type Access = "read" | "write";

function access(
  operation: string,
  reads: ReadonlySet<string>,
  writes: ReadonlySet<string>,
): Access | undefined {
  if (reads.has(operation)) return "read";
  if (writes.has(operation)) return "write";
  return undefined;
}

function database(
  system: string,
  model: string | undefined,
  operation: string,
  mode: Access,
): Classification {
  return { kind: "database", system, operation, access: mode, ...(model ? { model } : {}) };
}

const PRISMA_READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const PRISMA_WRITES = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export const prismaAdapter: FrameworkAdapter = {
  name: "prisma",
  classify({ value }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "@prisma/client") || !isConstructed(pkg)) return undefined;
    const [model, operation] = pkg.member;
    if (!model) return undefined;
    if (model.startsWith("$")) {
      if (model === "$queryRaw" || model === "$queryRawUnsafe")
        return database("prisma", undefined, model, "read");
      if (model === "$executeRaw" || model === "$executeRawUnsafe" || model === "$transaction") {
        return database("prisma", undefined, model, "write");
      }
      return undefined;
    }
    if (!operation) return undefined;
    const mode = access(operation, PRISMA_READS, PRISMA_WRITES);
    return mode ? database("prisma", model, operation, mode) : undefined;
  },
};

export const drizzleAdapter: FrameworkAdapter = {
  name: "drizzle",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "drizzle-orm") || !isConstructed(pkg)) return undefined;
    const [first, second, third] = pkg.member;
    if (first === "select" || first === "selectDistinct") {
      const from = call.chain.find((segment) => segment.name === "from");
      return database("drizzle", identifierArg(from?.args[0]), "select", "read");
    }
    if (first === "insert" || first === "update" || first === "delete") {
      return database("drizzle", identifierArg(call.args[0]), first, "write");
    }
    if (first === "query" && second && third) return database("drizzle", second, third, "read");
    if (first === "execute") return database("drizzle", undefined, "execute", "write");
    return undefined;
  },
};

const MONGOOSE_READS = new Set([
  "find",
  "findOne",
  "findById",
  "countDocuments",
  "estimatedDocumentCount",
  "exists",
  "aggregate",
  "distinct",
]);
const MONGOOSE_WRITES = new Set([
  "create",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "findOneAndDelete",
  "findByIdAndDelete",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "bulkWrite",
]);

export const mongooseAdapter: FrameworkAdapter = {
  name: "mongoose",
  classify({ value }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "mongoose")) return undefined;
    const modelOp = pkg.ops.find(
      (op) =>
        op.op === "call" &&
        (op.member.at(-1) === "model" || (pkg.imported === "model" && op.member.length === 0)),
    );
    if (!modelOp) return undefined;
    const operation = pkg.member[0];
    if (!operation || pkg.member.length !== 1) return undefined;
    const mode = access(operation, MONGOOSE_READS, MONGOOSE_WRITES);
    return mode ? database("mongodb", stringArg(modelOp.args[0]), operation, mode) : undefined;
  },
};

const SEQUELIZE_READS = new Set([
  "findAll",
  "findOne",
  "findByPk",
  "findAndCountAll",
  "count",
  "max",
  "min",
  "sum",
]);
const SEQUELIZE_WRITES = new Set([
  "create",
  "bulkCreate",
  "update",
  "destroy",
  "upsert",
  "increment",
  "decrement",
]);

export const sequelizeAdapter: FrameworkAdapter = {
  name: "sequelize",
  classify({ value }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "sequelize", "@sequelize/core")) return undefined;
    const operation = pkg.member[0];
    if (!operation || pkg.member.length !== 1) return undefined;
    const mode = access(operation, SEQUELIZE_READS, SEQUELIZE_WRITES);
    if (!mode) return undefined;
    const define = pkg.ops.find((op) => op.op === "call" && op.member.at(-1) === "define");
    const typed = pkg.ops.find((op) => op.op === "type");
    const model = define ? stringArg(define.args[0]) : typed?.typeArgs?.[0];
    return model ? database("sql", model, operation, mode) : undefined;
  },
};

const TYPEORM_READS = new Set([
  "find",
  "findOne",
  "findOneBy",
  "findBy",
  "findAndCount",
  "findOneOrFail",
  "findOneByOrFail",
  "count",
  "exist",
  "exists",
]);
const TYPEORM_WRITES = new Set([
  "save",
  "insert",
  "update",
  "upsert",
  "delete",
  "remove",
  "softDelete",
  "restore",
  "increment",
  "decrement",
]);

export const typeormAdapter: FrameworkAdapter = {
  name: "typeorm",
  classify({ value }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "typeorm")) return undefined;
    const operation = pkg.member[0];
    if (!operation || pkg.member.length !== 1) return undefined;
    const mode = access(operation, TYPEORM_READS, TYPEORM_WRITES);
    if (!mode) return undefined;
    const repository = pkg.ops.find(
      (op) => op.op === "call" && op.member.at(-1) === "getRepository",
    );
    const typed = pkg.ops.find((op) => op.op === "type");
    const model = repository ? identifierArg(repository.args[0]) : typed?.typeArgs?.[0];
    return database("sql", model, operation, mode);
  },
};

export const knexAdapter: FrameworkAdapter = {
  name: "knex",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "knex") || !isConstructed(pkg) || pkg.member.length > 0)
      return undefined;
    const table = stringArg(call.args[0]);
    if (!table) return undefined;
    const names = call.chain.map((segment) => segment.name);
    const write = names.find((name) =>
      ["insert", "update", "del", "delete", "upsert", "increment"].includes(name),
    );
    return database(
      "sql",
      table,
      write ?? names[names.length - 1] ?? "select",
      write ? "write" : "read",
    );
  },
};

const SQL_PACKAGES = [
  "pg",
  "mysql",
  "mysql2",
  "better-sqlite3",
  "sqlite3",
  "sqlite",
  "@neondatabase/serverless",
  "@planetscale/database",
];

export const sqlDriverAdapter: FrameworkAdapter = {
  name: "sql",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, ...SQL_PACKAGES)) return undefined;
    const method = pkg.member[pkg.member.length - 1];
    if (!method || !["query", "execute", "prepare", "run", "all", "get"].includes(method))
      return undefined;
    const sql = stringOrTemplateArg(call.args[0]);
    if (!sql) return database("sql", undefined, method, "write");
    const parsed = parseSql(sql);
    return database("sql", parsed.table, parsed.verb, parsed.verb === "select" ? "read" : "write");
  },
};

export function parseSql(sql: string): { verb: string; table?: string } {
  const verb = /^\s*(select|insert|update|delete|with)\b/i.exec(sql)?.[1]?.toLowerCase() ?? "query";
  const table =
    /\bfrom\s+["`]?([\w.]+)/i.exec(sql)?.[1] ??
    /\binto\s+["`]?([\w.]+)/i.exec(sql)?.[1] ??
    /^\s*update\s+["`]?([\w.]+)/i.exec(sql)?.[1];
  return { verb: verb === "with" ? "select" : verb, ...(table ? { table } : {}) };
}

const REDIS_READS = new Set([
  "get",
  "mget",
  "hget",
  "hgetall",
  "hmget",
  "exists",
  "ttl",
  "smembers",
  "sismember",
  "lrange",
  "zrange",
  "zscore",
  "scan",
  "keys",
  "getex",
]);
const REDIS_WRITES = new Set([
  "set",
  "setex",
  "setnx",
  "mset",
  "del",
  "unlink",
  "incr",
  "incrby",
  "decr",
  "expire",
  "hset",
  "hdel",
  "sadd",
  "srem",
  "lpush",
  "rpush",
  "zadd",
  "zrem",
  "publish",
]);

export const redisAdapter: FrameworkAdapter = {
  name: "redis",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "ioredis", "redis", "@upstash/redis") || !isConstructed(pkg))
      return undefined;
    const operation = pkg.member[pkg.member.length - 1];
    if (!operation || pkg.member.length !== 1) return undefined;
    const mode = access(operation.toLowerCase(), REDIS_READS, REDIS_WRITES);
    if (!mode) return undefined;
    return database("redis", redisKeyPrefix(call.args[0]), operation, mode);
  },
};

function redisKeyPrefix(arg: ArgFact | undefined): string | undefined {
  const raw = stringOrTemplateArg(arg);
  if (!raw) return undefined;
  const prefix = raw.split(/[:${]/)[0];
  return prefix && prefix.length > 0 ? prefix : undefined;
}

export const supabaseAdapter: FrameworkAdapter = {
  name: "supabase",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (
      !pkg ||
      !isPackage(pkg, "@supabase/supabase-js", "@supabase/ssr", "@supabase/auth-helpers-nextjs")
    ) {
      return undefined;
    }
    if (!isConstructed(pkg)) return undefined;
    const [first, ...rest] = pkg.member;
    if (first === "from") {
      const operations = ["select", "insert", "update", "upsert", "delete"];
      const operation =
        call.chain.map((segment) => segment.name).find((name) => operations.includes(name)) ??
        "select";
      return database(
        "supabase",
        stringArg(call.args[0]),
        operation,
        operation === "select" ? "read" : "write",
      );
    }
    if (first === "rpc") return database("supabase", stringArg(call.args[0]), "rpc", "write");
    if (first === "auth" && rest.length > 0) {
      return {
        kind: "external",
        service: "Supabase Auth",
        operation: rest.join("."),
        package: pkg.pkg,
      };
    }
    if (first === "storage") {
      const operation = call.chain.map((segment) => segment.name).join(".") || rest.join(".");
      return {
        kind: "external",
        service: "Supabase Storage",
        operation: operation || "storage",
        package: pkg.pkg,
      };
    }
    if (first === "functions") {
      return {
        kind: "external",
        service: "Supabase Functions",
        operation: stringArg(call.args[0]) ?? "invoke",
        package: pkg.pkg,
      };
    }
    return undefined;
  },
};

const FIRESTORE_READS = new Set(["getDoc", "getDocs", "onSnapshot", "getCountFromServer"]);
const FIRESTORE_WRITES = new Set(["setDoc", "addDoc", "updateDoc", "deleteDoc", "runTransaction"]);

export const firebaseAdapter: FrameworkAdapter = {
  name: "firebase",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg) return undefined;
    if (
      isPackage(pkg, "firebase/firestore", "@firebase/firestore") &&
      pkg.member.length === 0 &&
      pkg.ops.length === 0
    ) {
      const mode = access(pkg.imported, FIRESTORE_READS, FIRESTORE_WRITES);
      if (!mode) return undefined;
      return database("firestore", firestoreCollection(call.args[0]), pkg.imported, mode);
    }
    if (isPackage(pkg, "firebase/auth", "@firebase/auth") && pkg.ops.length === 0) {
      if (
        /^(signIn|signOut|createUser|sendPassword|sendEmail|confirmPassword|updatePassword|verify)/.test(
          pkg.imported,
        )
      ) {
        return {
          kind: "external",
          service: "Firebase Auth",
          operation: pkg.imported,
          package: pkg.pkg,
        };
      }
      return undefined;
    }
    if (isPackage(pkg, "firebase-admin")) {
      const collection = call.chain.find((segment) => segment.name === "collection");
      const last = call.chain[call.chain.length - 1]?.name ?? pkg.member[pkg.member.length - 1];
      if ((collection || pkg.member.includes("collection")) && last) {
        const name = collection ? stringArg(collection.args[0]) : stringArg(call.args[0]);
        const mode = ["get", "listDocuments", "onSnapshot"].includes(last) ? "read" : "write";
        return database("firestore", name, last, mode);
      }
      if (
        pkg.member.includes("auth") ||
        pkg.imported === "getAuth" ||
        pkg.ops.some((op) => op.member.includes("auth"))
      ) {
        const operation = pkg.member.filter((name) => name !== "auth").join(".");
        return operation
          ? { kind: "external", service: "Firebase Auth", operation, package: pkg.pkg }
          : undefined;
      }
    }
    return undefined;
  },
};

function firestoreCollection(arg: ArgFact | undefined): string | undefined {
  if (arg?.kind !== "call") return undefined;
  const name = arg.path[arg.path.length - 1];
  if (name !== "doc" && name !== "collection") return undefined;
  return stringArg(arg.args[1]);
}

export const dataAdapters: readonly FrameworkAdapter[] = [
  prismaAdapter,
  drizzleAdapter,
  mongooseAdapter,
  sequelizeAdapter,
  typeormAdapter,
  knexAdapter,
  sqlDriverAdapter,
  redisAdapter,
  supabaseAdapter,
  firebaseAdapter,
];
