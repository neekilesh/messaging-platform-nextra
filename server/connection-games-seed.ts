import crypto from 'node:crypto';
import { count } from 'drizzle-orm';
import type { PgDatabase } from '../src/db/index.ts';
import { dailyChallenges, deepTalkQuestions } from '../src/db/schema.ts';

export interface SeedDeepTalkCategory {
  id: string;
  name: string;
  questions: string[];
}

export const DEEP_TALK_SEED_CATEGORIES: SeedDeepTalkCategory[] = [
  {
    id: 'getting-to-know-you',
    name: 'Getting to Know You',
    questions: [
      "What's something that always makes you smile?",
      "What's your dream destination?",
      'What is one thing people misunderstand about you?',
      'What is your favorite childhood memory?',
      "What's something you've always wanted to learn?",
    ],
  },
  {
    id: 'memories-childhood',
    name: 'Memories & Childhood',
    questions: [
      'What is your happiest childhood memory?',
      'Who influenced your life the most?',
      'What is something you miss about being a child?',
      'What was your favorite childhood dream?',
      "What's one moment you wish you could experience again?",
    ],
  },
  {
    id: 'friendship-relationships',
    name: 'Friendship & Relationships',
    questions: [
      'What makes someone a truly good friend?',
      'What makes you feel appreciated?',
      "What's one quality you value most in people?",
      "What's your favorite memory of us?",
      'What does trust mean to you?',
    ],
  },
  {
    id: 'dreams-future',
    name: 'Dreams & Future',
    questions: [
      'What is your biggest dream?',
      'Where do you imagine yourself in five years?',
      'If money were not a problem, what would you do?',
      "What's one adventure you want to experience?",
      'What motivates you when life gets difficult?',
    ],
  },
  {
    id: 'funny-random',
    name: 'Funny & Random',
    questions: [
      'If you could have any superpower, what would it be?',
      'If you could live in any fictional world, which one?',
      "What's the funniest thing you've ever done?",
      'If you became famous, what would it be for?',
      'What would you do if we suddenly won the lottery?',
    ],
  },
  {
    id: 'deep-meaningful',
    name: 'Deep & Meaningful',
    questions: [
      'What is something you rarely tell people?',
      'When do you feel most understood?',
      'What is one lesson life has taught you?',
      'What does happiness mean to you?',
      'What is something you wish more people understood?',
    ],
  },
];

export interface SeedDailyChallenge {
  id: string;
  categoryId: string;
  categoryName: string;
  promptText: string;
  symbolKey: string;
}

export const DAILY_CHALLENGE_SEED: SeedDailyChallenge[] = [
  // Appreciation Challenges
  {
    id: 'dc_appreciation_1',
    categoryId: 'appreciation',
    categoryName: 'Appreciation Challenges',
    promptText: 'Tell the other person one thing you appreciate about them.',
    symbolKey: 'heart-spark',
  },
  {
    id: 'dc_appreciation_2',
    categoryId: 'appreciation',
    categoryName: 'Appreciation Challenges',
    promptText: 'Share one quality you admire in them.',
    symbolKey: 'heart-spark',
  },
  {
    id: 'dc_appreciation_3',
    categoryId: 'appreciation',
    categoryName: 'Appreciation Challenges',
    promptText: 'Send a message explaining why their friendship matters to you.',
    symbolKey: 'heart-spark',
  },
  // Memory Challenges
  {
    id: 'dc_memory_1',
    categoryId: 'memory',
    categoryName: 'Memory Challenges',
    promptText: 'Share a favorite memory together.',
    symbolKey: 'camera-memory',
  },
  {
    id: 'dc_memory_2',
    categoryId: 'memory',
    categoryName: 'Memory Challenges',
    promptText: 'Describe your funniest conversation.',
    symbolKey: 'camera-memory',
  },
  {
    id: 'dc_memory_3',
    categoryId: 'memory',
    categoryName: 'Memory Challenges',
    promptText: 'Share an old photo or memory, if you both feel comfortable.',
    symbolKey: 'camera-memory',
  },
  // Creative Challenges
  {
    id: 'dc_creative_1',
    categoryId: 'creative',
    categoryName: 'Creative Challenges',
    promptText: 'Describe your perfect day in three sentences.',
    symbolKey: 'feather-story',
  },
  {
    id: 'dc_creative_2',
    categoryId: 'creative',
    categoryName: 'Creative Challenges',
    promptText: 'Create a story together using three random words.',
    symbolKey: 'feather-story',
  },
  {
    id: 'dc_creative_3',
    categoryId: 'creative',
    categoryName: 'Creative Challenges',
    promptText: 'Give each other a creative nickname.',
    symbolKey: 'feather-story',
  },
  // Fun Challenges
  {
    id: 'dc_fun_1',
    categoryId: 'fun',
    categoryName: 'Fun Challenges',
    promptText: 'Send an emoji that describes your current mood.',
    symbolKey: 'smile-sun',
  },
  {
    id: 'dc_fun_2',
    categoryId: 'fun',
    categoryName: 'Fun Challenges',
    promptText: 'Share the funniest thing that happened today.',
    symbolKey: 'smile-sun',
  },
  {
    id: 'dc_fun_3',
    categoryId: 'fun',
    categoryName: 'Fun Challenges',
    promptText: 'Guess what the other person is thinking about right now.',
    symbolKey: 'smile-sun',
  },
  // Getting to Know You
  {
    id: 'dc_know_1',
    categoryId: 'getting-to-know-you',
    categoryName: 'Getting to Know You',
    promptText: 'Share one thing you have never told the other person.',
    symbolKey: 'compass-dream',
  },
  {
    id: 'dc_know_2',
    categoryId: 'getting-to-know-you',
    categoryName: 'Getting to Know You',
    promptText: 'Describe your dream weekend.',
    symbolKey: 'compass-dream',
  },
  {
    id: 'dc_know_3',
    categoryId: 'getting-to-know-you',
    categoryName: 'Getting to Know You',
    promptText: 'Tell them about something you want to achieve.',
    symbolKey: 'compass-dream',
  },
  // Positive Challenges
  {
    id: 'dc_positive_1',
    categoryId: 'positive',
    categoryName: 'Positive Challenges',
    promptText: 'Share something that made you happy today.',
    symbolKey: 'sunburst-joy',
  },
  {
    id: 'dc_positive_2',
    categoryId: 'positive',
    categoryName: 'Positive Challenges',
    promptText: 'Give each other one positive message.',
    symbolKey: 'sunburst-joy',
  },
  {
    id: 'dc_positive_3',
    categoryId: 'positive',
    categoryName: 'Positive Challenges',
    promptText: 'Name one thing you are looking forward to.',
    symbolKey: 'sunburst-joy',
  },
];

let seededPromise: Promise<void> | null = null;

export async function ensureConnectionGamesSeeded(database: PgDatabase): Promise<void> {
  if (!seededPromise) {
    seededPromise = (async () => {
      try {
        const nowIso = new Date().toISOString();

        const dtCountRows = await database.select({ cnt: count() }).from(deepTalkQuestions);
        if (Number(dtCountRows[0]?.cnt || 0) === 0) {
          const rows: Array<{
            id: string;
            categoryId: string;
            categoryName: string;
            questionText: string;
            sortOrder: number;
            isActive: number;
            createdAt: string;
          }> = [];
          for (const cat of DEEP_TALK_SEED_CATEGORIES) {
            cat.questions.forEach((questionText, idx) => {
              rows.push({
                id: `dtq_${cat.id}_${idx + 1}`,
                categoryId: cat.id,
                categoryName: cat.name,
                questionText,
                sortOrder: idx + 1,
                isActive: 1,
                createdAt: nowIso,
              });
            });
          }
          await database.insert(deepTalkQuestions).values(rows).onConflictDoNothing();
        }

        const dcCountRows = await database.select({ cnt: count() }).from(dailyChallenges);
        if (Number(dcCountRows[0]?.cnt || 0) === 0) {
          await database
            .insert(dailyChallenges)
            .values(
              DAILY_CHALLENGE_SEED.map((c) => ({
                ...c,
                isActive: 1,
                createdAt: nowIso,
              }))
            )
            .onConflictDoNothing();
        }
      } catch (err) {
        seededPromise = null;
        throw err;
      }
    })();
  }
  return seededPromise;
}

export function isValidIanaTimezone(rawTz?: string | null): string | null {
  if (!rawTz || typeof rawTz !== 'string') return null;
  const trimmed = rawTz.trim().slice(0, 64);
  if (!trimmed) return null;
  try {
    const resolved = Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
    return resolved || trimmed;
  } catch {
    return null;
  }
}

export function normalizeTimezone(rawTz?: string | null): string {
  return isValidIanaTimezone(rawTz) ?? 'UTC';
}

export function resolvePairTimezone(
  userA: { timezone?: string | null; lastSeenAt?: string | null; updatedAt?: string | null },
  userB: { timezone?: string | null; lastSeenAt?: string | null; updatedAt?: string | null },
  previousAssignmentTimezone?: string | null
): string {
  const tzA = normalizeTimezone(userA.timezone);
  const tzB = normalizeTimezone(userB.timezone);
  const prevTz = normalizeTimezone(previousAssignmentTimezone);

  if (prevTz !== 'UTC' && (prevTz === tzA || prevTz === tzB)) {
    return prevTz;
  }

  if (tzA !== 'UTC' && tzB !== 'UTC') {
    if (tzA === tzB) return tzA;
    const activeA = userA.lastSeenAt || userA.updatedAt || '';
    const activeB = userB.lastSeenAt || userB.updatedAt || '';
    return activeB > activeA ? tzB : tzA;
  }

  if (tzA !== 'UTC') return tzA;
  if (tzB !== 'UTC') return tzB;
  return 'UTC';
}

export function getCalendarDateInTimezone(date: Date, timeZone: string): string {
  const safeTz = normalizeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

export function getDayDifference(earlierYmd: string, laterYmd: string): number {
  const [y1, m1, d1] = earlierYmd.split('-').map(Number);
  const [y2, m2, d2] = laterYmd.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

export function computeEndOfDayIso(ymd: string, timeZone: string): string {
  const safeTz = normalizeTimezone(timeZone);
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) {
    return new Date(Date.now() + 86_400_000).toISOString();
  }
  // Search around UTC midnight of next day so timezone offset shifts land at local 23:59:59.999
  const approxNextMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  // Step in 15-minute increments around +-14 hours to find the exact last minute belonging to `ymd`
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(approxNextMidnight + offsetMinutes * 60_000);
    const localDay = getCalendarDateInTimezone(candidate, safeTz);
    const prevCandidate = new Date(candidate.getTime() - 60_000);
    const prevLocalDay = getCalendarDateInTimezone(prevCandidate, safeTz);
    if (localDay !== ymd && prevLocalDay === ymd) {
      return new Date(candidate.getTime() - 1).toISOString();
    }
  }
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).toISOString();
}

export const CONNECTION_STREAK_MILESTONES = [3, 7, 14, 30, 100] as const;

export function getNextConnectionMilestone(currentStreak: number): number | null {
  for (const m of CONNECTION_STREAK_MILESTONES) {
    if (currentStreak < m) return m;
  }
  return null;
}

export function pickShuffledQuestionIds<T extends { id: string }>(
  items: T[],
  limitCount: number | null
): string[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  const ids = copy.map((q) => q.id);
  if (limitCount && limitCount > 0) {
    return ids.slice(0, limitCount);
  }
  return ids;
}
