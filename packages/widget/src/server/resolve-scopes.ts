// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { CuratedScopeEntry, ScopeOption } from '../types.js';

export type { CuratedScopeEntry, ScopeOption } from '../types.js';

/**
 * The T&C scope. Folded into grant scopes rather than carried as a separate
 * field (consolidated log §4.4), and appended by this resolver rather than
 * listed in any SP's curated catalog (register D8).
 */
export const ACCEPT_TERMS_SCOPE = 'accept-terms';

export interface ResolveConsentScopesOptions {
  mcpServerUrl?: string;
  curatedFallback: CuratedScopeEntry[];
}

/**
 * Shape this resolver reads off an MCP `tools/list` response. Only
 * `metadata.requiredScope` is required for a tool to contribute a scope —
 * the same convention `filterToolsByScope()` already reads.
 */
interface McpTool {
  name?: string;
  description?: string;
  metadata?: {
    requiredScope?: string;
    label?: string;
    description?: string;
    [key: string]: unknown;
  };
}

/**
 * `book:flights` -> `book flights`. Last-resort label so no scope is ever
 * rendered without one.
 */
export function humanizeScope(scope: string): string {
  return scope
    .replace(/[:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchMcpToolScopes(mcpServerUrl: string): Promise<McpTool[]> {
  // Plain JSON-RPC metadata read — no LLM involved, no MCP SDK dependency.
  const response = await fetch(mcpServerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  if (!response.ok) {
    throw new Error(`MCP tools/list responded ${response.status}`);
  }
  const body = (await response.json()) as { result?: { tools?: unknown } };
  const tools = body?.result?.tools;
  return Array.isArray(tools) ? (tools as McpTool[]) : [];
}

/**
 * Resolves the SP's grantable-scope catalog for the consent screen.
 *
 * Output is the full union of curated fallback ∪ MCP tool scopes ∪
 * `accept-terms`. There is deliberately no `requestedScopes` input: the SP
 * always advertises its own complete catalog, because the grant's scopes and
 * the agent's own VC scopes are independently scoped and intersected at
 * verification time (`effectiveScopes`), not merged. An agent narrowing this
 * menu would be constraining a ceiling that has nothing to do with its own.
 * (Epic 5 Part E, superseding this function's original contract.)
 *
 * Note on `agentDid`: the SP route that wraps this function takes an
 * `agentDid` query param, but it is deliberately NOT threaded in here and
 * must not influence the returned catalog — see the route contract in this
 * package's README and register D4.
 *
 * Pure `options -> ScopeOption[]`: no persistence, no auth, no grant signing.
 */
export async function resolveConsentScopes(
  opts: ResolveConsentScopesOptions,
): Promise<ScopeOption[]> {
  // 1. Seed from the SP's curated catalog.
  const resolved = new Map<string, ScopeOption>();
  for (const entry of opts.curatedFallback) {
    resolved.set(entry.scope, {
      scope: entry.scope,
      label: entry.label,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.required !== undefined ? { required: entry.required } : {}),
    });
  }

  // 2. Overlay MCP tool metadata. Every tool carrying a requiredScope
  //    contributes — there is no requested set to filter against. MCP data
  //    wins over curated data for the fields it actually defines.
  if (opts.mcpServerUrl) {
    let tools: McpTool[] = [];
    try {
      tools = await fetchMcpToolScopes(opts.mcpServerUrl);
    } catch {
      // MCP is the enrichment source, curated is the fallback — consolidated
      // log §4.3: "read from SP's MCP role/scope metadata if exposed, else
      // fall back to a manually curated list." An unreachable MCP server
      // yields a curated-only catalog rather than failing the consent page.
      // This narrows what the user can grant; it never widens it.
      tools = [];
    }

    for (const tool of tools) {
      const scope = tool.metadata?.requiredScope;
      if (!scope) continue;

      const existing = resolved.get(scope);
      const label = tool.metadata?.label ?? existing?.label;
      const description = tool.metadata?.description ?? tool.description ?? existing?.description;
      const required = existing?.required;

      resolved.set(scope, {
        scope,
        // Step 5 applies here: an MCP-derived scope whose tool metadata
        // carries no label falls back to humanizeScope() below.
        label: label ?? '',
        ...(description !== undefined ? { description } : {}),
        ...(required !== undefined ? { required } : {}),
      });
    }
  }

  // 3. (Removed by Epic 5 Part E — there is no filtering pass. The output is
  //    the full catalog, not a subset of anything the agent asked for.)

  // 5. Never leave a resolved scope without a label.
  const scopeOptions: ScopeOption[] = [...resolved.values()].map((option) => ({
    ...option,
    label: option.label !== '' ? option.label : humanizeScope(option.scope),
  }));

  // 4. Always append the T&C entry, required and pre-checked.
  scopeOptions.push({
    scope: ACCEPT_TERMS_SCOPE,
    label: 'Accept the terms and conditions',
    required: true,
    defaultChecked: true,
  });

  return scopeOptions;
}
