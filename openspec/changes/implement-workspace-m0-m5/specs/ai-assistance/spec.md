# Spec Delta

## Purpose

Provides explicit, bounded language assistance grounded in current authorized evidence. Model output is validated proposed content, never an authority to access data or execute external actions.

## ADDED Requirements

### Requirement: Generation is explicitly invoked and schema-validated
The system MUST generate answers, selected-text summaries, and email drafts only after explicit user invocation. It MUST validate structured output, enforce model and context limits, and prevent malformed output from invoking persistence or external actions.

#### Scenario: User explicitly requests generation
- **WHEN** an authorized user requests an answer, summary, or email draft
- **THEN** the system MUST return validated task-specific output within configured limits

#### Scenario: Output is malformed or provider is unavailable
- **WHEN** output fails schema validation or the provider is unavailable
- **THEN** the system MUST return a safe failure and preserve ordinary search and user-authored content

### Requirement: Answers cite current evidence or abstain
The system MUST ground answers in bounded authorized passages, return citations referencing the retrieved source/revision/chunk and an exact quote, and abstain when evidence is insufficient. It MUST recheck access before delivering generated output.

#### Scenario: Evidence supports the answer
- **WHEN** retrieved evidence supports a factual response
- **THEN** the system MUST return validated citations whose quotes occur in the referenced passages

#### Scenario: Evidence is insufficient or access changed during generation
- **WHEN** the evidence cannot support an answer or a source becomes unauthorized before return
- **THEN** the system MUST abstain or discard the generated result and MUST NOT expose revoked content

### Requirement: Derived content inherits source visibility
Generated content MUST record its source dependencies and remain private if any dependency is private. Sharing MUST be blocked until all dependencies are explicitly shareable and the content is regenerated or dependencies removed.

#### Scenario: Generation uses private evidence
- **WHEN** a generated card depends on at least one private source
- **THEN** the card MUST remain private and identify its dependencies for later invalidation

#### Scenario: A dependency is unshared or deleted
- **WHEN** a source dependency becomes unavailable
- **THEN** dependent generated content MUST be hidden or invalidated until the owner resolves the dependency