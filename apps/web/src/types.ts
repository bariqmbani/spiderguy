import type { CardType } from "@shared/schemas.ts";

export type Workspace = { id: string; kind: "personal" | "team"; name: string; owner_id: string };
export type Membership = { workspace_id: string; user_id: string; role: "owner" | "admin" | "member"; state: string };
export type Card = {
  id: string; workspace_id: string; owner_id: string; visibility: "private" | "workspace"; type: CardType;
  payload: Record<string, unknown>; revision: number; generated: boolean; hidden_reason: string | null; created_at: string; updated_at: string;
};
export type Source = {
  id: string; workspace_id: string; owner_id: string; visibility: "private" | "workspace"; kind: "card" | "upload" | "drive_snapshot";
  card_id: string | null; title: string; state: string; error_code: string | null; external_url: string | null;
  active_revision_id: string | null; created_at: string; updated_at: string;
};
export type Citation = { source_id: string; revision_id: string; chunk_id: string; quote: string; title?: string };
export type Dependency = { source_id: string; revision_id: string };
export type Generated = {
  task: "answer" | "summary" | "email"; answer?: string; summary?: string; subject?: string; body?: string; to?: string[]; cc?: string[];
  abstained?: boolean; citations: Citation[]; dependencies: Dependency[]; private_required: boolean; model: string | null;
  prompt_version: string; excluded_passages?: number;
};
