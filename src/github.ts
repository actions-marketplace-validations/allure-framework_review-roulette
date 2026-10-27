import { getOctokit } from "@actions/github";
import type { GitHubApi, Target } from "./model";
interface Runtime {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
interface ApiFailure {
  status?: number;
  response?: { headers?: Record<string, string> };
}
const unique = (values: string[]) =>
  values.filter(
    (value, index) =>
      values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index,
  );
export function createGitHubApi(token: string, runtime: Runtime = {}): GitHubApi {
  const octokit = getOctokit(token, {
    request: { fetch: runtime.fetch },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const sleep = runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = runtime.now ?? Date.now;
  async function retry<T>(operation: () => Promise<T>, read = true): Promise<T> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const failure = error as ApiFailure;
        const headers = failure.response?.headers ?? {};
        const limited =
          failure.status === 429 ||
          (failure.status === 403 &&
            (headers["retry-after"] !== undefined || headers["x-ratelimit-remaining"] === "0"));
        const transient = read && failure.status !== undefined && failure.status >= 500;
        if (attempt >= 2 || (!limited && !transient)) throw error;
        let delay = 1000 * 2 ** attempt;
        if (headers["retry-after"] !== undefined) {
          const seconds = Number(headers["retry-after"]);
          delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(headers["retry-after"]) - now();
        } else if (headers["x-ratelimit-remaining"] === "0" && headers["x-ratelimit-reset"]) {
          delay = Number(headers["x-ratelimit-reset"]) * 1000 - now() + 1000;
        }
        delay = Math.max(1000, delay);
        if (!Number.isFinite(delay) || waited + delay > 30000) throw error;
        waited += delay;
        await sleep(delay);
      }
    }
  }
  const params = (target: Target) => ({ owner: target.owner, repo: target.repo });
  return {
    async checkAccess(target, organizations) {
      const data = await retry(() =>
        octokit.graphql<{
          repository: { nameWithOwner: string } | null;
          viewer: { login: string } | null;
        }>(
          "query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { nameWithOwner } viewer { login } }",
          params(target),
        ),
      );
      if (
        data.repository?.nameWithOwner.toLowerCase() !==
        `${target.owner}/${target.repo}`.toLowerCase()
      )
        throw new Error("Target repository is inaccessible or mismatched");
      if (!data.viewer?.login) throw new Error("Cannot resolve authenticated comment identity");
      for (const login of unique(organizations)) {
        const scope = await retry(() =>
          octokit.graphql<{ organization: { login: string } | null }>(
            "query($login: String!) { organization(login: $login) { login } }",
            { login },
          ),
        );
        if (scope.organization?.login.toLowerCase() !== login.toLowerCase())
          throw new Error("Configured organization is inaccessible or mismatched");
      }
      return { login: data.viewer.login };
    },
    async getPull(target) {
      const pull = await retry(() =>
        octokit.rest.pulls.get({ ...params(target), pull_number: target.pullNumber }),
      );
      const requestedReviewers: string[] = [];
      // This endpoint returns { users, teams }, not a flat array; paginate's
      // generated types incorrectly describe it as normalized array data.
      for (let page = 1; ; page++) {
        const response = await retry(() =>
          octokit.rest.pulls.listRequestedReviewers({
            ...params(target),
            pull_number: target.pullNumber,
            per_page: 100,
            page,
          }),
        );
        requestedReviewers.push(...response.data.users.map((user) => user.login));
        if (!response.headers.link?.includes('rel="next"')) break;
      }
      return { author: pull.data.user.login, requestedReviewers };
    },
    async getSuggestedReviewers(target) {
      const data = await retry(() =>
        octokit.graphql<{
          repository: {
            pullRequest: { suggestedReviewers: { reviewer: { login: string } }[] } | null;
          } | null;
        }>(
          "query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { suggestedReviewers { reviewer { login } } } } }",
          { ...params(target), number: target.pullNumber },
        ),
      );
      const suggestions = data.repository?.pullRequest?.suggestedReviewers;
      if (!suggestions) throw new Error("Cannot resolve suggested reviewers for the target PR");
      return unique(suggestions.map((suggestion) => suggestion.reviewer.login));
    },
    async getCounts(target, organizations, reviewers) {
      const scopes = organizations.length
        ? unique(organizations).map((org) => `org:${org}`)
        : [`repo:${target.owner}/${target.repo}`];
      const counts = new Map(unique(reviewers).map((login) => [login.toLowerCase(), 0]));
      const searches = unique(reviewers).flatMap((login) =>
        scopes.map((scope) => ({
          login,
          query: `is:pr is:open ${scope} review-requested:${login}`,
        })),
      );
      for (let offset = 0; offset < searches.length; offset += 20) {
        const batch = searches.slice(offset, offset + 20);
        const variables = Object.fromEntries(batch.map((item, i) => [`q${i}`, item.query]));
        const declarations = batch.map((_, i) => `$q${i}: String!`).join(", ");
        const fields = batch
          .map((_, i) => `q${i}: search(type: ISSUE, first: 1, query: $q${i}) { issueCount }`)
          .join("\n");
        const result = await retry(() =>
          octokit.graphql<Record<string, { issueCount: number } | null>>(
            `query(${declarations}) { ${fields} }`,
            variables,
          ),
        );
        for (const [i, item] of batch.entries()) {
          const count = result[`q${i}`]?.issueCount;
          if (count === undefined || !Number.isSafeInteger(count) || count < 0)
            throw new Error("GitHub returned a missing or invalid workload count");
          const login = item.login.toLowerCase();
          counts.set(login, counts.get(login)! + count);
        }
      }
      return counts;
    },
    async listComments(target) {
      const comments = await retry(() =>
        octokit.paginate(octokit.rest.issues.listComments, {
          ...params(target),
          issue_number: target.pullNumber,
          per_page: 100,
        }),
      );
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? "",
        authorLogin: comment.user?.login ?? "",
        authorType: comment.user?.type ?? "",
        ...(comment.performed_via_github_app ? { appId: comment.performed_via_github_app.id } : {}),
      }));
    },
    async requestReview(target, reviewer) {
      await retry(
        () =>
          octokit.rest.pulls.requestReviewers({
            ...params(target),
            pull_number: target.pullNumber,
            reviewers: [reviewer],
          }),
        false,
      );
    },
    async createComment(target, body) {
      // A server error can follow a successful write: do not retry ambiguous POST failures.
      await retry(
        () =>
          octokit.rest.issues.createComment({
            ...params(target),
            issue_number: target.pullNumber,
            body,
          }),
        false,
      );
    },
    async updateComment(target, commentId, body) {
      await retry(
        () => octokit.rest.issues.updateComment({ ...params(target), comment_id: commentId, body }),
        false,
      );
    },
  };
}
