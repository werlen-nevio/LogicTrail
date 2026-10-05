import type { ArgFact } from "../../indexer/facts.js";
import { isPackage, packageValue, type Classification, type FrameworkAdapter } from "./types.js";

/** Third-party services reached through an SDK. Matched by package prefix. */
const SERVICE_PACKAGES: readonly [string, string][] = [
  ["stripe", "Stripe"],
  ["@stripe/stripe-js", "Stripe.js"],
  ["@sendgrid/mail", "SendGrid"],
  ["resend", "Resend"],
  ["postmark", "Postmark"],
  ["mailgun.js", "Mailgun"],
  ["nodemailer", "SMTP"],
  ["twilio", "Twilio"],
  ["openai", "OpenAI"],
  ["@anthropic-ai/sdk", "Anthropic"],
  ["@slack/web-api", "Slack"],
  ["@octokit/rest", "GitHub"],
  ["octokit", "GitHub"],
  ["googleapis", "Google APIs"],
  ["cloudinary", "Cloudinary"],
  ["algoliasearch", "Algolia"],
  ["pusher", "Pusher"],
  ["posthog-node", "PostHog"],
  ["mixpanel", "Mixpanel"],
  ["@segment/analytics-node", "Segment"],
  ["@aws-sdk/client-s3", "AWS S3"],
  ["@aws-sdk/client-sqs", "AWS SQS"],
  ["@aws-sdk/client-sns", "AWS SNS"],
  ["@aws-sdk/client-ses", "AWS SES"],
  ["@aws-sdk/client-sesv2", "AWS SES"],
  ["@aws-sdk/client-lambda", "AWS Lambda"],
  ["@aws-sdk/client-dynamodb", "AWS DynamoDB"],
  ["@aws-sdk/lib-dynamodb", "AWS DynamoDB"],
  ["aws-sdk", "AWS"],
  ["@google-cloud/storage", "Google Cloud Storage"],
  ["@google-cloud/pubsub", "Google Pub/Sub"],
  ["@clerk/nextjs", "Clerk"],
  ["@clerk/clerk-sdk-node", "Clerk"],
  ["@clerk/backend", "Clerk"],
  ["auth0", "Auth0"],
  ["@paypal/checkout-server-sdk", "PayPal"],
  ["braintree", "Braintree"],
  ["square", "Square"],
  ["@lemonsqueezy/lemonsqueezy.js", "Lemon Squeezy"],
  ["@vercel/blob", "Vercel Blob"],
  ["@vercel/kv", "Vercel KV"],
  ["@upstash/qstash", "Upstash QStash"],
  ["firebase-admin", "Firebase"],
];

/** Client setup calls (top-level methods on an SDK client), not business operations. */
const SETUP_OPERATIONS =
  /^(createClient|createTransport|createTransporter|init|initialize|configure|config|setApiKey|setup|connect|disconnect|on|off|use)$/;

function serviceFor(pkg: string): string | undefined {
  for (const [prefix, service] of SERVICE_PACKAGES) {
    if (pkg === prefix || pkg.startsWith(`${prefix}/`)) return service;
  }
  return undefined;
}

function awsCommandName(arg: ArgFact | undefined): string | undefined {
  if (arg?.kind !== "other") return undefined;
  return /new\s+(\w+Command)\b/.exec(arg.text)?.[1];
}

export const serviceSdkAdapter: FrameworkAdapter = {
  name: "services",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg) return undefined;
    const service = serviceFor(pkg.pkg);
    if (!service) return undefined;
    const memberPath = pkg.member.join(".");
    let operation =
      memberPath || (pkg.ops.length === 0 && pkg.imported !== "default" ? pkg.imported : "");
    if (!operation) return undefined;
    if (pkg.member.length <= 1 && SETUP_OPERATIONS.test(pkg.member[0] ?? operation))
      return undefined;
    if (operation === "send") operation = awsCommandName(call.args[0]) ?? operation;
    return { kind: "external", service, operation, package: pkg.pkg };
  },
};

interface LibraryRule {
  packages: readonly string[];
  category: string;
  operations: ReadonlySet<string>;
}

/** Libraries whose calls are meaningful steps in a business flow. */
const LIBRARY_RULES: readonly LibraryRule[] = [
  {
    packages: ["bcrypt", "bcryptjs", "argon2", "@node-rs/argon2", "@node-rs/bcrypt"],
    category: "password hashing",
    operations: new Set(["compare", "compareSync", "hash", "hashSync", "verify", "genSalt"]),
  },
  {
    packages: ["jsonwebtoken", "jose"],
    category: "tokens",
    operations: new Set(["sign", "verify", "decode", "jwtVerify", "jwtDecrypt", "decodeJwt"]),
  },
  {
    packages: ["zod", "yup", "joi", "valibot", "superstruct", "@sinclair/typebox"],
    category: "validation",
    operations: new Set([
      "parse",
      "safeParse",
      "parseAsync",
      "safeParseAsync",
      "validate",
      "validateSync",
      "validateAsync",
      "assert",
      "is",
    ]),
  },
  {
    packages: ["crypto"],
    category: "crypto",
    operations: new Set([
      "randomBytes",
      "randomUUID",
      "createHash",
      "createHmac",
      "scrypt",
      "scryptSync",
      "pbkdf2",
      "timingSafeEqual",
    ]),
  },
  {
    packages: ["passport"],
    category: "authentication",
    operations: new Set(["authenticate", "authorize"]),
  },
  {
    packages: ["next-auth", "@auth/core", "@auth/nextjs", "better-auth"],
    category: "authentication",
    operations: new Set(["signIn", "signOut", "getServerSession", "getSession", "auth"]),
  },
  {
    packages: ["iron-session", "express-session", "cookies-next", "js-cookie"],
    category: "session",
    operations: new Set([
      "getIronSession",
      "save",
      "destroy",
      "regenerate",
      "setCookie",
      "getCookie",
      "deleteCookie",
      "set",
      "remove",
    ]),
  },
];

export const libraryAdapter: FrameworkAdapter = {
  name: "libraries",
  classify({ value, call }): Classification | undefined {
    const pkg = packageValue(value);
    if (!pkg) return undefined;
    const operation =
      pkg.member[pkg.member.length - 1] ?? (pkg.ops.length === 0 ? pkg.imported : undefined);
    if (!operation) return undefined;
    for (const rule of LIBRARY_RULES) {
      if (!isPackage(pkg, ...rule.packages)) continue;
      if (!rule.operations.has(operation)) return undefined;
      return {
        kind: "library",
        package: pkg.pkg,
        operation,
        category: rule.category,
        label: call.path.join("."),
      };
    }
    return undefined;
  },
};

export const serviceAdapters: readonly FrameworkAdapter[] = [serviceSdkAdapter, libraryAdapter];
