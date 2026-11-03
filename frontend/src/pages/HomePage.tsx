import { useCallback, useEffect, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Icon from '@cloudscape-design/components/icon';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { api, formatEventDates, type PublicEvent } from '../api';
import RegistrationForm from '../components/RegistrationForm';

const TRACKS = [
  { icon: '⚡', title: 'Serverless at scale', text: 'Event-driven architectures, cost-aware design and patterns that survive Black Friday.' },
  { icon: '🤖', title: 'Generative AI in production', text: 'Agents, retrieval, guardrails and evaluation – from prototype to SLA.' },
  { icon: '🛠️', title: 'Platform engineering', text: 'Golden paths, internal developer platforms and infrastructure as code.' },
  { icon: '🔭', title: 'Observability & resilience', text: 'Tracing, chaos engineering and SLO-driven operations.' },
];

const AGENDA = [
  { day: 'Day 1', items: ['08:00 Registration & breakfast', '09:00 Opening keynote: The next decade of cloud', '11:00 Breakout tracks', '14:00 Hands-on workshops', '18:00 Community reception'] },
  { day: 'Day 2', items: ['09:00 Keynote: AI-native engineering teams', '10:30 Breakout tracks', '13:30 Builder lightning talks', '15:30 Architecture clinic', '17:00 Closing & prize draw'] },
];

export default function HomePage() {
  const [event, setEvent] = useState<PublicEvent>();
  const [loadError, setLoadError] = useState<string>();

  const refresh = useCallback(() => {
    api
      .getEvent()
      .then((e) => {
        setEvent(e);
        setLoadError(undefined);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // The SPA renders only after /config.json has loaded, so the browser's native jump to a URL fragment
  // (e.g. /#register from the nav or a shared link) happens before the target exists. Scroll manually
  // once on mount and again once the event has loaded (content above the target may change height).
  const eventLoaded = !!event;
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [eventLoaded]);

  const pct = event ? Math.min(100, event.capacityPercent) : 0;

  return (
    <main>
      {/* ------------------------------------------------------------ Banner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-900 text-white">
        <div className="hero-grid absolute inset-0" aria-hidden />
        <div className="absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-fuchsia-500/30 blur-3xl animate-float" aria-hidden />
        <div className="absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-cyan-400/25 blur-3xl animate-float" style={{ animationDelay: '-3s' }} aria-hidden />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Registration is {event && !event.registrationOpen ? 'closed' : 'open'}
            </span>
            <h1 className="mt-6 text-5xl font-extrabold leading-tight tracking-tight md:text-7xl">
              {event?.name ?? 'CloudSummit 2027'}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-indigo-100 md:text-xl">
              {event?.tagline ?? 'Build the future of serverless, AI and developer experience.'}
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="#register" className="rounded-xl bg-white px-7 py-3.5 text-base font-semibold text-indigo-900 no-underline shadow-lg shadow-indigo-900/40 transition hover:-translate-y-0.5 hover:bg-indigo-50">
                Reserve your seat →
              </a>
              <a href="#about" className="rounded-xl border border-white/30 px-7 py-3.5 text-base font-semibold text-white no-underline transition hover:bg-white/10">
                Explore the program
              </a>
            </div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur-md">
            <dl className="m-0 space-y-6">
              <Fact label="When" value={event ? formatEventDates(event) : 'March 17 – 18, 2027'} sub="09:00 – 17:30 PT both days" icon="calendar" />
              <Fact label="Where" value={event?.venue ?? 'Harborview Convention Center'} sub={event ? `${event.address}, ${event.city}` : 'Seattle, WA'} icon="location-pin" />
              <Fact label="Capacity" value={`${event?.capacity ?? 300} attendees`} sub="In-person only · limited seats" icon="group" />
            </dl>
            <div className="mt-8">
              <div className="flex items-end justify-between">
                <span className="text-sm text-indigo-100">Seats claimed</span>
                <span className="text-3xl font-bold tabular-nums">{event ? `${event.registeredCount}/${event.capacity}` : '—'}</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Seats claimed">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 mb-0 text-sm text-indigo-100">
                {event ? (event.availableSeats > 0 ? `Only ${event.availableSeats} seats left` : 'Sold out') : 'Loading availability…'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ About + tracks */}
      <section id="about" className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="m-0 text-sm font-semibold uppercase tracking-widest text-indigo-600">About the event</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">Two days of deep, practical learning</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">{event?.description ?? 'Loading event details…'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TRACKS.map((t) => (
              <div key={t.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div className="text-3xl" aria-hidden>{t.icon}</div>
                <h3 className="mt-3 mb-1 text-lg font-semibold text-slate-900">{t.title}</h3>
                <p className="m-0 text-slate-600">{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Agenda + registration */}
      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="m-0 text-sm font-semibold uppercase tracking-widest text-indigo-600">Agenda</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">What to expect</h2>
            <div className="mt-6 space-y-6">
              {AGENDA.map((d) => (
                <div key={d.day} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h3 className="mt-0 mb-3 text-lg font-semibold text-indigo-700">{d.day}</h3>
                  <ul className="m-0 list-none space-y-2 p-0">
                    {d.items.map((i) => (
                      <li key={i} className="flex gap-3 text-slate-700">
                        <span className="font-mono text-sm text-slate-400">{i.slice(0, 5)}</span>
                        <span>{i.slice(6)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div id="register" className="scroll-mt-20">
            <Container
              header={
                <Header variant="h2" description="Free for attendees · takes less than a minute">
                  Register for {event?.name ?? 'CloudSummit 2027'}
                </Header>
              }
            >
              {loadError && !event ? (
                <StatusIndicator type="error">Could not load the event: {loadError}</StatusIndicator>
              ) : !event ? (
                <Box textAlign="center" padding="l"><Spinner size="large" /></Box>
              ) : (
                <>
                  <Box margin={{ bottom: 'l' }}>
                    <ProgressBar value={pct} label="Event capacity" description={`${event.registeredCount} of ${event.capacity} seats claimed`} additionalInfo={`${event.availableSeats} seats available`} />
                  </Box>
                  <RegistrationForm event={event} onRegistered={refresh} />
                </>
              )}
            </Container>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500">
          <span>© 2027 EventFlow · CloudSummit</span>
          <span>Built serverless on AWS: CloudFront · API Gateway · Lambda · DynamoDB · Cognito</span>
        </div>
      </footer>
    </main>
  );
}

function Fact({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: 'calendar' | 'location-pin' | 'group' }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
        <Icon name={icon} variant="inverted" />
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-widest text-indigo-200">{label}</dt>
        <dd className="m-0 mt-1 text-lg font-semibold">{value}</dd>
        <dd className="m-0 text-sm text-indigo-100">{sub}</dd>
      </div>
    </div>
  );
}
