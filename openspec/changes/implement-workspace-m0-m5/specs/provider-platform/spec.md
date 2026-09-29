# Spec Delta

## Purpose

Provides the server-side provider and database foundation for the workspace. It ensures provider configuration, classification, and vector profiles remain validated, private, and portable across the supported Supabase runtimes.

## ADDED Requirements

### Requirement: Provider credentials remain server-side
The system MUST keep Jev, TypeSafe, embedding, and privileged Supabase credentials out of browser bundles, user-controlled requests, public database rows, and application logs. Missing optional provider configuration MUST leave unrelated card and workspace capabilities usable.

#### Scenario: Jev credential is not configured
- **WHEN** a user requests adaptive classification and the server has no Jev credential
- **THEN** the system MUST use the documented deterministic/manual fallback and MUST NOT expose a credential requirement in browser configuration

#### Scenario: Provider secret is missing
- **WHEN** a provider-backed capability is invoked without its required server secret
- **THEN** the system MUST return a safe capability-specific unavailable result while ordinary card access remains available

### Requirement: Jev classification is bounded and non-authoritative
The system MUST send classification requests through a server-side adapter using the documented TypeSafe SDK or documented TypeSafe API contract. Classification output MUST be schema-validated and MUST NOT authorize persistence, sharing, generation, or external actions.

#### Scenario: Provider classification succeeds
- **WHEN** a valid classification response arrives for the current input sequence
- **THEN** the system MUST return only supported typed intents and signals and MUST bind the result to that input sequence

#### Scenario: Provider returns malformed or stale output
- **WHEN** a response is malformed, times out, or belongs to an older input sequence
- **THEN** the system MUST reject or ignore it and preserve manual selection and deterministic fallback

### Requirement: Embedding profiles are explicit and dimension-safe
The system MUST associate every stored and queried vector with one immutable, versioned embedding profile that specifies the producing model or artifact, dimensions, normalization, and distance metric. A vector MUST be rejected when its count, values, or dimension do not match that profile.

#### Scenario: Vector matches the active profile
- **WHEN** an embedding batch returns finite vectors with the configured count and dimension
- **THEN** the system MUST store them under the matching profile and make them eligible for retrieval

#### Scenario: Vector profile does not match
- **WHEN** an embedding result has a non-finite value, wrong count, or wrong dimension
- **THEN** the system MUST reject the batch and MUST NOT activate a partially indexed source revision

### Requirement: Platform compatibility is evidenced before dependent use
The system MUST gate migrations and provider-dependent features on documented compatibility evidence for the configured Supabase runtime, pgvector profile/index, and durable worker scheduling path on each claimed deployment target.

#### Scenario: A deployment target lacks a required capability
- **WHEN** a required extension, runtime behavior, secret binding, or scheduler path is unavailable on a target
- **THEN** the system MUST report that target as unsupported or provide the documented operator scheduler fallback and MUST NOT claim portability without evidence

#### Scenario: Hosted and self-hosted paths are evaluated
- **WHEN** compatibility validation completes
- **THEN** the system MUST retain a versioned matrix of tested targets, capability results, and unverified limitations