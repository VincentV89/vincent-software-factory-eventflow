import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '@cloudscape-design/collection-hooks';
import AreaChart from '@cloudscape-design/components/area-chart';
import Badge from '@cloudscape-design/components/badge';
import BarChart from '@cloudscape-design/components/bar-chart';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import Pagination from '@cloudscape-design/components/pagination';
import PieChart from '@cloudscape-design/components/pie-chart';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { api, ApiError, formatEventDates, type PublicEvent, type Registration } from '../api';
import { signOut } from '../auth';

type StatusFilter = 'all' | 'CONFIRMED' | 'CANCELLED';
const DAY = 86_400_000;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function DashboardPage() {
  const navigate = useNavigate();
  const [event, setEvent] = useState<PublicEvent>();
  const [regs, setRegs] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [status, setStatus] = useState<StatusFilter>('CONFIRMED');
  const [toCancel, setToCancel] = useState<Registration>();
  const [cancelling, setCancelling] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>();

  const notify = useCallback((m: Omit<FlashbarProps.MessageDefinition, 'id' | 'dismissible' | 'onDismiss'>) => {
    const id = String(Math.random());
    setFlash((f) => [{ ...m, id, dismissible: true, onDismiss: () => setFlash((x) => x.filter((i) => i.id !== id)) }, ...f].slice(0, 3));
  }, []);

  const handleError = useCallback(
    async (err: unknown) => {
      const e = err as ApiError;
      if (e.status === 401) {
        await signOut();
        navigate('/organizer/login');
        return;
      }
      notify({ type: 'error', header: e.status === 403 ? 'Access denied' : 'Something went wrong', content: e.status === 403 ? 'Your account is not in the organizers group.' : e.message });
    },
    [navigate, notify],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listRegistrations();
      setEvent(r.event);
      setRegs(r.registrations);
      setUpdatedAt(new Date());
    } catch (err) {
      await handleError(err);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmCancel() {
    if (!toCancel) return;
    setCancelling(true);
    try {
      await api.cancelRegistration(toCancel.confirmationId);
      notify({ type: 'success', header: 'Registration cancelled', content: `${toCancel.name} (${toCancel.confirmationId}) was cancelled and the seat released.` });
      setToCancel(undefined);
      await load();
    } catch (err) {
      setToCancel(undefined);
      await handleError(err);
    } finally {
      setCancelling(false);
    }
  }

  // ------------------------------------------------------------- Derived metrics
  const confirmed = useMemo(() => regs.filter((r) => r.status === 'CONFIRMED'), [regs]);
  const cancelledCount = regs.length - confirmed.length;
  const capacity = event?.capacity ?? 0;
  const registered = event?.registeredCount ?? confirmed.length;
  const available = Math.max(0, capacity - registered);
  const pct = capacity ? Math.round((registered / capacity) * 1000) / 10 : 0;
  const orgCount = useMemo(() => new Set(confirmed.map((r) => r.organization.toLowerCase())).size, [confirmed]);
  const last7 = useMemo(() => confirmed.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 7 * DAY).length, [confirmed]);

  const daily = useMemo(() => {
    if (!confirmed.length) return [] as { x: Date; y: number }[];
    const start = new Date(Math.min(...confirmed.map((r) => new Date(r.createdAt).getTime())));
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = new Map<number, number>();
    for (let t = start.getTime(); t <= today.getTime(); t += DAY) buckets.set(t, 0);
    for (const r of confirmed) {
      const d = new Date(r.createdAt);
      d.setHours(0, 0, 0, 0);
      buckets.set(d.getTime(), (buckets.get(d.getTime()) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, y]) => ({ x: new Date(t), y }));
  }, [confirmed]);
  const cumulative = useMemo(() => {
    let sum = 0;
    return daily.map((d) => ({ x: d.x, y: (sum += d.y) }));
  }, [daily]);

  const topOrgs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of confirmed) m.set(r.organization, (m.get(r.organization) ?? 0) + 1);
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 7).map(([x, y]) => ({ x, y }));
    const other = sorted.slice(7).reduce((s, [, n]) => s + n, 0);
    return other ? [...top, { x: 'Other', y: other }] : top;
  }, [confirmed]);

  // ------------------------------------------------------------- Table
  const filteredByStatus = useMemo(() => (status === 'all' ? regs : regs.filter((r) => r.status === status)), [regs, status]);
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(filteredByStatus, {
    filtering: {
      fields: ['name', 'email', 'organization', 'confirmationId'],
      empty: <Box textAlign="center" color="inherit"><b>No registrations</b><Box variant="p" color="inherit">Registrations will appear here.</Box></Box>,
      noMatch: <Box textAlign="center" color="inherit"><b>No matches</b><Box variant="p" color="inherit">No attendees match your search.</Box></Box>,
    },
    pagination: { pageSize: 15 },
    sorting: { defaultState: { sortingColumn: { sortingField: 'createdAt' }, isDescending: true } },
  });

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-56px)]">
      <div className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-cyan-900 px-6 pt-10 pb-24 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="m-0 text-sm font-semibold uppercase tracking-widest text-cyan-200">Organizer dashboard</p>
          <h1 className="mt-2 mb-1 text-3xl font-bold md:text-4xl">{event?.name ?? 'CloudSummit 2027'}</h1>
          <p className="m-0 text-indigo-100">
            {event ? `${formatEventDates(event)} · ${event.venue}, ${event.city}` : 'Loading…'}
            {updatedAt && <span className="ml-3 text-indigo-200/80">· Updated {updatedAt.toLocaleTimeString()}</span>}
          </p>
        </div>
      </div>
      <div className="mx-auto -mt-16 max-w-7xl px-4 pb-16 md:px-6">
        <ContentLayout>
          <SpaceBetween size="l">
            {flash.length > 0 && <Flashbar items={flash} />}

            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Total registrations" value={event ? registered : '—'} hint={event ? `${last7} in the last 7 days` : 'Loading…'} accent="from-indigo-500 to-violet-500" icon="👥" />
              <Kpi label="Available seats" value={event ? available : '—'} hint={event ? `of ${capacity} total capacity` : 'Loading…'} accent="from-cyan-500 to-sky-500" icon="🎟️" />
              <Kpi label="Capacity filled" value={event ? `${pct}%` : '—'} hint={!event ? 'Loading…' : pct >= 90 ? 'Almost sold out' : pct >= 50 ? 'Filling up fast' : 'Plenty of room'} accent="from-fuchsia-500 to-pink-500" icon="📈" progress={event ? pct : undefined} />
              <Kpi label="Organizations" value={event ? orgCount : '—'} hint={event ? `${cancelledCount} cancelled registration${cancelledCount === 1 ? '' : 's'}` : 'Loading…'} accent="from-amber-500 to-orange-500" icon="🏢" />
            </div>

            {/* Charts */}
            <Grid gridDefinition={[{ colspan: { default: 12, l: 8 } }, { colspan: { default: 12, l: 4 } }, { colspan: { default: 12, l: 6 } }, { colspan: { default: 12, l: 6 } }]}>
              <Container header={<Header variant="h2" description="Cumulative confirmed registrations by day">Registration growth</Header>}>
                <AreaChart
                  series={[{ title: 'Confirmed registrations', type: 'area', data: cumulative }, ...(capacity ? [{ title: 'Capacity', type: 'threshold' as const, y: capacity }] : [])]}
                  xScaleType="time"
                  xTickFormatter={(d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  yDomain={[0, Math.max(capacity, 10)]}
                  height={260}
                  statusType={loading && !regs.length ? 'loading' : 'finished'}
                  ariaLabel="Cumulative registrations over time"
                  xTitle="Date"
                  yTitle="Registrations"
                  hideFilter
                  empty={<Box textAlign="center" color="inherit">No registrations yet</Box>}
                />
              </Container>
              <Container header={<Header variant="h2" description="Seats claimed vs. available">Capacity</Header>}>
                <PieChart
                  data={[
                    { title: 'Registered', value: registered },
                    { title: 'Available', value: available },
                  ]}
                  variant="donut"
                  innerMetricValue={`${pct}%`}
                  innerMetricDescription="filled"
                  size="medium"
                  hideFilter
                  statusType={loading && !event ? 'loading' : 'finished'}
                  ariaLabel="Capacity donut chart"
                  detailPopoverContent={(d, sum) => [
                    { key: 'Seats', value: d.value },
                    { key: 'Share', value: `${sum ? ((d.value / sum) * 100).toFixed(1) : 0}%` },
                  ]}
                  segmentDescription={(d) => `${d.value} seats`}
                  empty={<Box textAlign="center" color="inherit">No data</Box>}
                />
              </Container>
              <Container header={<Header variant="h2" description="New confirmed registrations per day">Daily sign-ups</Header>}>
                <BarChart
                  series={[{ title: 'Sign-ups', type: 'bar', data: daily.slice(-21) }]}
                  xScaleType="categorical"
                  xTickFormatter={(d) => (d as Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  height={220}
                  hideFilter
                  hideLegend
                  statusType={loading && !regs.length ? 'loading' : 'finished'}
                  ariaLabel="Daily sign-ups over the last 21 days"
                  yTitle="Sign-ups"
                  empty={<Box textAlign="center" color="inherit">No registrations yet</Box>}
                />
              </Container>
              <Container header={<Header variant="h2" description="Confirmed attendees by organization">Top organizations</Header>}>
                <BarChart
                  series={[{ title: 'Attendees', type: 'bar', data: topOrgs }]}
                  xScaleType="categorical"
                  horizontalBars
                  height={220}
                  hideFilter
                  hideLegend
                  statusType={loading && !regs.length ? 'loading' : 'finished'}
                  ariaLabel="Attendees by organization"
                  empty={<Box textAlign="center" color="inherit">No registrations yet</Box>}
                />
              </Container>
            </Grid>

            {/* Attendee table */}
            <Table
              {...collectionProps}
              variant="container"
              stickyHeader
              loading={loading && !regs.length}
              loadingText="Loading attendees"
              items={items}
              trackBy="confirmationId"
              header={
                <Header
                  variant="h2"
                  counter={`(${filteredItemsCount ?? 0})`}
                  description="Search by name, email, organization or confirmation ID. Attendee data is visible to organizers only."
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <SegmentedControl
                        selectedId={status}
                        onChange={({ detail }) => setStatus(detail.selectedId as StatusFilter)}
                        label="Status filter"
                        options={[
                          { id: 'CONFIRMED', text: 'Confirmed' },
                          { id: 'CANCELLED', text: 'Cancelled' },
                          { id: 'all', text: 'All' },
                        ]}
                      />
                      <Button iconName="refresh" ariaLabel="Refresh" loading={loading} onClick={() => void load()} />
                    </SpaceBetween>
                  }
                >
                  Attendees
                </Header>
              }
              filter={<TextFilter {...filterProps} filteringPlaceholder="Search attendees" filteringAriaLabel="Search attendees" countText={`${filteredItemsCount ?? 0} matches`} />}
              pagination={<Pagination {...paginationProps} />}
              columnDefinitions={[
                { id: 'name', header: 'Name', cell: (r) => <b>{r.name}</b>, sortingField: 'name', isRowHeader: true },
                { id: 'email', header: 'Email', cell: (r) => r.email, sortingField: 'email' },
                { id: 'organization', header: 'Organization', cell: (r) => r.organization, sortingField: 'organization' },
                {
                  id: 'confirmationId',
                  header: 'Confirmation ID',
                  cell: (r) => <CopyToClipboard variant="inline" textToCopy={r.confirmationId} copySuccessText="Copied" copyErrorText="Copy failed" />,
                },
                { id: 'createdAt', header: 'Registered', cell: (r) => fmtDate(r.createdAt), sortingField: 'createdAt' },
                {
                  id: 'status',
                  header: 'Status',
                  cell: (r) => (r.status === 'CONFIRMED' ? <StatusIndicator type="success">Confirmed</StatusIndicator> : <StatusIndicator type="stopped">Cancelled</StatusIndicator>),
                  sortingField: 'status',
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: (r) =>
                    r.status === 'CONFIRMED' ? (
                      <Button variant="inline-link" iconName="remove" onClick={() => setToCancel(r)} ariaLabel={`Cancel registration for ${r.name}`}>
                        Cancel
                      </Button>
                    ) : (
                      <Badge>Seat released</Badge>
                    ),
                },
              ]}
            />
          </SpaceBetween>
        </ContentLayout>
      </div>

      <Modal
        visible={!!toCancel}
        onDismiss={() => setToCancel(undefined)}
        header="Cancel registration?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setToCancel(undefined)}>Keep registration</Button>
              <Button variant="primary" loading={cancelling} onClick={() => void confirmCancel()}>Cancel registration</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {toCancel && (
          <SpaceBetween size="m">
            <Box>This will cancel the registration and release the seat. The attendee will be able to register again with the same email.</Box>
            <ColumnLayout columns={2} variant="text-grid">
              <div><Box variant="awsui-key-label">Attendee</Box><div>{toCancel.name}</div></div>
              <div><Box variant="awsui-key-label">Confirmation ID</Box><div className="font-mono">{toCancel.confirmationId}</div></div>
              <div><Box variant="awsui-key-label">Email</Box><div>{toCancel.email}</div></div>
              <div><Box variant="awsui-key-label">Organization</Box><div>{toCancel.organization}</div></div>
            </ColumnLayout>
          </SpaceBetween>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ label, value, hint, accent, icon, progress }: { label: string; value: number | string; hint: string; accent: string; icon: string; progress?: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-200/70">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} aria-hidden />
      <div className="flex items-start justify-between">
        <Box variant="awsui-key-label">{label}</Box>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-lg`} aria-hidden>{icon}</span>
      </div>
      <div className="mt-2 text-4xl font-bold tabular-nums text-slate-900" aria-live="polite">{value}</div>
      {progress !== undefined ? (
        <div className="mt-2"><ProgressBar value={Math.min(100, progress)} ariaLabel={label} /></div>
      ) : null}
      <Box variant="small" color="text-body-secondary" margin={{ top: 'xxs' }}>{hint}</Box>
    </div>
  );
}
