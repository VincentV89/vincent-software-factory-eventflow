import { newConfirmationId } from './ids.js';
import type { Registration } from './repository.js';

// Deterministic pseudo-random generator so seeded data is stable between runs.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'Mateo', 'Sofia', 'Kenji', 'Priya', 'Arjun', 'Chen', 'Mei', 'Lucas', 'Amara', 'Zara', 'Diego', 'Fatima', 'Hiro', 'Ingrid', 'Jonas', 'Kofi', 'Leila', 'Marco', 'Nadia', 'Omar', 'Paula', 'Quinn', 'Rafael', 'Sana', 'Tomas', 'Uma', 'Victor', 'Wen', 'Yara', 'Elena', 'Felix', 'Grace', 'Hassan', 'Isla', 'Jamal'];
const LAST = ['Anderson', 'Bauer', 'Costa', 'Dubois', 'Eriksen', 'Fernandes', 'Garcia', 'Haddad', 'Ito', 'Johansson', 'Kim', 'Lopez', 'Moreau', 'Nakamura', 'Okafor', 'Patel', 'Quintero', 'Rossi', 'Schmidt', 'Tanaka', 'Usman', 'Varga', 'Wang', 'Xu', 'Yilmaz', 'Zhang', 'Novak', 'Silva', 'Murphy', 'Singh'];
const ORGS: Array<[string, string, number]> = [
  ['Acme Cloud', 'acmecloud.example', 9],
  ['Globex Systems', 'globex.example', 7],
  ['Initech', 'initech.example', 6],
  ['Umbrella Analytics', 'umbrella.example', 5],
  ['Stark Industries', 'stark.example', 5],
  ['Wayne Enterprises', 'wayne.example', 4],
  ['Hooli', 'hooli.example', 4],
  ['Pied Piper', 'piedpiper.example', 3],
  ['Soylent Data', 'soylent.example', 3],
  ['Northwind Traders', 'northwind.example', 3],
  ['Contoso Labs', 'contoso.example', 2],
  ['Tyrell Robotics', 'tyrell.example', 2],
  ['Freelance', 'mail.example', 2],
];

/** Generates fictional attendees (RFC 2606 ".example" domains – no real personal data). */
export function generateMockRegistrations(eventId: string, count: number, now = new Date(), seed = 2027): Registration[] {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const totalWeight = ORGS.reduce((s, o) => s + o[2], 0);
  const pickOrg = () => {
    let r = rand() * totalWeight;
    for (const o of ORGS) if ((r -= o[2]) <= 0) return o;
    return ORGS[0];
  };
  const used = new Set<string>();
  const out: Registration[] = [];
  const DAY = 86_400_000;
  for (let i = 0; out.length < count && i < count * 20; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const [org, domain] = pickOrg();
    const email = `${first}.${last}@${domain}`.toLowerCase();
    if (used.has(email)) continue;
    used.add(email);
    // Skew sign-ups toward recent days (launch spike + steady growth) over the last 30 days.
    const daysAgo = Math.floor(Math.pow(rand(), 1.6) * 30);
    const createdAt = new Date(now.getTime() - daysAgo * DAY - Math.floor(rand() * DAY));
    const cancelled = rand() < 0.06;
    out.push({
      confirmationId: newConfirmationId(),
      eventId,
      name: `${first} ${last}`,
      email,
      organization: org,
      status: cancelled ? 'CANCELLED' : 'CONFIRMED',
      createdAt: createdAt.toISOString(),
      ...(cancelled ? { cancelledAt: new Date(Math.min(now.getTime(), createdAt.getTime() + 2 * DAY)).toISOString() } : {}),
    });
  }
  return out;
}
