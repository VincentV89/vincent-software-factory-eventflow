/** The flagship conference seeded into DynamoDB on first deployment. */
export const DEFAULT_EVENT = {
  eventId: 'cloudsummit-2027',
  name: 'CloudSummit 2027',
  tagline: 'Build the future of serverless, AI and developer experience.',
  description:
    'CloudSummit is a two-day technology conference for builders. Join 300 engineers, architects and product leaders for deep-dive talks on serverless architectures, generative AI in production, platform engineering and observability, plus hands-on workshops, an expo floor and plenty of time to connect with peers.',
  startDate: '2027-03-17T09:00:00-07:00',
  endDate: '2027-03-18T17:30:00-07:00',
  timezone: 'America/Los_Angeles',
  venue: 'Harborview Convention Center',
  address: '800 Pier Avenue',
  city: 'Seattle, WA',
  capacity: 300,
};
