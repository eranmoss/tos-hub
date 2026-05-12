import { useEffect, useState, useCallback } from 'react';
import { getOverview } from '../api/dashboard.js';

export const useOverview = (pollMs = 30000) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const d = await getOverview();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const t = setInterval(refetch, pollMs);
    return () => clearInterval(t);
  }, [refetch, pollMs]);

  return { data, error, loading, refetch };
};
