export type Activity = {
  id: string; title: string; date: string; kind: string; minutes: number;
  distanceKm: number | null; averageHR: number | null; averagePower: number | null; device: string;
  // Optional so previously imported workouts remain readable until the next sync.
  startTimeLocal?: string | null; durationSeconds?: number; elapsedMinutes?: number | null;
  calories?: number | null; maxHR?: number | null; averageSpeedMps?: number | null;
};

export function normalizeActivity(value: unknown): Activity | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, any>;
  if (a.isParent || a.parent || !a.activityId || !Number.isFinite(a.duration) || a.duration <= 0) return null;
  if (typeof a.activityId === 'number' && !Number.isSafeInteger(a.activityId)) return null;
  const type = String(a.activityType?.typeKey || 'unknown');
  const kind = /run/.test(type) ? 'run' : /cycling|biking/.test(type) ? 'bike' : /swim/.test(type) ? 'swim' : /strength|training/.test(type) ? 'strength' : 'other';
  const date = String(a.startTimeLocal || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const metric = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const localTime = String(a.startTimeLocal || '').replace(' ', 'T');
  const startTimeLocal = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(localTime) ? localTime.slice(0, 19) : null;
  return { id: String(a.activityId), title: String(a.activityName || type).slice(0, 200), date, kind,
    minutes: Math.round(a.duration / 60 * 10) / 10, distanceKm: metric(a.distance) === null ? null : a.distance / 1000,
    averageHR: metric(a.averageHR), averagePower: metric(a.avgPower), device: String(a.deviceName || a.manufacturer || 'Garmin').slice(0, 80),
    startTimeLocal, durationSeconds: a.duration, elapsedMinutes: metric(a.elapsedDuration) === null ? null : a.elapsedDuration / 60,
    calories: metric(a.calories), maxHR: metric(a.maxHR), averageSpeedMps: metric(a.averageSpeed) };
}

export async function fetchGarmin(key: string, start: string, end: string, request = fetch) {
  const origin = 'https://personal.connectapi.garmin.com';
  const auth = await request(origin + '/personalapitoken-service/personal-api/personal-api-key/token', {
    method: 'POST', headers: { Authorization: 'ApiKey ' + key }, signal: AbortSignal.timeout(15000),
  });
  if (!auth.ok) throw new Error(auth.status === 429 ? 'Garmin rate limit reached. Try again later.' : 'Garmin sign-in failed. Check the Personal API key and its expiration.');
  const token = (await auth.text()).trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Garmin returned an unexpected authentication response.');
  const records: Activity[] = [];
  let truncated = false;
  for (let page = 0; page < 4; page++) {
    const query = new URLSearchParams({ start: String(page * 99), limit: '99', startDate: start, endDate: end, excludeChildren: 'false' });
    const response = await request(origin + '/activitylist-service/activities/search/activities?' + query, {
      headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'Garmin rate limit reached. Try again later.' : 'Garmin activities could not be read. Please retry.');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Garmin returned an unexpected activity response.');
    records.push(...data.map(normalizeActivity).filter((a): a is Activity => !!a));
    if (data.length < 99) break;
    if (page === 3) truncated = true;
  }
  return { records, truncated };
}
