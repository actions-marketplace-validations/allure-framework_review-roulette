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
export interface GitHubApi {
  checkAccess(target: Target, organizations: string[]): Promise<CommentIdentity>;
  getPull(target: Target): Promise<PullSnapshot>;
  getCounts(
    target: Target,
    organizations: string[],
    reviewers: string[],
  ): Promise<Map<string, number>>;
  listComments(target: Target): Promise<ManagedComment[]>;
  requestReview(target: Target, reviewer: string): Promise<void>;
  createComment(target: Target, body: string): Promise<void>;
  updateComment(target: Target, commentId: number, body: string): Promise<void>;
}
