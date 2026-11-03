import { useState, type FormEvent } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api, ApiError, type PublicEvent, type Registration } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Fields = { name: string; email: string; organization: string };

function validate(f: Fields): Partial<Fields> {
  const e: Partial<Fields> = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your full name (at least 2 characters).';
  else if (f.name.trim().length > 100) e.name = 'Name must be 100 characters or fewer.';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Please enter a valid email address.';
  if (f.organization.trim().length < 2) e.organization = 'Please enter your organization (at least 2 characters).';
  else if (f.organization.trim().length > 120) e.organization = 'Organization must be 120 characters or fewer.';
  return e;
}

export default function RegistrationForm({ event, onRegistered }: { event?: PublicEvent; onRegistered: () => void }) {
  const [fields, setFields] = useState<Fields>({ name: '', email: '', organization: '' });
  const [errors, setErrors] = useState<Partial<Fields>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ title: string; message: string } | undefined>();
  const [success, setSuccess] = useState<Registration | undefined>();

  const set = (k: keyof Fields) => (v: string) => {
    const next = { ...fields, [k]: v };
    setFields(next);
    if (submitted) setErrors(validate(next));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setFailure(undefined);
    const v = validate(fields);
    setErrors(v);
    if (Object.keys(v).length) return;
    setLoading(true);
    try {
      const reg = await api.register({ name: fields.name.trim(), email: fields.email.trim(), organization: fields.organization.trim() });
      setSuccess(reg);
      onRegistered();
    } catch (err) {
      const a = err as ApiError;
      if (a.code === 'VALIDATION_ERROR' && a.details) setErrors(a.details as Partial<Fields>);
      const titles: Record<string, string> = {
        DUPLICATE_REGISTRATION: 'You are already registered',
        EVENT_FULL: 'This event is sold out',
        VALIDATION_ERROR: 'Please check your details',
      };
      setFailure({ title: titles[a.code] ?? 'Registration failed', message: a.message });
      if (a.code === 'EVENT_FULL') onRegistered();
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <SpaceBetween size="l">
        <Alert type="success" header="You're registered! 🎉" statusIconAriaLabel="Success">
          Thanks, {success.name}. Your seat at {event?.name ?? 'the conference'} is confirmed. Please keep your confirmation ID – you'll need it at check-in.
        </Alert>
        <div className="rounded-2xl border border-dashed border-indigo-300 bg-indigo-50 p-6 text-center">
          <Box variant="small" color="text-body-secondary">Confirmation ID</Box>
          <div className="mt-1 font-mono text-3xl font-bold tracking-wider text-indigo-700" data-testid="confirmation-id">
            {success.confirmationId}
          </div>
          <Box variant="small" color="text-body-secondary" margin={{ top: 'xs' }}>
            Registered as {success.email} · {success.organization}
          </Box>
        </div>
        <Button
          onClick={() => {
            setSuccess(undefined);
            setSubmitted(false);
            setFields({ name: '', email: '', organization: '' });
          }}
        >
          Register another attendee
        </Button>
      </SpaceBetween>
    );
  }

  const closed = event ? !event.registrationOpen : false;
  return (
    <form onSubmit={submit} noValidate>
      <Form
        actions={
          <Button variant="primary" formAction="submit" loading={loading} disabled={closed} iconName="ticket" ariaLabel="Complete registration">
            {closed ? 'Sold out' : 'Reserve my seat'}
          </Button>
        }
      >
        <SpaceBetween size="m">
          {failure && (
            <Alert type={failure.title === 'This event is sold out' ? 'warning' : 'error'} header={failure.title} dismissible onDismiss={() => setFailure(undefined)}>
              {failure.message}
            </Alert>
          )}
          {closed && !failure && (
            <Alert type="warning" header="Registration is closed">
              All {event?.capacity} seats have been taken. Follow us for future events!
            </Alert>
          )}
          <FormField label="Full name" errorText={errors.name}>
            <Input value={fields.name} onChange={({ detail }) => set('name')(detail.value)} placeholder="Ada Lovelace" autoComplete="name" disabled={closed} ariaRequired />
          </FormField>
          <FormField label="Work email" errorText={errors.email} constraintText="We'll send your ticket here. One registration per email.">
            <Input type="email" inputMode="email" value={fields.email} onChange={({ detail }) => set('email')(detail.value)} placeholder="ada@company.com" autoComplete="email" disabled={closed} ariaRequired />
          </FormField>
          <FormField label="Organization" errorText={errors.organization}>
            <Input value={fields.organization} onChange={({ detail }) => set('organization')(detail.value)} placeholder="Analytical Engines Ltd." autoComplete="organization" disabled={closed} ariaRequired />
          </FormField>
        </SpaceBetween>
      </Form>
    </form>
  );
}
