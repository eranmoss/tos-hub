import { useEffect } from 'react';
import { usePageContext } from '../agent/usePageContext.js';
import JobMonitor from '../components/JobMonitor.jsx';

export default function SystemLog() {
  const { register } = usePageContext();
  useEffect(() => { register('system-log', {}); }, [register]);

  return (
    <div className="p-6">
      <JobMonitor />
    </div>
  );
}
