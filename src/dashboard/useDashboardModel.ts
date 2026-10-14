import { useEffect, useState } from 'react';
import { buildStoreDashboard, type StoreDashboardModel } from './model.ts';

function isDashboard(value: unknown): value is StoreDashboardModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    'snapWritten' in value &&
    'salesTeam' in value &&
    'importedThrough' in value &&
    'daysRemaining' in value
  );
}

export function useDashboardModel(): StoreDashboardModel {
  const [model, setModel] = useState<StoreDashboardModel>(() => buildStoreDashboard([]));

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (active && isDashboard(payload)) setModel(payload);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return model;
}
