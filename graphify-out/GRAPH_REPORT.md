# Graph Report - hackathon-spiderguy  (2026-09-29)

## Corpus Check
- Corpus is ~10,656 words - fits in a single context window. You may not need a graph.

## Summary
- 44 nodes · 38 edges · 10 communities (7 shown, 3 thin omitted)
- Extraction: 45% EXTRACTED · 55% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Product and Delivery Governance
- Workspace Authorization and Retrieval
- Platform Decisions and Readiness
- Adaptive Input and Classification
- Grounded Content Provenance
- Drive Snapshot Lifecycle
- Confirmed Google Actions
- API Limits and Errors
- Durable Indexing Pipeline
- Content Privacy

## God Nodes (most connected - your core abstractions)
1. `Workspace Authorization Model` - 6 edges
2. `Adaptive Structured Input` - 4 edges
3. `Authorized RPC Operations` - 3 edges
4. `Ordered Implementation Milestones` - 3 edges
5. `Requirement Acceptance Criteria` - 3 edges
6. `Generated Content Visibility Inheritance` - 3 edges
7. `Requirement Verification Traceability` - 3 edges
8. `Mission and Source of Truth` - 2 edges
9. `Adaptive Workspace Product Package` - 2 edges
10. `Supabase Responsibility Boundaries` - 2 edges

## Surprising Connections (you probably didn't know these)
- `Tenant Security Boundaries` --conceptually_related_to--> `Workspace Authorization Model`  [INFERRED]
  AGENTS.md → docs/DATA_MODEL.md
- `Adaptive Workspace Product Package` --references--> `Adaptive Structured Input`  [EXTRACTED]
  README.md → docs/PRODUCT.md
- `Application Trust Boundaries` --conceptually_related_to--> `Workspace Authorization Model`  [INFERRED]
  docs/SECURITY_OPERATIONS.md → docs/DATA_MODEL.md
- `Mission and Source of Truth` --references--> `Requirement Acceptance Criteria`  [EXTRACTED]
  AGENTS.md → docs/REQUIREMENTS.md
- `Mission and Source of Truth` --references--> `Adaptive Workspace Product Package`  [EXTRACTED]
  AGENTS.md → README.md

## Hyperedges (group relationships)
- **Workspace Authorization Chain** — docs_data_model_workspace_authorization, docs_api_contracts_authorized_rpc, docs_specs_rag_authorized_retrieval, docs_verification_isolation_tests [INFERRED 0.95]
- **Source to Grounded Artifact Flow** — docs_specs_rag_durable_ingestion, docs_specs_rag_authorized_retrieval, docs_specs_rag_grounded_generation, docs_specs_rag_source_dependencies [EXTRACTED 1.00]
- **Confirmed Google Action Flow** — docs_specs_google_workspace_identity, docs_specs_google_workspace_action_ledger, docs_api_contracts_action_ledger, docs_ux_explicit_action_confirmation [EXTRACTED 1.00]

## Communities (10 total, 3 thin omitted)

### Community 0 - "Product and Delivery Governance"
Cohesion: 0.22
Nodes (9): Mission and Source of Truth, Ordered Implementation Milestones, Requirement Acceptance Criteria, Current Implementation State, Change Specification Acceptance Template, Accessible Keyboard Interaction, Requirement Verification Traceability, First Implementation Slice (+1 more)

### Community 1 - "Workspace Authorization and Retrieval"
Cohesion: 0.25
Nodes (9): Tenant Security Boundaries, Authorized RPC Operations, Workspace Request Flows, Workspace Authorization Model, Tenant Isolation Requirement, Google Identity and Scoped Connections, Authorized Hybrid Retrieval, Adversarial Tenant Isolation Tests (+1 more)

### Community 2 - "Platform Decisions and Readiness"
Cohesion: 0.40
Nodes (5): Supabase-Centered Adaptive Workspace Decision, Supabase Responsibility Boundaries, M0 Compatibility Spikes, Supabase Platform Documentation Sources, M0 Next Action

### Community 3 - "Adaptive Input and Classification"
Cohesion: 0.40
Nodes (5): Provider Adapter Boundaries, Adaptive Structured Input, Application Trust Boundaries, ShapeShift Reference Assessment, Classifier Stability State Machine

### Community 4 - "Grounded Content Provenance"
Cohesion: 0.67
Nodes (4): Source Dependency Provenance, Generated Content Visibility Inheritance, Grounded Generation and Citation Validation, Generated Artifact Source Dependencies

### Community 5 - "Drive Snapshot Lifecycle"
Cohesion: 0.67
Nodes (3): Google Snapshot Scope Decision, Selected Google Snapshot Import, Drive Snapshot Lifecycle

### Community 6 - "Confirmed Google Actions"
Cohesion: 0.67
Nodes (3): External Action Ledger, Google External Action Safety, Explicit External Action Confirmation

## Knowledge Gaps
- **21 isolated node(s):** `Tenant Security Boundaries`, `First Implementation Slice`, `API Common Envelope`, `External Action Ledger`, `Workspace Request Flows` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 23 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Adaptive Structured Input` connect `Adaptive Input and Classification` to `Product and Delivery Governance`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `Workspace Authorization Model` connect `Workspace Authorization and Retrieval` to `Adaptive Input and Classification`?**
  _High betweenness centrality (0.150) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `Workspace Authorization Model` (e.g. with `Tenant Security Boundaries` and `Authorized RPC Operations`) actually correct?**
  _`Workspace Authorization Model` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Adaptive Structured Input` (e.g. with `Provider Adapter Boundaries` and `Classifier Stability State Machine`) actually correct?**
  _`Adaptive Structured Input` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Authorized RPC Operations` (e.g. with `Workspace Authorization Model` and `Workspace Request Flows`) actually correct?**
  _`Authorized RPC Operations` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Tenant Security Boundaries`, `First Implementation Slice`, `API Common Envelope` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._