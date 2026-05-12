import { useEffect } from 'react';
import { usePageContext } from '../agent/usePageContext.js';
import JobMonitor from '../components/JobMonitor.jsx';

export default function Jobs() {
  const { register } = usePageContext();
  useEffect(() => { register('jobs', {}); }, [register]);

  return (
    <div className="p-6">
      <JobMonitor />
    </div>
  );
}
