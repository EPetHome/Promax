/** Append-only presentation of an existing task/version result, never a second success authority. */
export interface DeliveryReceipt {
  id: string;
  /** Fact ID when this is a new visible receipt for facts that matched an older historical ID. */
  projection_id?: string;
  at: string;
  task_key: string;
  reviewed_hashes: Record<string, string>;
  state: "saving" | "complete" | "saved_partial" | "failed" | "unknown";
  correction: boolean;
  text: string;
  targets: Array<{ kind: "formal" | "draft" | "previous"; filename: string; sha256: string; task_key?: string; path: string }>;
}
/** Commit attempt metadata in the existing work record. Success is always read from the version store. */
export interface DeliveryAttempt {
  task_key: string;
  trace_id: string;
  reviewed_hashes: Record<string, string>;
  at: string;
  /** This attempt rechecked an existing formal version; no version was committed under this task. */
  check_only?: boolean;
  error?: string;
  failure?: "failed" | "unknown";
}
