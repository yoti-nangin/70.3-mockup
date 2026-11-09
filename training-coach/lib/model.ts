import { weeks } from './weeks.ts';

export type Kind = 'swim' | 'bike' | 'run' | 'upper' | 'lower' | 'core' | 'plyo';
export type Feedback = {
  sessionId: string; version: number; status: 'planned' | 'done' | 'modified' | 'skipped';
  option: string; actualMinutes: number | null; effort: number | null;
  signal: 'normal' | 'fatigue' | 'pain' | 'time'; comment: string;
  reviewed: boolean; interpretation: string; activityId: string | null; plannedMinutes: number;
};
export type Session = {
  id: string; week: number; day: number; date: string; kind: Kind; title: string;
  minutes: number; slot: string; options: { id: string; label: string; steps: string }[];
};

export function dateAt(week: number, day = 0) {
  const date = new Date('2026-11-09T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + (week - 1) * 7 + day);
  return date.toISOString().slice(0, 10);
}

const gym: Record<string, string> = {
  upper: `Warm up: 5 min
Workout:
- Bench press: 2 sets × 5–8 reps
- Chest-supported row: 2 sets × 6–10 reps
- Pull-up or pulldown: 2 sets × 6–10 reps
- Overhead or landmine press: 2 sets × 6–10 reps
Effort: Stop each set with 2–3 good reps left.
Weight: Use familiar weights to maintain strength.`,
  lower: `Warm up: 7–8 min
Workout:
- Squat: 3 sets × 5–8 reps
- Romanian deadlift: 2 sets × 6–8 reps
- Supported split squat: 2 sets × 6–8 reps per side
- Calf raise: 2 sets × 10–15 reps
Rest: About 2 min between sets.
Effort: Stop each set with 2–3 good reps left.
Progress: Add the smallest weight increase only when all reps feel comfortable and you recover well.`,
  core: `Workout: 2 controlled rounds
- Dead bug: 6–8 reps per side
- Side plank: 20–30 sec per side
- Pallof press: 8–10 reps per side
- Suitcase carry: 20–30 m per side
Rest: As needed. Keep breathing normally.`,
  plyo: `Warm up: Take time to get warm and practise your landings.
Workout: Once these movements feel comfortable
- Low countermovement jumps: 3 sets × 3 jumps
- Low ankle hops: 2 sets × 5 hops
Rest: 60–120 sec between sets.
Safety: Stop if landings become unstable. No weighted jumps or depth jumps.`,
};

export function sessionsFor(week: number): Session[] {
  const w = weeks[week - 1];
  if (!w) throw new Error('Week must be between 1 and 24.');
  const list: Session[] = [];
  const add = (day: number, kind: Kind, slot: string, title: string, minutes: number) => {
    if (!minutes) return;
    let steps = gym[kind] || (kind === 'swim'
      ? (slot === 'technique' ? 'Warm up: Easy swimming.\nWorkout:\n- Breathing and body-position drills\n- Comfortable 25–100 m repeats, with rest\nCool down: Finish easy.\nFocus: Good form matters more than distance.' : 'Warm up: Easy swimming.\nWorkout:\n- Comfortable longer repeats or continuous swimming\n- Build toward 600 m by week 8, 1,000 m by week 12, and 1,900 m by week 16, when ready\nCool down: Finish easy.')
      : 'Warm up: Start easy.\nWorkout:\n- Keep a pace where you can hold a conversation\n- Slow down on hills\nCool down: Finish easy.\nEffort: 2–4 out of 10.\nTime: Include warm-up and cool-down in the planned minutes.');
    if (kind === 'lower' && week < 4) steps += '\nThis week: Use 1–2 light sets per exercise instead of the full sets above. Stop with 3–4 good reps left.';
    if (kind === 'plyo' && week < 3) steps = 'Warm up: Spend most of the session warming up and practising landings.\nWorkout:\n- If comfortable: 2 sets × 3 small two-foot jumps\n- Reset between each jump\nSafety: Stop if sore or unstable.';
    if (['Ease', 'Holiday'].includes(w.phase) || week >= 17) {
      if (gym[kind]) steps += '\nThis week: Do half the usual working sets to fit the shorter session. Use familiar movements. No personal records.';
    }
    if (week === 23 && gym[kind]) steps = 'Workout:\n- Light, familiar movements only\n- About half the usual sets\nEffort: Keep it light enough to avoid soreness before race day.';
    const options = [{ id: 'standard', label: 'Planned session', steps }];
    if (kind === 'bike' && slot === 'long' && week >= 9 && week <= 22 && !['Ease', 'Rehearsal'].includes(w.phase)) {
      const reps = week < 17 ? ['2×8 min steady; 3 min easy between', '4×4 min steady; 1 min easy between'] : ['2×15 min at sustainable race effort; 5 min easy between', '3×10 min at sustainable race effort; 2½ min easy between'];
      reps.forEach((label, i) => options.push({ id: 'interval' + (i + 1), label, steps: 'Warm up: At least 15 min, easy.\nWorkout:\n- ' + label.replace('; ', '\n- ') + '\nFinish: Keep the remaining time easy.\nTime: Stay within the planned session length.\nRecovery: Choose this only when recovered. It replaces this week’s optional harder brick work.' }));
    }
    if (kind === 'lower') options.push({ id: 'supported', label: 'Supported lower-body variations', steps: steps.replace('Squat:', 'Goblet squat:').replace('Romanian deadlift:', 'Dumbbell Romanian deadlift:').replace('Supported split squat:', 'Supported step-up:') });
    if (kind === 'upper') options.push({ id: 'dumbbells', label: 'Dumbbells and cables', steps: steps.replace('Bench press:', 'Dumbbell bench press:').replace('Chest-supported row:', 'Cable row:').replace('Pull-up or pulldown:', 'Pulldown:').replace('Overhead or landmine press:', 'Landmine press:') });
    options.push({ id: 'easy', label: gym[kind] ? 'Gentle mobility / recovery' : 'Easy technique / endurance', steps: gym[kind] ? 'Workout:\n- Gentle, pain-free mobility or rest\n- No heavier weights or jumping\nLog: Mark this as modified, not a completed strength session.' : 'Workout:\n- Keep the whole session comfortable\n- Take breaks as needed\n- No hard repeats\nLog: Record your actual time.' });
    list.push({ id: `w${week}-${slot}`, week, day, date: dateAt(week, day), kind, slot, title, minutes, options });
  };
  if (week === 24) {
    add(0, 'swim', 'technique', 'Easy swim', 25); add(0, 'core', 'core', 'Gentle core', 10);
    add(1, 'bike', 'easybike', 'Race-week spin', 30); add(2, 'run', 'easyrun', 'Race-week jog', 20);
    add(3, 'swim', 'endurance', 'Easy swim', 20); return list;
  }
  add(0, 'swim', 'technique', 'Technique swim', w.swim[0]);
  add(week === 1 ? 6 : 0, 'upper', 'upper', 'Upper maintenance', w.gym[0]);
  add(1, 'lower', 'lower', 'Lower strength', w.gym[1]); add(1, 'bike', 'easybike', 'Easy bike', w.bikeRun[0]);
  add(2, 'run', 'easyrun', 'Easy run', w.bikeRun[1]); add(2, 'core', 'core', 'Core and carries', w.gym[2]);
  add(3, 'plyo', 'plyo', 'Power and landing', w.gym[3]); add(3, 'swim', 'endurance', 'Endurance swim', w.swim[1]);
  add(5, 'bike', 'long', week === 21 ? '90 km rehearsal — time budget' : 'Long bike', w.longBike);
  add(5, 'run', 'brick', 'Easy brick run', w.brick); add(6, 'run', 'longrun', 'Long run', w.longRun);
  return list.sort((a, b) => a.day - b.day);
}

export const allSessions = weeks.flatMap(w => sessionsFor(w.week));
const sessionIndex = new Map(allSessions.map(s => [s.id, s]));

export function adapt(session: Session, logs: Feedback[]) {
  const own = logs.find(l => l.sessionId === session.id);
  let minutes = session.minutes;
  let option = own?.option || 'standard';
  const reasons: string[] = [];
  if (own && own.status !== 'planned') return { ...session, minutes: own.plannedMinutes, option, reasons, log: own, locked: true };
  const prior = logs.map(log => ({ log, session: sessionIndex.get(log.sessionId) }))
    .filter(x => x.session && x.session.date < session.date && x.session.week >= session.week - 2)
    .sort((a, b) => b.session!.date.localeCompare(a.session!.date));
  const same = prior.find(x => x.session!.slot === session.slot);
  if (!own && same && session.options.some(o => o.id === same.log.option)) option = same.log.option;
  const legKinds = ['run', 'lower', 'plyo', 'bike'];
  const pain = prior.find(x => x.log.signal === 'pain' && legKinds.includes(x.session!.kind) &&
    (Date.parse(session.date) - Date.parse(x.session!.date)) <= 7 * 86400000);
  if (pain && legKinds.includes(session.kind)) {
    minutes = 0; option = 'easy'; reasons.push('Recent pain flag: pause this leg session and reassess before resuming. Do not train through pain.');
  } else if (same) {
    const { log, session: old } = same;
    if (log.comment && !log.reviewed) {
      minutes = Math.min(minutes, old!.minutes);
      reasons.push('Comment awaits interpretation in ChatGPT. Progression is held until it is reviewed.');
    }
    if (log.signal === 'fatigue' || (log.effort !== null && log.effort >= 8)) {
      minutes = Math.min(minutes, Math.max(10, Math.round(old!.minutes * 0.8 / 5) * 5)); option = 'easy';
      reasons.push('The previous comparable session was unusually hard or fatiguing. Use a shorter, easier session.');
    } else if (['modified', 'skipped'].includes(log.status)) {
      minutes = Math.min(minutes, old!.minutes);
      reasons.push(log.signal === 'time' ? 'Time-limited session: hold the progression; do not cram missed work into this week.' : 'Previous session was modified or skipped: repeat a comfortable dose before progressing.');
    } else if (log.status === 'done') reasons.push('Previous comparable session completed: retain the planned progression if recovery remains good.');
    if (log.interpretation) reasons.push(log.interpretation);
  }
  if (option !== 'standard' && same && !own) reasons.push('Retained your previous workout preference where it fits this session.');
  return { ...session, minutes, option, reasons, log: own || null, locked: false };
}

export function snapshot(week: number, logs: Feedback[], activities: unknown[] = [], garminReady = false) {
  return {
    week, phase: weeks[week - 1].phase, raceDate: '2027-04-24',
    sessions: sessionsFor(week).map(s => adapt(s, logs)), activities, garminReady,
    overview: weeks.map(w => {
      const sessions = sessionsFor(w.week).map(s => adapt(s, logs));
      return { week: w.week, phase: w.phase, date: dateAt(w.week), minutes: sessions.reduce((n, s) => n + s.minutes, 0),
        actual: sessions.reduce((n, s) => n + (s.log?.actualMinutes || 0), 0),
        completed: sessions.filter(s => s.log?.status === 'done').length, count: sessions.length };
    }),
  };
}
