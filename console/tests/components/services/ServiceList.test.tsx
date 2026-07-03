// Copyright 2026 DgVerse LLP
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceList } from '../../../src/components/services/ServiceList';

describe('ServiceList', () => {
  it('shows an empty state', () => {
    render(<ServiceList services={[]} />);
    expect(screen.getByText(/no services registered/i)).toBeInTheDocument();
  });

  it('renders dashes for missing optional fields', () => {
    render(<ServiceList services={[{ serviceName: 'bare-service' }]} />);
    expect(screen.getByText('bare-service')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});
