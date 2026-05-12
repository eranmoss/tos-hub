import { useEffect, useState, useCallback } from 'react';
import { getInventory } from '../api/dashboard.js';

export const useInventory = (initialFilters = {}) => {
  const [filters, setFilters] = useState({ page: 1, limit: 50, ...initialFilters });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getInventory(filters);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, filters, setFilters, refetch };
};
