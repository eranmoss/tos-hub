import pg from 'pg';

const { Pool } = pg;

let pool = null;

export const getPool = () => {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
};

export const query = (text, params) => getPool().query(text, params);

export const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
