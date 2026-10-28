import * as core from "@actions/core";
import { context } from "@actions/github";
import { parseOptions, loginPattern } from "./inputs";
import { GitHubClient } from "./github";
import { run } from "./run";
import type { Target } from "./model";

function targetFromPayload(): Target {
  const pull = context.payload.pull_request;
  const owner = pull?.base?.repo?.owner?.login;
  const repo = pull?.base?.repo?.name;
  const pullNumber = pull?.number;
  if (
    typeof owner !== "string" ||
    !loginPattern.test(owner) ||
    typeof repo !== "string" ||
    !/^[\w.-]+$/.test(repo) ||
    typeof pullNumber !== "number" ||
    !Number.isSafeInteger(pullNumber) ||
    pullNumber <= 0
  ) {
    throw new Error("A valid pull-request event context is required");
  }
  return { owner, repo, pullNumber };
}

export async function main(): Promise<void> {
  let token = "";
  try {
    token = core.getInput("token").trim();
    if (token) core.setSecret(token);
    const options = parseOptions({
      token,
      reviewers: core.getInput("reviewers"),
      organizations: core.getInput("organizations"),
      "assign-reviewer": core.getInput("assign-reviewer"),
    });
    const target = targetFromPayload();
    const result = await run(options, target, new GitHubClient(token));
    core.setOutput("reviewer", result.reviewer);
    core.setOutput("review-count", result.reviewCount);
    core.setOutput("assigned", result.assigned);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review roulette failed";
    core.setFailed(token ? message.replaceAll(token, "***") : message);
  }
}
