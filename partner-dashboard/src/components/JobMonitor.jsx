import { useState, useEffect, useRef } from 'react';
import { getJobs, restartJob, cancelJob } from '../api/dashboard.js';

const JOB_TYPE_LABELS = {
  sync: 'Sync',
  dedup: 'Dedup',
  llm_judge: 'LLM Judge',
  embeddings: 'Embeddings',
  enrich: 'Enrich',
  attraction_cluster: 'Attraction Cluster',
  attraction_validate: 'Attraction Validate',
};

const STATUS_STYLE = {
  RUNNING: 'bg-blue-500 animate-pulse',
  COMPLETE: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  CANCELLED: 'bg-amber-500',
};

const formatDuration = (sec) => {
  if (!sec || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
};

const formatTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ProgressBar = ({ pct }) => (
  <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
    <div
      className="h-full bg-accent rounded-full transition-all duration-500"
      style={{ width: `${Math.max(pct || 0, 2)}%` }}
    />
  </div>
);

const DetailBadge = ({ label, value }) => value != null && value !== '' ? (
  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
    {label}: {typeof value === 'number' ? value.toLocaleString() : value}
  </span>
) : null;

export default function JobMonitor() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const intervalRef = useRef(null);

  const load = () => {
    getJobs()
      .then(d => setJobs(d.jobs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 10000);
      return () => clearInterval(intervalRef.current);
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [autoRefresh]);

  const [restarting, setRestarting] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const handleRestart = async (jobId) => {
    setRestarting(jobId);
    try {
      await restartJob(jobId);
      setTimeout(load, 1000);
    } catch (e) {
      console.error('Restart failed:', e);
    } finally {
      setRestarting(null);
    }
  };

  const handleCancel = async (jobId) => {
    setCancelling(jobId);
    try {
      await cancelJob(jobId);
      setTimeout(load, 1000);
    } catch (e) {
      console.error('Cancel failed:', e);
    } finally {
      setCancelling(null);
    }
  };

  const runningCount = jobs.filter(j => j.status === 'RUNNING').length;
  const shown = filter === 'ALL' ? jobs : jobs.filter(j => j.status === filter);

  if (loading) return <div className="text-text-secondary text-sm p-4">Loading jobs...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="font-semibold text-primary text-sm">Background Jobs</h3>
        {runningCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            {runningCount} running
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (10s)
          </label>
          <button
            type="button"
            onClick={load}
            className="text-xs px-2.5 py-1 rounded-btn border border-border-default text-text-secondary hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {['ALL', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'].map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-btn border ${
              filter === f ? 'bg-accent text-white border-accent' : 'border-border-default text-text-secondary'
            }`}
          >
            {f} ({f === 'ALL' ? jobs.length : jobs.filter(j => j.status === f).length})
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="bg-card-bg border border-border-default rounded-card p-8 text-center text-text-secondary text-sm">
          No jobs match this filter.
        </div>
      )}

      <div className="space-y-2">
        {shown.map(job => {
          const detail = typeof job.progress_detail === 'string'
            ? JSON.parse(job.progress_detail) : job.progress_detail;
          const isRunning = job.status === 'RUNNING';

          return (
            <div
              key={job.id}
              className={`bg-card-bg border rounded-card p-4 ${
                isRunning ? 'border-blue-300' : job.status === 'FAILED' ? 'border-red-200' : 'border-border-default'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_STYLE[job.status] || 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-primary">
                      {JOB_TYPE_LABELS[job.job_type] || job.job_type || 'Sync'}
                    </span>
                    <span className="text-[10px] text-text-secondary">
                      {job.supplier_slug}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-text-secondary flex-shrink-0">
                  <div>{formatTime(job.started_at)}</div>
                  <div className="font-mono">{formatDuration(job.elapsed_sec)}</div>
                </div>
              </div>

              {isRunning && (
                <div className="flex items-center gap-2">
                  <div className="flex-1"><ProgressBar pct={job.progress_pct} /></div>
                  <button
                    type="button"
                    onClick={() => handleCancel(job.id)}
                    disabled={cancelling === job.id}
                    className="text-xs px-2.5 py-0.5 rounded-btn border border-red-400 text-red-500 hover:bg-red-500 hover:text-white disabled:opacity-50 transition-colors flex-shrink-0"
                  >
                    {cancelling === job.id ? 'Stopping...' : 'Stop'}
                  </button>
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {job.progress_pct != null && (
                  <DetailBadge label="Progress" value={`${job.progress_pct}%`} />
                )}
                {job.records_upserted > 0 && <DetailBadge label="Upserted" value={job.records_upserted} />}
                {job.records_fetched > 0 && <DetailBadge label="Fetched" value={job.records_fetched} />}
                {job.records_errored > 0 && <DetailBadge label="Errors" value={job.records_errored} />}
                {detail?.totals?.duplicates != null && (
                  <DetailBadge label="Duplicates" value={detail.totals.duplicates} />
                )}
                {detail?.totals?.clusters != null && (
                  <DetailBadge label="Clusters" value={detail.totals.clusters} />
                )}
                {detail?.totalAttractions != null && (
                  <DetailBadge label="Attractions" value={detail.totalAttractions} />
                )}
                {detail?.totalLinked != null && (
                  <DetailBadge label="Linked" value={detail.totalLinked} />
                )}
                {detail?.progress && (
                  <span className={`text-text-secondary ${isRunning ? 'text-xs font-medium text-blue-600 basis-full' : 'text-[10px]'}`}>
                    {detail.progress}
                  </span>
                )}
                {isRunning && detail?.totals?.pairs_checked != null && (
                  <DetailBadge label="Pairs" value={detail.totals.pairs_checked} />
                )}
                {detail?.totals?.uncertain != null && detail.totals.uncertain > 0 && (
                  <DetailBadge label="Uncertain" value={detail.totals.uncertain} />
                )}
              </div>

              {(job.status === 'FAILED' || job.status === 'COMPLETE' || job.status === 'CANCELLED') && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRestart(job.id)}
                    disabled={restarting === job.id}
                    className="text-xs px-3 py-1 rounded-btn border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50 transition-colors"
                  >
                    {restarting === job.id ? 'Restarting...' : 'Restart'}
                  </button>
                </div>
              )}

              {job.error_message && (
                <div className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2 truncate" title={job.error_message}>
                  {job.error_message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
