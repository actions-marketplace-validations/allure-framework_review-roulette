import { describe, expect, it } from "vite-plus/test";
import { createGitHubApi } from "../src/github";
const target = { owner: "acme", repo: "project", pullNumber: 7 };
function harness(replies: { body: unknown; status?: number; headers?: Record<string, string> }[]) {
  const calls: { url: string; body: Record<string, unknown>; method: string }[] = [];
  const waits: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
      method: init?.method ?? "GET",
    });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected API call");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return {
    api: createGitHubApi("fake-token", {
      fetch: fetcher,
      sleep: async (ms) => {
        waits.push(ms);
      },
      now: () => 0,
    }),
    calls,
    waits,
  };
}
const access = {
  repository: { nameWithOwner: "Acme/Project" },
  viewer: { login: "roulette[bot]" },
};
describe("access", () => {
  it("checks repository and organization visibility and resolves an app bot without /user", async () => {
    const { api, calls } = harness([
      { body: { data: access } },
      { body: { data: { organization: { login: "Other" } } } },
    ]);
    const identity = await api.checkAccess(target, ["Other"]);
    expect(identity).toEqual({ login: "roulette[bot]" });
    expect(calls.every((call) => call.url.endsWith("/graphql"))).toBe(true);
  });
  it.each([null, { nameWithOwner: "wrong/project" }])(
    "rejects inaccessible/mismatched repository %j",
    async (repository) => {
      const { api } = harness([{ body: { data: { ...access, repository } } }]);
      await expect(api.checkAccess(target, [])).rejects.toThrow(/repository/i);
    },
  );
  it("rejects inaccessible organization", async () => {
    const { api } = harness([
      { body: { data: access } },
      { body: { data: { organization: null } } },
    ]);
    await expect(api.checkAccess(target, ["secret"])).rejects.toThrow(/organization/i);
  });
  it("resolves user-token identity", async () => {
    const { api } = harness([{ body: { data: { ...access, viewer: { login: "alice" } } } }]);
    expect(await api.checkAccess(target, [])).toEqual({ login: "alice" });
  });
});
describe("suggested reviewers", () => {
  it("fetches native PR suggestions and deduplicates logins", async () => {
    const { api, calls } = harness([
      {
        body: {
          data: {
            repository: {
              pullRequest: {
                suggestedReviewers: [
                  { reviewer: { login: "Alice" } },
                  { reviewer: { login: "ALICE" } },
                  { reviewer: { login: "Bob" } },
                ],
              },
            },
          },
        },
      },
    ]);
    const reviewers = await api.getSuggestedReviewers(target);
    expect(reviewers).toEqual(["Alice", "Bob"]);
    expect(calls[0].body.variables).toEqual({ owner: "acme", repo: "project", number: 7 });
    expect(calls[0].body.query).toContain("suggestedReviewers { reviewer { login } }");
  });
  it("returns an empty pool when GitHub has no suggestions", async () => {
    const { api } = harness([
      { body: { data: { repository: { pullRequest: { suggestedReviewers: [] } } } } },
    ]);
    expect(await api.getSuggestedReviewers(target)).toEqual([]);
  });
  it.each([null, { pullRequest: null }])("rejects an inaccessible PR %j", async (repository) => {
    const { api } = harness([{ body: { data: { repository } } }]);
    await expect(api.getSuggestedReviewers(target)).rejects.toThrow(/suggested reviewers/i);
  });
});
describe("workloads", () => {
  it("uses repo scope and outstanding open PR requests without subtracting target or excluding drafts", async () => {
    const { api, calls } = harness([{ body: { data: { q0: { issueCount: 3 } } } }]);
    const counts = await api.getCounts(target, [], ["Alice"]);
    expect(counts.get("alice")).toBe(3);
    expect((calls[0].body.variables as Record<string, string>).q0).toBe(
      "is:pr is:open repo:acme/project review-requested:Alice",
    );
    expect(calls[0].body.query).toContain("search(type: ISSUE, first: 1, query: $q0)");
  });
  it("sums independent organizations and deduplicates scopes and reviewers case-insensitively", async () => {
    const { api, calls } = harness([
      {
        body: {
          data: {
            q0: { issueCount: 2 },
            q1: { issueCount: 3 },
            q2: { issueCount: 4 },
            q3: { issueCount: 5 },
          },
        },
      },
    ]);
    const counts = await api.getCounts(
      target,
      ["Acme", "ACME", "Other"],
      ["Alice", "ALICE", "Bob"],
    );
    expect([...counts]).toEqual([
      ["alice", 5],
      ["bob", 9],
    ]);
    expect((calls[0].body.variables as Record<string, string>).q1).toBe(
      "is:pr is:open org:Other review-requested:Alice",
    );
    expect((calls[0].body.variables as Record<string, string>).q2).toBe(
      "is:pr is:open org:Acme review-requested:Bob",
    );
  });
  it("includes every bounded batch", async () => {
    const first = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => ["q" + i, { issueCount: 1 }]),
    );
    const { api, calls } = harness([
      { body: { data: first } },
      { body: { data: { q0: { issueCount: 4 } } } },
    ]);
    const counts = await api.getCounts(
      target,
      Array.from({ length: 21 }, (_, i) => "org" + i),
      ["Alice"],
    );
    expect(counts.get("alice")).toBe(24);
    expect(calls).toHaveLength(2);
  });
  it.each([{}, { q0: null }, { q0: { issueCount: null } }, { q0: { issueCount: -1 } }])(
    "rejects missing/malformed counts %j",
    async (data) => {
      const { api } = harness([{ body: { data } }]);
      await expect(api.getCounts(target, [], ["Alice"])).rejects.toThrow();
    },
  );
  it("rejects partial GraphQL errors", async () => {
    const { api } = harness([
      { body: { data: { q0: { issueCount: 0 } }, errors: [{ message: "scope denied" }] } },
    ]);
    await expect(api.getCounts(target, [], ["Alice"])).rejects.toThrow();
  });
});
describe("REST integration", () => {
  it("reads PR author and paginates all outstanding requested users", async () => {
    const { api, calls } = harness([
      { body: { user: { login: "author" } } },
      {
        body: { users: [{ login: "Alice" }], teams: [] },
        headers: {
          link: '<https://api.github.com/repos/acme/project/pulls/7/requested_reviewers?page=2>; rel="next"',
        },
      },
      { body: { users: [{ login: "Bob" }], teams: [] } },
    ]);
    expect(await api.getPull(target)).toEqual({
      author: "author",
      requestedReviewers: ["Alice", "Bob"],
    });
    expect(calls).toHaveLength(3);
  });
  it("paginates comments including identity metadata", async () => {
    const { api, calls } = harness([
      {
        body: [
          {
            id: 1,
            body: "one",
            user: { login: "roulette[bot]", type: "Bot" },
            performed_via_github_app: { id: 12 },
          },
        ],
        headers: {
          link: '<https://api.github.com/repos/acme/project/issues/7/comments?page=2>; rel="next"',
        },
      },
      { body: [{ id: 2, body: null, user: null }] },
    ]);
    expect(await api.listComments(target)).toEqual([
      { id: 1, body: "one", authorLogin: "roulette[bot]", authorType: "Bot", appId: 12 },
      { id: 2, body: "", authorLogin: "", authorType: "" },
    ]);
    expect(calls).toHaveLength(2);
  });
  it("sends reviewer and comment payloads to the base repository", async () => {
    const { api, calls } = harness([{ body: {} }, { body: {} }, { body: {} }]);
    await api.requestReview(target, "Alice");
    await api.createComment(target, "hello");
    await api.updateComment(target, 42, "updated");
    expect(calls.map((call) => [call.method, new URL(call.url).pathname, call.body])).toEqual([
      ["POST", "/repos/acme/project/pulls/7/requested_reviewers", { reviewers: ["Alice"] }],
      ["POST", "/repos/acme/project/issues/7/comments", { body: "hello" }],
      ["PATCH", "/repos/acme/project/issues/comments/42", { body: "updated" }],
    ]);
  });
});
describe("retry policy", () => {
  it("honors retry-after on rate limits", async () => {
    const { api, waits } = harness([
      { status: 429, body: { message: "slow down" }, headers: { "retry-after": "2" } },
      { body: { data: access } },
    ]);
    await api.checkAccess(target, []);
    expect(waits).toEqual([2000]);
  });
  it.each([
    [{ "retry-after": "Thu, 01 Jan 1970 00:00:02 GMT" }, 2000],
    [{ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" }, 3000],
  ])("honors 403 rate-limit guidance %j", async (headers, expectedWait) => {
    const { api, waits } = harness([
      { status: 403, body: { message: "limited" }, headers },
      { body: { data: access } },
    ]);
    await api.checkAccess(target, []);
    expect(waits).toEqual([expectedWait]);
  });
  it("rejects invalid retry guidance without waiting", async () => {
    const { api, waits } = harness([
      { status: 429, body: {}, headers: { "retry-after": "invalid" } },
    ]);
    await expect(api.checkAccess(target, [])).rejects.toThrow();
    expect(waits).toEqual([]);
  });
  it("does not retry ambiguous comment creation failures", async () => {
    const { api, calls, waits } = harness([{ status: 503, body: { message: "unavailable" } }]);
    await expect(api.createComment(target, "hello")).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });
  it("retries transient server failures with a bound", async () => {
    const { api, calls, waits } = harness(
      Array.from({ length: 3 }, () => ({ status: 503, body: { message: "unavailable" } })),
    );
    await expect(api.checkAccess(target, [])).rejects.toThrow();
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });
  it.each([401, 403, 404, 422])("does not retry permanent errors %s", async (status) => {
    const { api, calls } = harness([{ status, body: { message: "denied" } }]);
    await expect(api.checkAccess(target, [])).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it("fails rather than sleeping beyond the wait budget", async () => {
    const { api, waits } = harness([{ status: 429, body: {}, headers: { "retry-after": "120" } }]);
    await expect(api.checkAccess(target, [])).rejects.toThrow();
    expect(waits).toEqual([]);
  });
});
