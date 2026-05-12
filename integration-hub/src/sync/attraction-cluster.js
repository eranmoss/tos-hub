import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { getDistance } from 'geolib';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const GEO_RADIUS_M = 200;
const MIN_PHRASE_COUNT = 3;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'of', 'and', 'with', 'from', 'for', 'to',
  'by', 'at', 'on', 'or', 'its', 'your', 'our', 'is', 'are', 'be',
  'tour', 'experience', 'visit', 'skip', 'line', 'access', 'priority',
  'guided', 'private', 'group', 'day', 'half', 'full', 'ticket', 'trip',
  'excursion', 'entry', 'admission', 'small', 'ride', 'pass', 'option',
  'included', 'free', 'vip', 'combo', 'express', 'premium', 'ultimate',
  'exclusive', 'special', 'best', 'top', 'amazing', 'walking',
  'self', 'audio', 'guide', 'hop', 'off', 'highlights', 'early',
  'morning', 'evening', 'night', 'sunset', 'sunrise',
  'hour', 'hours', 'minute', 'minutes', 'min',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  // generic activity types — not landmarks
  'museum', 'cruise', 'desert', 'wine', 'food', 'tasting', 'cooking',
  'class', 'show', 'dinner', 'lunch', 'breakfast', 'city', 'old', 'town',
  'market', 'street', 'beach', 'island', 'lake', 'river', 'mountain',
  'park', 'garden', 'palace', 'castle', 'church', 'cathedral', 'temple',
  'pub', 'bar', 'crawl', 'nightlife', 'shopping', 'transfer', 'airport',
  'hotel', 'resort', 'spa', 'massage', 'yoga', 'meditation',
  'safari', 'snorkeling', 'diving', 'surfing', 'kayaking', 'hiking',
  'biking', 'cycling', 'sailing', 'fishing', 'camping',
  'photo', 'photography', 'instagram', 'panoramic', 'scenic',
  'local', 'traditional', 'authentic', 'cultural', 'historical',
  'adventure', 'bus', 'pick', 'up', 'pickup', 'drop', 'dropoff',
  'balloon', 'beer', 'rafting', 'zipline', 'zip', 'atv', 'quad',
  'jeep', 'buggy', 'segway', 'scooter', 'boat', 'ferry', 'catamaran',
  'jet', 'ski', 'canoe', 'raft', 'sightseeing', 'rooftop',
  'turkish', 'al', 'el', 'la', 'le', 'les', 'de', 'del', 'di', 'das', 'den', 'het',
  'san', 'santa', 'santo', 'saint', 'st', 'mt',
  'activities', 'activity', 'tuk', 'camel', 'horse', 'donkey',
  'water', 'land', 'sea', 'ocean', 'harbor', 'harbour', 'port',
  'dining', 'restaurant', 'cafe', 'brunch', 'supper',
  'entrance', 'tickets', 'canal', 'route', 'circuit', 'trail',
  'package', 'bundle', 'deal', 'voucher', 'card', 'coupon',
  'optional', 'family', 'families', 'kids', 'children', 'adults',
  'transport', 'transportation', 'bike', 'bicycle', 'electric',
  'backstage', 'immersive', 'virtual', 'vr', 'ar', 'lights',
  'art', 'arts', 'musee', 'museo', 'galerie', 'gallery',
  'vintage', 'classic', 'modern', 'contemporary', 'ancient',
  'french', 'italian', 'spanish', 'german', 'english', 'chinese',
  'japanese', 'korean', 'thai', 'indian', 'mexican', 'greek',
  'fun', 'life', 'discover', 'explore', 'hidden', 'gems', 'secret',
  'cv', 'pre', 'app', 'like', 'open', 'hunt', 'taxi', 'cab',
  'rail', 'train', 'tram', 'metro', 'subway', 'station',
  'du', 'des', 'und', 'van', 'von', 'per', 'con', 'las', 'los',
  'christmas', 'halloween', 'easter', 'summer', 'winter', 'spring',
  'golf', 'cart', 'musical', 'theater', 'theatre', 'concert', 'opera',
  'pizza', 'pasta', 'tapas', 'sushi', 'gelato', 'chocolate',
  'days', 'including', 'big', 'gourmet', 'secrets', 'audioguide',
  'round', 'session', 'tableau', 'principal', 'rental', 'history',
  'legends', 'curious', 'travel', 'yacht', 'speedboat',
  'macaron', 'croissant', 'cheese', 'truffle', 'oyster',
]);

const extractLandmark = (title, geoNames) =>
  String(title || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w) && !(geoNames && geoNames.has(w)))
    .join(' ')
    .trim();

const geocluster = (records) => {
  // Grid-based spatial index for O(n) clustering instead of O(n*clusters)
  const cellSize = GEO_RADIUS_M / 111000; // degrees (approx 200m)
  const grid = new Map();
  const clusters = [];

  const cellKey = (lat, lng) => `${Math.floor(lat / cellSize)}:${Math.floor(lng / cellSize)}`;

  for (const rec of records) {
    const key = cellKey(rec.latitude, rec.longitude);
    let assigned = false;

    // Check neighboring cells (3x3 grid around record)
    const latCell = Math.floor(rec.latitude / cellSize);
    const lngCell = Math.floor(rec.longitude / cellSize);
    for (let di = -1; di <= 1 && !assigned; di++) {
      for (let dj = -1; dj <= 1 && !assigned; dj++) {
        const neighborKey = `${latCell + di}:${lngCell + dj}`;
        const neighborClusters = grid.get(neighborKey);
        if (!neighborClusters) continue;
        for (const clIdx of neighborClusters) {
          const cl = clusters[clIdx];
          const dist = getDistance(
            { latitude: rec.latitude, longitude: rec.longitude },
            { latitude: cl.centroid.lat, longitude: cl.centroid.lng },
          );
          if (dist <= GEO_RADIUS_M) {
            cl.members.push(rec);
            assigned = true;
            break;
          }
        }
      }
    }

    if (!assigned) {
      const clIdx = clusters.length;
      clusters.push({
        centroid: { lat: rec.latitude, lng: rec.longitude },
        members: [rec],
      });
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(clIdx);
    }
  }
  return clusters;
};

const FILTER_OUT = new Set([
  // generic geo
  'national', 'center', 'centre', 'square', 'gate',
  'point', 'falls', 'bay', 'valley', 'hill', 'rock', 'cape',
  'world', 'grand', 'royal', 'great', 'major', 'new',
  'waterfall', 'waterfalls', 'rainforest', 'jungle', 'forest',
  'nord', 'sud', 'est', 'west', 'north', 'south', 'east',
  // generic activity words that slip through STOP_WORDS
  'all', 'walk', 'hike', 'luxury', 'car', 'nature', 'through',
  'culture', 'game', 'nights', 'wildlife', 'kayak', 'riding',
  'heritage', 'trek', 'trekking', 'professional', 'shared',
  'romantic', 'workshop', 'sanctuary', 'inclusive', 'photographer',
  'photoshoot', 'scavenger', 'live', 'welcome', 'hire', 'exciting',
  'out', 'nami', 'expert', 'underground', 'aperitif', 'tastings',
  // German/other common non-landmark words
  'mit', 'zum', 'und', 'durch', 'eine', 'einem', 'einer', 'besondere',
  'kurz', 'lecker', 'rundgang', 'linienfahrten', 'erschmecken',
  // countries / regions (not landmarks)
  'russia', 'china', 'japan', 'india', 'brazil', 'mexico', 'egypt',
  'thailand', 'vietnam', 'indonesia', 'malaysia', 'australia',
  'france', 'germany', 'italy', 'spain', 'portugal', 'greece',
  'turkey', 'morocco', 'kenya', 'peru', 'colombia', 'argentina',
  'cuba', 'bali', 'andean', 'nyc', 'usa', 'uk',
]);

const extractAttractions = (geoMembers, geoNames) => {
  const phraseMembers = new Map();

  for (const rec of geoMembers) {
    const tokens = extractLandmark(rec.title, geoNames).split(/\s+/).filter(Boolean);
    for (let n = 1; n <= Math.min(4, tokens.length); n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const phrase = tokens.slice(i, i + n).join(' ');
        if (!phraseMembers.has(phrase)) phraseMembers.set(phrase, new Set());
        phraseMembers.get(phrase).add(rec.id);
      }
    }
  }

  const isJunkPhrase = (phrase) => {
    if (FILTER_OUT.has(phrase)) return true;
    const words = phrase.split(' ');
    if (words.length === 1 && geoNames.has(phrase)) return true;
    if (words.every(w => geoNames.has(w) || FILTER_OUT.has(w))) return true;
    // Single words under 4 chars are almost never real landmarks
    if (words.length === 1 && phrase.length < 4) return true;
    // Single common English/German words — not proper nouns
    if (words.length === 1 && /^[a-z]+$/.test(phrase) && phrase.length < 7) return true;
    return false;
  };

  const candidates = [...phraseMembers.entries()]
    .filter(([phrase, ids]) => ids.size >= MIN_PHRASE_COUNT && !isJunkPhrase(phrase))
    .map(([phrase, ids]) => ({ phrase, ids, wordCount: phrase.split(' ').length }))
    .sort((a, b) => b.wordCount - a.wordCount || b.ids.size - a.ids.size);

  const attractions = [];
  const assignedIds = new Set();

  for (const cand of candidates) {
    const unassigned = [...cand.ids].filter(id => !assignedIds.has(id));
    if (unassigned.length >= MIN_PHRASE_COUNT) {
      attractions.push({ phrase: cand.phrase, memberIds: new Set(cand.ids) });
      for (const id of cand.ids) assignedIds.add(id);
    }
  }

  // Merge pass: if attraction A's phrase contains attraction B's phrase
  // (e.g. "eiffel tower summit" contains "eiffel tower"), merge A into B.
  // This unifies variants like "eiffel tower floor", "eiffel tower summit",
  // "eiffel tower reserved" under the common root "eiffel tower".
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = attractions.length - 1; i >= 0; i--) {
      const a = attractions[i];
      if (!a) continue;
      for (let j = 0; j < attractions.length; j++) {
        if (i === j || !attractions[j]) continue;
        const b = attractions[j];
        const aWords = a.phrase.split(' ');
        const bWords = b.phrase.split(' ');
        // Check if shorter phrase is a sub-sequence of the longer one
        const shorter = aWords.length <= bWords.length ? a : b;
        const longer = aWords.length <= bWords.length ? b : a;
        if (shorter.phrase === longer.phrase) continue;
        if (longer.phrase.includes(shorter.phrase)) {
          // Merge longer into shorter (keep the more general name)
          for (const id of longer.memberIds) shorter.memberIds.add(id);
          const longerIdx = longer === a ? i : j;
          const shorterIdx = shorter === a ? i : j;
          attractions[longerIdx] = null;
          merged = true;
          break;
        }
      }
    }
  }

  return attractions.filter(Boolean);
};

const resolveDisplayName = (phrase, members) => {
  const phraseTokens = phrase.split(' ');
  const joined = phraseTokens.join(' ');
  for (const rec of members) {
    const titleLower = rec.title.toLowerCase();
    const idx = titleLower.indexOf(joined);
    if (idx !== -1) {
      return rec.title.substring(idx, idx + joined.length)
        .replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  return phrase.replace(/\b\w/g, c => c.toUpperCase());
};

const pickBestImage = (members) => {
  const withImages = members
    .filter(m => m.image_urls?.length)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return withImages[0]?.image_urls[0] || null;
};

const computeCentroid = (members) => {
  const lats = members.filter(m => m.latitude).map(m => m.latitude);
  const lngs = members.filter(m => m.longitude).map(m => m.longitude);
  if (!lats.length) return { lat: null, lng: null };
  return {
    lat: lats.reduce((s, v) => s + v, 0) / lats.length,
    lng: lngs.reduce((s, v) => s + v, 0) / lngs.length,
  };
};

const pickCategory = (members) => {
  const freq = {};
  for (const m of members) {
    if (m.category) freq[m.category] = (freq[m.category] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

export const clusterAttractions = async ({ onProgress } = {}) => {
  const t0 = Date.now();
  log('info', 'attraction_cluster_start');

  await query(`UPDATE hub_static_inventory SET attraction_id = NULL WHERE attraction_id IS NOT NULL`);
  await query(`DELETE FROM hub_attractions`);

  const { rows: cities } = await query(`
    SELECT LOWER(TRIM(city)) AS city, country, COUNT(*)::int AS cnt
    FROM hub_static_inventory
    WHERE type = 'EXPERIENCE'
      AND is_active = true
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND city IS NOT NULL
    GROUP BY LOWER(TRIM(city)), country
    HAVING COUNT(*) >= 3
    ORDER BY cnt DESC
  `);

  log('info', 'attraction_cluster_cities', { count: cities.length });

  const allCityNames = new Set();
  for (const { city: c, country: co } of cities) {
    for (const token of c.toLowerCase().split(/\s+/)) {
      if (token.length > 1) allCityNames.add(token);
    }
    if (co) {
      for (const token of co.toLowerCase().split(/\s+/)) {
        if (token.length > 1) allCityNames.add(token);
      }
    }
  }

  let totalAttractions = 0;
  let totalLinked = 0;

  const upsertAttraction = async (attr, records, city, country, allAssigned) => {
    const members = records.filter(m => attr.memberIds.has(m.id));
    if (members.length < MIN_PHRASE_COUNT) return;
    const displayName = resolveDisplayName(attr.phrase, members);
    const centroid = computeCentroid(members);
    const bestImage = pickBestImage(members);
    const cat = pickCategory(members);

    const uniqueProducts = new Set(members.map(m => `${m.supplier_slug}::${m.title}`)).size;

    const { rows: [row] } = await query(`
      INSERT INTO hub_attractions (name, display_name, city, country,
                                   latitude, longitude, category,
                                   experience_count, unique_product_count, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (name, city) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        category = EXCLUDED.category,
        experience_count = EXCLUDED.experience_count,
        unique_product_count = EXCLUDED.unique_product_count,
        image_url = EXCLUDED.image_url,
        updated_at = now()
      RETURNING id
    `, [attr.phrase, displayName, city, country,
        centroid.lat, centroid.lng, cat,
        members.length, uniqueProducts, bestImage]);

    const memberIds = members.map(m => m.id);
    await query(
      `UPDATE hub_static_inventory SET attraction_id = $1 WHERE id = ANY($2)`,
      [row.id, memberIds],
    );
    for (const id of memberIds) allAssigned.add(id);
    totalAttractions++;
    totalLinked += memberIds.length;
  };

  let citiesProcessed = 0;
  for (const { city, country } of cities) {
    const { rows: records } = await query(`
      SELECT id, title, latitude, longitude, category, rating,
             image_urls, supplier_slug, price_from, price_currency
      FROM hub_static_inventory
      WHERE type = 'EXPERIENCE'
        AND is_active = true
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND LOWER(TRIM(city)) = $1
      ORDER BY latitude
    `, [city]);

    const allAssigned = new Set();

    // Pass 1: geo-cluster — groups experiences within 200m, then extracts
    // landmark phrases. Works well when suppliers provide precise venue coords.
    const geoClusters = geocluster(records);
    for (const gc of geoClusters) {
      if (gc.members.length < MIN_PHRASE_COUNT) continue;
      const attractions = extractAttractions(gc.members, allCityNames);
      for (const attr of attractions) {
        await upsertAttraction(attr, gc.members, city, country, allAssigned);
      }
    }

    // Pass 2: city-wide title scan — catches landmarks that geo-clustering
    // misses because suppliers tagged experiences to a generic city-center
    // coordinate. Runs across ALL records in the city, skips already-assigned.
    const unassigned = records.filter(r => !allAssigned.has(r.id));
    if (unassigned.length >= MIN_PHRASE_COUNT) {
      const cityAttractions = extractAttractions(unassigned, allCityNames);
      for (const attr of cityAttractions) {
        await upsertAttraction(attr, unassigned, city, country, allAssigned);
      }
    }

    citiesProcessed++;
    const shouldReport = citiesProcessed <= 10 || citiesProcessed % 50 === 0 || citiesProcessed === cities.length;
    if (onProgress && shouldReport) {
      const pct = Math.round((citiesProcessed / cities.length) * 100);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      onProgress(pct, {
        citiesProcessed, totalCities: cities.length,
        totalAttractions, totalLinked,
        progress: `${citiesProcessed}/${cities.length} cities, ${totalAttractions} attractions, ${elapsed}s elapsed`,
      }).catch(() => {});
    }
    if (citiesProcessed <= 20 || records.length >= 500) {
      const citySec = ((Date.now() - t0) / 1000).toFixed(1);
      log('info', 'attraction_city_done', { city, records: records.length, totalAttractions, totalLinked, elapsed: citySec });
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('info', 'attraction_cluster_complete', {
    elapsed_sec: elapsed,
    cities: cities.length,
    attractions_created: totalAttractions,
    experiences_linked: totalLinked,
  });

  return {
    elapsed_sec: parseFloat(elapsed),
    attractions_created: totalAttractions,
    experiences_linked: totalLinked,
  };
};

// --- LLM Validation Pass ---

const LLM_VALIDATE_BATCH = 30;
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_BUDGET_USD = parseFloat(process.env.ATTRACTION_LLM_BUDGET_USD || '2.00');
const HAIKU_INPUT_PER_M = 0.80;
const HAIKU_OUTPUT_PER_M = 4.00;

let llmSpend = 0;

const buildValidationPrompt = (attractions) => {
  const lines = attractions.map((a, i) =>
    `${i + 1}. "${a.display_name}" (city: ${a.city || 'unknown'}, ${a.experience_count} experiences)\n` +
    `   Sample titles: ${a.sample_titles.slice(0, 4).map(t => `"${t}"`).join(', ')}`
  ).join('\n\n');

  return `You are a travel product taxonomy expert. For each "attraction" below, decide whether it represents a REAL named landmark, venue, show, or point-of-interest that tourists visit.

VALID = a real named place/show/landmark (e.g., "Eiffel Tower", "Cirque du Soleil", "Cu Chi Tunnels", "Dharavi")
QUESTIONABLE = might be valid but ambiguous — needs human review (e.g., "Ferrari" could be Ferrari World or just car tours)
INVALID = a generic word, activity type, or adjective that is NOT a specific attraction (e.g., "All", "Walk", "Luxury", "Nature", "Russia")

${lines}

Respond with a JSON array, one per item:
[{"idx":1,"decision":"VALID"|"QUESTIONABLE"|"INVALID","reason":"<5 words>"},...]

Return ONLY the JSON array.`;
};

export const validateAttractions = async (tenantId = 't_demo') => {
  const t0 = Date.now();
  log('info', 'attraction_validate_start');
  llmSpend = 0;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { rows: attractions } = await query(`
    SELECT a.id, a.name, a.display_name, a.city, a.experience_count
    FROM hub_attractions a
    WHERE a.experience_count >= 3
    ORDER BY a.experience_count DESC
  `);

  log('info', 'attraction_validate_count', { total: attractions.length });

  // Load sample titles for each attraction
  for (const attr of attractions) {
    const { rows } = await query(
      `SELECT title FROM hub_static_inventory WHERE attraction_id = $1 LIMIT 5`,
      [attr.id]
    );
    attr.sample_titles = rows.map(r => r.title);
  }

  let validated = 0, questionable = 0, invalid = 0, dismantled = 0;

  for (let i = 0; i < attractions.length; i += LLM_VALIDATE_BATCH) {
    if (llmSpend >= LLM_BUDGET_USD) {
      log('warn', 'attraction_validate_budget_exhausted', {
        spent: llmSpend.toFixed(4), remaining: attractions.length - i,
      });
      break;
    }

    const batch = attractions.slice(i, i + LLM_VALIDATE_BATCH);

    try {
      const resp = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildValidationPrompt(batch) }],
      });

      const inp = resp.usage?.input_tokens || 0;
      const out = resp.usage?.output_tokens || 0;
      llmSpend += (inp / 1e6) * HAIKU_INPUT_PER_M + (out / 1e6) * HAIKU_OUTPUT_PER_M;

      const text = resp.content[0]?.text || '[]';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      for (let k = 0; k < batch.length; k++) {
        const attr = batch[k];
        const result = parsed[k];
        const decision = result?.decision || 'VALID';

        if (decision === 'INVALID') {
          // Dismantle: unlink members, delete attraction
          await query(`UPDATE hub_static_inventory SET attraction_id = NULL WHERE attraction_id = $1`, [attr.id]);
          await query(`DELETE FROM hub_attractions WHERE id = $1`, [attr.id]);
          invalid++;
          dismantled += attr.experience_count;
        } else if (decision === 'QUESTIONABLE') {
          // Flag for human review
          await query(`
            INSERT INTO hub_escalations (tenant_id, prompt_key, trigger_data, status, expires_at)
            VALUES ($1, 'attraction.validation.questionable', $2, 'PENDING', now() + interval '30 days')
          `, [tenantId, JSON.stringify({
            attraction_id: attr.id,
            name: attr.display_name,
            city: attr.city,
            experience_count: attr.experience_count,
            sample_titles: attr.sample_titles,
            reason: result?.reason,
          })]);
          questionable++;
        } else {
          validated++;
        }
      }

      if ((i + LLM_VALIDATE_BATCH) % 90 === 0 || i + LLM_VALIDATE_BATCH >= attractions.length) {
        log('info', 'attraction_validate_progress', {
          processed: Math.min(i + LLM_VALIDATE_BATCH, attractions.length),
          total: attractions.length,
          validated, questionable, invalid, dismantled,
          cost_usd: llmSpend.toFixed(4),
        });
      }
    } catch (err) {
      log('warn', 'attraction_validate_batch_error', { batch_start: i, error: err.message });
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('info', 'attraction_validate_complete', {
    elapsed_sec: elapsed,
    validated, questionable, invalid, dismantled,
    cost_usd: llmSpend.toFixed(4),
  });

  return { elapsed_sec: parseFloat(elapsed), validated, questionable, invalid, dismantled, cost_usd: llmSpend };
};

if (process.argv[1]?.includes('attraction-cluster')) {
  const mode = process.argv[2]; // 'validate' runs validation only
  import('dotenv/config').then(() => {
    const run = mode === 'validate'
      ? validateAttractions()
      : clusterAttractions();
    run
      .then(result => {
        console.log(`\n=== ${mode === 'validate' ? 'Validation' : 'Attraction clustering'} complete ===`);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      })
      .catch(err => {
        console.error('Fatal:', err.message);
        process.exit(1);
      });
  });
}
