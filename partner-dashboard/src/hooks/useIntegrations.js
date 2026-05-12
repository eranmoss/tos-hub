import { useState, useEffect, useCallback } from 'react';
import { getSuppliers } from '../api/dashboard.js';

export const useIntegrations = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const d = await getSuppliers();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, error, loading, refetch };
};
