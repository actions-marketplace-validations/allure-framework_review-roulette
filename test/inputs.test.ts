import { describe, expect, it } from "vite-plus/test";
import { parseOptions } from "../src/inputs";
describe("parseOptions", () => {
  it("normalizes lists and defaults", () => {
    const result = parseOptions({
      token: "secret",
      reviewers: "@Alice, alice\nBob",
      organizations: "Acme,acme\nOther",
    });
    expect(result).toEqual({
      token: "secret",
      reviewers: ["Alice", "Bob"],
      organizations: ["Acme", "Other"],
      assignReviewer: false,
    });
  });
  it("accepts empty organization scope and explicit assignment", () => {
    const result = parseOptions({
      token: "secret",
      reviewers: "a",
      organizations: " , \n",
      "assign-reviewer": "true",
    });
    expect(result.organizations).toEqual([]);
    expect(result.assignReviewer).toBe(true);
  });
  it.each([undefined, "", " , \n"])(
    "uses discovery for missing or empty reviewers %j",
    (reviewers) => {
      const result = parseOptions({
        token: "secret",
        ...(reviewers === undefined ? {} : { reviewers }),
      });
      expect(result.reviewers).toEqual([]);
    },
  );
  it.each<Record<string, string>>([
    {},
    { token: "", reviewers: "a" },
    { token: "s", reviewers: "a--b" },
    { token: "s", reviewers: "-alice" },
    { token: "s", reviewers: "a", organizations: "bad org" },
    { token: "s", reviewers: "a", "assign-reviewer": "yes" },
  ])("rejects invalid inputs %j", (raw) => {
    expect(() => parseOptions(raw)).toThrow();
  });
});
