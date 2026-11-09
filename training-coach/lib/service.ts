import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { allSessions, adapt, dateAt, snapshot, type Feedback } from './model';
import { fetchGarmin, type Activity } from './garmin';

const weekSchema = z.number().int().min(1).max(24);
const feedbackSchema = z.object({
  sessionId: z.string().max(40), version: z.number().int().min(0),
  status: z.enum(['planned', 'done', 'modified', 'skipped']), option: z.string().max(30),
  actualMinutes: z.number().min(0).max(1440).nullable(), effort: z.number().int().min(1).max(10).nullable(),
  signal: z.enum(['normal', 'fatigue', 'pain', 'time']), comment: z.string().max(2000),
  activityId: z.string().max(50).nullable().optional(),
}).strict();
const interpretationSchema = z.object({ sessionId: z.string(), version: z.number().int().min(1), signal: z.enum(['normal', 'fatigue', 'pain', 'time']), interpretation: z.string().min(1).max(500) }).strict();

function database() { if (!env.DB) throw new Error('Training storage has not been configured.'); return env.DB; }
async function readLogs(owner: string) {
  const result = await database().prepare('SELECT e.data FROM session_events e JOIN (SELECT session, MAX(version) version FROM session_events WHERE owner = ? GROUP BY session) latest ON e.session = latest.session AND e.version = latest.version WHERE e.owner = ?').bind(owner, owner).all<{data: string}>();
  const latest = new Map<string, Feedback>();
  for (const row of result.results) { const log = JSON.parse(row.data) as Feedback; if (!latest.has(log.sessionId)) latest.set(log.sessionId, log); }
  return [...latest.values()];
}
async function append(owner: string, log: Feedback) {
  try {
    await database().prepare('INSERT INTO session_events (owner, session, version, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(owner, log.sessionId, log.version, JSON.stringify(log), new Date().toISOString()).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('This workout changed on another device. Refresh before saving again.');
    throw new Error('The workout could not be saved. Your draft has not been discarded.');
  }
}
export async function action(owner: string, name: string, input: unknown) {
  const logs = await readLogs(owner);
  if (name === 'get_plan' || name === 'sync_garmin') {
    const { week } = z.object({ week: weekSchema }).strict().parse(input);
    let sync: { count: number; truncated: boolean } | undefined;
    const key = (env as unknown as { GARMIN_API_KEY?: string }).GARMIN_API_KEY;
    if (name === 'sync_garmin') {
      if (!key) throw new Error('Add GARMIN_API_KEY as a secret in your personal hosting account first. Never paste the key into chat.');
      const result = await fetchGarmin(key, dateAt(week), dateAt(week, 6));
      if (result.records.length) await database().batch(result.records.map(a => database().prepare('INSERT INTO activities (owner, id, data) VALUES (?, ?, ?) ON CONFLICT(owner, id) DO UPDATE SET data=excluded.data').bind(owner, a.id, JSON.stringify(a))));
      sync = { count: result.records.length, truncated: result.truncated };
    }
    const rows = await database().prepare('SELECT data FROM activities WHERE owner = ?').bind(owner).all<{data: string}>();
    const activities = rows.results.map(r => JSON.parse(r.data) as Activity).filter(a => a.date >= dateAt(week) && a.date <= dateAt(week, 6));
    return { ...snapshot(week, logs, activities, !!key), sync };
  }
  if (name === 'save_feedback') {
    const data = feedbackSchema.parse(input);
    const session = allSessions.find(s => s.id === data.sessionId);
    if (!session || !session.options.some(o => o.id === data.option)) throw new Error('Unknown session or workout option.');
    const previous = logs.find(l => l.sessionId === data.sessionId);
    if ((previous?.version || 0) !== data.version) throw new Error('This workout changed on another device. Refresh before saving again.');
    if (data.activityId) {
      if (logs.some(l => l.sessionId !== data.sessionId && l.activityId === data.activityId)) throw new Error('This Garmin activity is already linked to another session.');
      const row = await database().prepare('SELECT data FROM activities WHERE owner = ? AND id = ?').bind(owner, data.activityId).first<{data: string}>();
      if (!row) throw new Error('Sync this Garmin activity before linking it.');
      const activity = JSON.parse(row.data) as Activity;
      const kind = ['upper', 'lower', 'core', 'plyo'].includes(session.kind) ? 'strength' : session.kind;
      if (activity.kind !== kind || activity.date !== session.date) throw new Error('Choose a Garmin activity with the same sport and date.');
      data.actualMinutes = activity.minutes;
    }
    const commentChanged = !previous || previous.comment !== data.comment;
    const log: Feedback = { ...data, activityId: data.activityId || null, version: data.version + 1,
      plannedMinutes: previous?.plannedMinutes ?? adapt(session, logs).minutes,
      reviewed: data.comment.length === 0 || (!commentChanged && !!previous?.reviewed),
      interpretation: commentChanged ? '' : (previous?.interpretation || ''),
    };
    await append(owner, log);
    return { saved: log, needsCommentReview: !!log.comment && !log.reviewed, next: snapshot(Math.min(24, session.week + 1), [...logs.filter(l => l.sessionId !== log.sessionId), log]).sessions };
  }
  if (name === 'interpret_feedback') {
    const data = interpretationSchema.parse(input);
    const previous = logs.find(l => l.sessionId === data.sessionId);
    if (!previous || previous.version !== data.version) throw new Error('Read the latest session feedback before interpreting it.');
    const log = { ...previous, signal: data.signal, interpretation: data.interpretation, reviewed: true, version: previous.version + 1 };
    await append(owner, log);
    return { saved: log, message: 'The interpretation is saved and upcoming sessions now use it.' };
  }
  if (name === 'get_history') {
    const { sessionId } = z.object({ sessionId: z.string().max(40) }).strict().parse(input);
    const rows = await database().prepare('SELECT data, created_at FROM session_events WHERE owner = ? AND session = ? ORDER BY version DESC').bind(owner, sessionId).all<{data: string; created_at: string}>();
    return { history: rows.results.map(r => ({ ...JSON.parse(r.data), savedAt: r.created_at })) };
  }
  throw new Error('Unknown training action.');
}

export function safeError(error: unknown) {
  if (error instanceof z.ZodError) return 'Some fields are invalid. Check status, duration, effort, and comment length.';
  return error instanceof Error ? error.message : 'The request failed. Please retry.';
}
