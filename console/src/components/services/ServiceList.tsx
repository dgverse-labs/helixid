// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { ServiceRecord } from '../../api/types';

export interface ServiceListProps {
  services: ServiceRecord[];
}

export function ServiceList({ services }: ServiceListProps) {
  if (services.length === 0) {
    return <p className="empty-state">No services registered.</p>;
  }
  return (
    <table className="service-list">
      <thead>
        <tr>
          <th>Service</th>
          <th>Display name</th>
          <th>Domain</th>
          <th>API endpoint</th>
        </tr>
      </thead>
      <tbody>
        {services.map((service) => (
          <tr key={service.serviceName}>
            <td>{service.serviceName}</td>
            <td>{service.displayName ?? '—'}</td>
            <td>{service.verifiedDomain ?? '—'}</td>
            <td>{service.apiEndpoint ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
