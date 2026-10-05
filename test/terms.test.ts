import { describe, expect, it } from "vitest";
import { queryTerms, splitWords, stem, tokenize } from "../src/query/terms.js";

describe("terms", () => {
  it("splits identifiers and paths", () => {
    expect(splitWords("handleStripeWebhook")).toEqual(["handle", "stripe", "webhook"]);
    expect(splitWords("parseHTTPResponse_v2")).toEqual(["parse", "http", "response", "v2"]);
    expect(splitWords("server/src/auth-routes.ts")).toEqual([
      "server",
      "src",
      "auth",
      "routes",
      "ts",
    ]);
  });

  it("stems consistently", () => {
    expect(stem("payments")).toBe(stem("payment"));
    expect(stem("creating")).toBe(stem("create"));
    expect(stem("validation")).toBe(stem("validate"));
    expect(stem("failed")).toBe("fail");
    expect(stem("logging")).toBe("log");
    expect(stem("addresses")).toBe("address");
  });

  it("joins phrasal verbs in questions and identifiers", () => {
    expect(tokenize("user.loggedIn")).toEqual(["user", "login"]);
    expect(tokenize("Sign in")).toEqual(["login"]);
    expect(tokenize("onCheckOut")).toEqual(["checkout"]);
  });

  it("extracts weighted query terms without stopwords", () => {
    const terms = queryTerms("What happens after a user logs in?");
    expect(terms.filter((term) => term.source === "query").map((term) => term.term)).toEqual([
      "user",
      "login",
    ]);
    expect(terms.find((term) => term.term === "session")).toMatchObject({
      source: "synonym",
      weight: 0.4,
    });
    expect(
      queryTerms("how does checkout work?")
        .filter((t) => t.source === "query")
        .map((t) => t.term),
    ).toEqual(["checkout"]);
  });
});
