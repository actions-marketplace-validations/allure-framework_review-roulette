import type { GitHubClient } from "./github";

export interface Options {
  token: string;
  reviewers: string[];
  organizations: string[];
  assignReviewer: boolean;
}
export interface Target {
  owner: string;
  repo: string;
  pullNumber: number;
}
export interface PullSnapshot {
  author: string;
  requestedReviewers: string[];
}
export interface Suggestion {
  reviewer: string;
  reviewCount: number;
}
export type AssignmentStatus = "suggested" | "requested" | "already-requested";
export type RunResult = Suggestion & { assigned: boolean };
export interface ManagedComment {
  id: number;
  body: string;
  authorLogin: string;
  authorType: string;
  appId?: number;
}
export interface CommentIdentity {
  login: string;
  appId?: number;
}
export type GitHubApi = Pick<GitHubClient, keyof GitHubClient>;
