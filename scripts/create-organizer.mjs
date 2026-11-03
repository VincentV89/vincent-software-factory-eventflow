#!/usr/bin/env node
/**
 * Creates (or re-invites) an organizer account in the EventFlow Cognito user pool and adds it to the
 * "organizers" group. No credentials are hardcoded anywhere: a random temporary password is generated
 * and must be changed at first sign-in.
 *
 *   node scripts/create-organizer.mjs --email you@company.com              # Cognito emails the invitation
 *   node scripts/create-organizer.mjs --email you@company.com --print      # show temp password in this terminal only
 *   node scripts/create-organizer.mjs --email you@company.com --store-ssm  # store temp password as an SSM SecureString
 */
import { randomInt } from 'node:crypto';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { REGION, STACK_NAME, stackOutputs } from './lib.mjs';

const args = process.argv.slice(2);
const email = (args[args.indexOf('--email') + 1] ?? '').trim().toLowerCase();
const print = args.includes('--print');
const storeSsm = args.includes('--store-ssm');
if (!args.includes('--email') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/create-organizer.mjs --email you@company.com [--print | --store-ssm]');
  process.exit(1);
}

function tempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 20) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const out = await stackOutputs();
const idp = new CognitoIdentityProviderClient({ region: REGION });
const password = tempPassword();
const silent = print || storeSsm;
let existed = false;
try {
  await idp.send(
    new AdminCreateUserCommand({
      UserPoolId: out.UserPoolId,
      Username: email,
      TemporaryPassword: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
      ...(silent ? { MessageAction: 'SUPPRESS' } : {}),
    }),
  );
} catch (e) {
  if (!(e instanceof UsernameExistsException)) throw e;
  existed = true;
  // Reset to a fresh temporary password (forces a password change at next sign-in).
  await idp.send(new AdminSetUserPasswordCommand({ UserPoolId: out.UserPoolId, Username: email, Password: password, Permanent: false }));
}
await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: out.UserPoolId, Username: email, GroupName: out.OrganizerGroup }));

console.log(`Organizer ${existed ? 'updated' : 'created'}: ${email} (group: ${out.OrganizerGroup})`);
console.log(`Sign in at: ${out.WebsiteUrl}/organizer/login`);
if (storeSsm) {
  const name = `/eventflow/${STACK_NAME}/organizer-temp-password/${email.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  await new SSMClient({ region: REGION }).send(
    new PutParameterCommand({ Name: name, Value: password, Type: 'SecureString', Overwrite: true, Description: 'EventFlow organizer temporary password (must be changed at first sign-in)' }),
  );
  console.log(`Temporary password stored as SSM SecureString. Retrieve it with:\n  aws ssm get-parameter --region ${REGION} --with-decryption --name '${name}' --query Parameter.Value --output text`);
} else if (print) {
  console.log(`Temporary password (shown once, change it at first sign-in): ${password}`);
} else if (!existed) {
  console.log('Cognito has emailed the temporary password to this address.');
} else {
  console.log('User already existed: a new temporary password was set. Re-run with --print or --store-ssm to view it.');
}
