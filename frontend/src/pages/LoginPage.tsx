import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { completeNewPassword, signIn } from '../auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [challenge, setChallenge] = useState<{ session: string; username: string }>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      if (challenge) {
        if (newPassword !== confirm) throw new Error('Passwords do not match.');
        await completeNewPassword(challenge.username, newPassword, challenge.session);
        navigate('/organizer');
      } else {
        const r = await signIn(email, password);
        if (r.status === 'NEW_PASSWORD_REQUIRED') setChallenge({ session: r.session, username: r.username });
        else navigate('/organizer');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-gradient-to-br from-slate-100 via-indigo-50 to-cyan-50 px-4 py-16">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-4 mb-1 text-2xl font-bold text-slate-900">Organizer console</h1>
          <p className="m-0 text-slate-600">Sign in to manage CloudSummit registrations.</p>
        </div>
        <form onSubmit={submit} noValidate>
          <Container header={<Header variant="h2">{challenge ? 'Choose a new password' : 'Sign in'}</Header>}>
            <Form actions={<Button variant="primary" formAction="submit" loading={loading}>{challenge ? 'Set password & continue' : 'Sign in'}</Button>}>
              <SpaceBetween size="m">
                {error && <Alert type="error" statusIconAriaLabel="Error">{error}</Alert>}
                {challenge ? (
                  <>
                    <Alert type="info">This is your first sign-in. Please replace your temporary password.</Alert>
                    <FormField label="New password" constraintText="At least 12 characters with upper & lower case letters, a number and a symbol.">
                      <Input type="password" value={newPassword} onChange={({ detail }) => setNewPassword(detail.value)} autoComplete="new-password" />
                    </FormField>
                    <FormField label="Confirm new password">
                      <Input type="password" value={confirm} onChange={({ detail }) => setConfirm(detail.value)} autoComplete="new-password" />
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField label="Email">
                      <Input type="email" value={email} onChange={({ detail }) => setEmail(detail.value)} autoComplete="username" autoFocus />
                    </FormField>
                    <FormField label="Password">
                      <Input type="password" value={password} onChange={({ detail }) => setPassword(detail.value)} autoComplete="current-password" />
                    </FormField>
                  </>
                )}
              </SpaceBetween>
            </Form>
          </Container>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">Organizer accounts are invite-only. Ask your administrator for access.</p>
      </div>
    </main>
  );
}
