import { isPackage, packageValue, stringArg, type FrameworkAdapter } from "./types.js";

const EMITTER_PACKAGES = [
  "events",
  "eventemitter3",
  "eventemitter2",
  "emittery",
  "mitt",
  "tiny-emitter",
  "nanoevents",
];
const EMIT_METHODS = new Set(["emit", "emitAsync", "emitSerial", "publish"]);

export const eventEmitterAdapter: FrameworkAdapter = {
  name: "events",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, ...EMITTER_PACKAGES)) return undefined;
    const method = pkg.member[pkg.member.length - 1];
    if (!method || pkg.member.length !== 1 || !EMIT_METHODS.has(method)) return undefined;
    const event = stringArg(call.args[0]);
    return event
      ? { kind: "emit", channel: "event", event, confidence: 1, system: pkg.pkg }
      : undefined;
  },
};

export const socketAdapter: FrameworkAdapter = {
  name: "socket.io",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "socket.io", "socket.io-client")) return undefined;
    if (pkg.member[pkg.member.length - 1] !== "emit") return undefined;
    const event = stringArg(call.args[0]);
    return event
      ? { kind: "emit", channel: "event", event, confidence: 0.9, system: "socket.io" }
      : undefined;
  },
};

export const bullmqAdapter: FrameworkAdapter = {
  name: "bullmq",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "bullmq", "bull", "bee-queue")) return undefined;
    const method = pkg.member[0];
    if (
      pkg.member.length !== 1 ||
      (method !== "add" && method !== "addBulk" && method !== "createJob")
    ) {
      return undefined;
    }
    const construct = pkg.ops.find((op) => op.op === "new");
    const queue = stringArg(construct?.args[0]);
    if (!queue) return undefined;
    const job = stringArg(call.args[0]);
    return {
      kind: "emit",
      channel: "queue",
      event: queue,
      confidence: 1,
      system: pkg.pkg,
      ...(job ? { detail: job } : {}),
    };
  },
};

/**
 * Fallback for project-specific event buses we cannot resolve:
 * `something.emit("literal", ...)`. Reported with reduced confidence.
 */
export const genericEmitAdapter: FrameworkAdapter = {
  name: "generic-emit",
  classify({ value, call }) {
    if (value.kind === "package" || value.kind === "symbol") return undefined;
    if (call.path.length < 2) return undefined;
    const method = call.path[call.path.length - 1];
    if (method !== "emit" && method !== "publish") return undefined;
    const event = stringArg(call.args[0]);
    return event
      ? { kind: "emit", channel: "event", event, confidence: 0.6, system: "unknown" }
      : undefined;
  },
};

export const eventAdapters: readonly FrameworkAdapter[] = [
  eventEmitterAdapter,
  socketAdapter,
  bullmqAdapter,
  genericEmitAdapter,
];
