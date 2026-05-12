"""
GPU-accelerated embedding builder using sentence-transformers + CUDA.
Reads from hub_static_inventory WHERE embedding IS NULL, writes back pgvector embeddings.

Usage: py -3.11 scripts/bridgify_import/build_embeddings_gpu.py [--batch 512] [--type EXPERIENCE]
"""

import os, sys, time, argparse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

import torch
import psycopg2
import psycopg2.extras
from sentence_transformers import SentenceTransformer

parser = argparse.ArgumentParser()
parser.add_argument('--batch', type=int, default=512)
parser.add_argument('--type', default='EXPERIENCE')
parser.add_argument('--fetch-size', type=int, default=5000)
args = parser.parse_args()

DB_URL = os.environ['DATABASE_URL']

print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Using device: {device}")

print("Loading all-MiniLM-L6-v2...")
model = SentenceTransformer('all-MiniLM-L6-v2', device=device)
print("Model loaded")

def build_input(row):
    rid, title, city, country, category, route_origin, description = row
    parts = [title]
    if city: parts.append(city)
    if country: parts.append(country)
    if category: parts.append(category)
    if route_origin: parts.append(f"airport transfer {route_origin}")
    if description: parts.append(description[:200])
    return rid, ' | '.join(parts)

conn = psycopg2.connect(DB_URL)
conn.autocommit = False

with conn.cursor() as cur:
    cur.execute(
        "SELECT COUNT(*) FROM hub_static_inventory WHERE type = %s AND is_active = true AND embedding IS NULL",
        (args.type,)
    )
    total = cur.fetchone()[0]

print(f"{total} records need embeddings")
if total == 0:
    print("Nothing to do")
    conn.close()
    sys.exit(0)

processed = 0
t0 = time.time()

while True:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, title, city, country, category, route_origin, description
               FROM hub_static_inventory
               WHERE type = %s AND is_active = true AND embedding IS NULL
               LIMIT %s""",
            (args.type, args.fetch_size)
        )
        rows = cur.fetchall()

    if not rows:
        break

    inputs = [build_input(r) for r in rows]
    ids = [i[0] for i in inputs]
    texts = [i[1] for i in inputs]

    for i in range(0, len(texts), args.batch):
        batch_texts = texts[i:i+args.batch]
        batch_ids = ids[i:i+args.batch]

        embeddings = model.encode(batch_texts, normalize_embeddings=True, show_progress_bar=False)

        update_data = []
        for rid, emb in zip(batch_ids, embeddings):
            vec_str = '[' + ','.join(str(float(v)) for v in emb) + ']'
            update_data.append((vec_str, rid))

        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(
                cur,
                "UPDATE hub_static_inventory SET embedding = %s WHERE id = %s",
                update_data,
                page_size=512
            )
        conn.commit()

        processed += len(batch_texts)
        if processed % 5000 == 0 or processed == total:
            elapsed = time.time() - t0
            rate = processed / elapsed
            eta = (total - processed) / rate if rate > 0 else 0
            pct = processed / total * 100
            print(f"{processed}/{total} ({pct:.1f}%) | {rate:.0f}/sec | ETA: {eta/60:.1f} min", flush=True)

elapsed = time.time() - t0
print(f"\nDone — {processed} embeddings in {elapsed/60:.1f} min ({processed/elapsed:.0f}/sec)")

conn.close()
