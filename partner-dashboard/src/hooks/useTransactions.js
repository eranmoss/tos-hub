import { useEffect, useState, useCallback } from 'react';
import { getTransactions } from '../api/dashboard.js';

export const useTransactions = (initialFilters = {}) => {
  const [filters, setFilters] = useState({ page: 1, limit: 50, ...initialFilters });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getTransactions(filters);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, filters, setFilters, refetch };
};
