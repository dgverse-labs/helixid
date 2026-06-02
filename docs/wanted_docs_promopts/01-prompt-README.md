# Prompt — README.md (repo root)

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, docs/, and e2e/. Write the root README.md for the Helix ID repository.

## What this document is

The first thing anyone reads when they land on the repo. It is not a tutorial and
not a reference. It is a map. It answers three questions in order: what is this,
why does it exist, and where do I go next. It should be scannable in 2 minutes
and give every type of reader a clear next step.

## Tone and style

- Direct and confident. No marketing language.
- Short paragraphs. No bullet walls.
- Code blocks only where a command or snippet adds immediate value.
- Every section earns its place. If it does not help the reader decide
  what to do next, cut it.

## Sections to write

### 1. What is Helix ID
One paragraph. What it is, what it gives AI agents, what standards it uses.
No acronym soup — spell out DID, VC, VP on first use with a one-clause explanation.

### 2. The Problem It Solves
Two short paragraphs. The first describes the world without Helix ID — agents
calling services with no verifiable identity, API keys shared across agents,
no way to revoke access granularly. The second describes what changes with Helix ID.
Do not oversell. Be precise.

### 3. How It Works
Four to five sentences maximum. The core mechanic: operator enrolls agent, agent
generates keypair locally, Helix ID anchors DID on Hedera and issues a VC, agent
signs VPs per request, verifier checks them. No diagrams needed here — CONCEPTS.md
handles depth.

### 4. Key Concepts
A small table or tight list. One line each for: DID, VC, VP, HCS, StatusList2021,
Agent Wallet, vpId. Each line is a plain English phrase, not a definition.
Link to CONCEPTS.md at the end.

### 5. Who This Is For
Four short subsections, one paragraph each:
- Operators: people deploying Helix ID and enrolling agents
- Agent Developers: people building agents that need an identity
- Verifiers: people building services that agents call
- Contributors: people contributing to the repo itself
Each subsection ends with: "Start here: [link to the most relevant doc for that role]"

### 6. Quickstart
The fastest path to something running. Not the full self-host guide.
Three to five commands with a one-line explanation before each.
Ends with: "For full setup see SELF-HOST.md"

### 7. Repo Structure
The four packages as a directory tree with one-line descriptions.
Match the actual repo structure exactly.

### 8. Documentation Index
A table with two columns: document name and one-sentence description.
Link every doc in docs/ and the SDK README. This is the master index
a reader bookmarks.

### 9. Examples Index
A table with two columns: example name and one-sentence description.
Link the E2E example and each standalone file in examples/.
One line explaining: "Start with the E2E example if you want the full picture.
Start with a standalone file if you know what you are looking for."

### 10. License and Contributing
Two short paragraphs. License is Apache 2.0. Contributing points to CONTRIBUTING.md
if it exists, or says contributions are welcome and to open an issue first for
significant changes.

## Constraints

- Do not repeat information that lives in another doc. Link to it instead.
- Do not include API reference, environment variable tables, or flow diagrams.
  Those belong in their specific docs.
- The document should work without any images or badges, though a simple
  architecture badge or license badge at the top is acceptable.
- Every link must be a relative path to an actual file in the repo.
- Read the actual repo structure, package.json files, and existing docs
  before writing. Do not invent package names or file paths.
