import axios from 'axios';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class SupplierBase {
  constructor({ slug, baseUrl, timeoutMs = 8000, maxRetries = 3, rateLimitRpm }) {
    this.slug = slug;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.rateLimitRpm = rateLimitRpm ?? 60; // TODO: load from hub_suppliers.rate_limit_rpm
    this._calls = [];
  }

  _trackRate() {
    const now = Date.now();
    this._calls = this._calls.filter(t => now - t < 60000);
    this._calls.push(now);
  }

  async request({ method, url, headers = {}, data, params, operation = 'unknown' }) {
    this._trackRate();
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
    let lastErr;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const start = Date.now();
      try {
        const res = await axios({
          method, url: fullUrl, headers, data, params,
          timeout: this.timeoutMs,
          validateStatus: s => s < 500,
        });
        const elapsed = Date.now() - start;
        if (res.status >= 500) {
          throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, retryable: true });
        }
        if (res.status >= 400) {
          log('warn', 'supplier_client_error', {
            supplier: this.slug, operation, status: res.status, latency_ms: elapsed,
          });
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          err.response = res.data;
          throw err;
        }
        log('info', 'supplier_request', {
          supplier: this.slug, operation, status: res.status, latency_ms: elapsed, attempt,
        });
        return res.data;
      } catch (err) {
        lastErr = err;
        const isRetryable = err.retryable || err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' ||
          (err.status && err.status >= 500);
        log('error', 'supplier_error', {
          supplier: this.slug, operation, attempt,
          error: err.message, code: err.code, status: err.status,
          retryable: isRetryable,
        });
        if (!isRetryable || attempt === this.maxRetries) break;
        const backoff = Math.min(2000, 200 * Math.pow(2, attempt - 1));
        await sleep(backoff);
      }
    }
    throw lastErr;
  }
}
