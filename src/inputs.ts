import type { Options } from "./model";

export const loginPattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function parseList(value: string, reviewer: boolean): string[] {
  const unique = new Map<string, string>();
  for (const entry of value.split(/[,\n]/)) {
    const login = entry.trim().replace(reviewer ? /^@/ : /$^/, "");
    if (!login) continue;
    if (!loginPattern.test(login)) throw new Error("Invalid GitHub login in input list");
    unique.set(login.toLowerCase(), unique.get(login.toLowerCase()) ?? login);
  }
  return [...unique.values()];
}

export function parseOptions(raw: Record<string, string>): Options {
  const token = (raw.token ?? "").trim();
  if (!token) throw new Error("token is required");
  const reviewers = parseList(raw.reviewers ?? "", true);
  const assignment = raw["assign-reviewer"]?.trim() || "false";
  if (assignment !== "true" && assignment !== "false")
    throw new Error("assign-reviewer must be true or false");
  return {
    token,
    reviewers,
    organizations: parseList(raw.organizations ?? "", false),
    assignReviewer: assignment === "true",
  };
}
