// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentList } from '../../../src/components/agents/AgentList';
import type { VCSummary } from '../../../src/api/types';

const longDid = 'did:hedera:testnet:z6MkVeryLongIdentifier12345';
const agent: VCSummary = {
  vcId: 'vc:helix:1',
  subjectDid: longDid,
  agentName: 'billing-agent',
  scopes: ['read:orders'],
  status: 'active',
  issuedAt: '2026-06-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
};

describe('AgentList', () => {
  it('shows an empty state', () => {
    render(<AgentList agents={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/no agents found/i)).toBeInTheDocument();
  });

  it('truncates long DIDs and keeps short ones intact', () => {
    const shortDid = 'did:key:abc';
    render(
      <AgentList
        agents={[agent, { ...agent, vcId: 'vc:helix:2', subjectDid: shortDid }]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('did:key:abc')).toBeInTheDocument();
    expect(screen.getByTitle(longDid)).toHaveTextContent('…');
  });

  it('copies the full DID without selecting the row', async () => {
    const onSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AgentList agents={[agent]} onSelect={onSelect} />);
    await userEvent.click(screen.getByTitle(longDid));

    expect(writeText).toHaveBeenCalledWith(longDid);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the row on click and renders agents without a name', async () => {
    const onSelect = vi.fn();
    const { agentName: _omitted, ...rest } = agent;
    const unnamed: VCSummary = { ...rest, vcId: 'vc:helix:3' };
    render(<AgentList agents={[unnamed]} onSelect={onSelect} />);

    await userEvent.click(screen.getByText('—'));
    expect(onSelect).toHaveBeenCalledWith(unnamed);
  });
});
