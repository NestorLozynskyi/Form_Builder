// Seeding helpers that talk to the real API (same cookies + XSRF header as the Angular app).
export const B = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8180';

export async function xsrf(ctx) {
  const c = (await ctx.cookies()).find((x) => x.name === 'XSRF-TOKEN');
  return c ? decodeURIComponent(c.value) : '';
}

export async function api(ctx, method, path, body) {
  const headers = { 'X-XSRF-TOKEN': await xsrf(ctx) };
  const r = await ctx.request.fetch(B + path, { method, headers, data: body });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
  return r.status() === 204 ? null : r.json();
}

export async function signUp(ctx, email, password = 'Password-123') {
  await ctx.request.get(B + '/api/auth/session');
  return api(ctx, 'POST', '/api/auth/sign-up', { email, password });
}

/** A form that uses every block type and rule (similar to the mockup's sample form). */
export function feedbackSchema(accent = 'teal') {
  return {
    title: 'Customer feedback survey',
    description: 'Tell us how Form Builder works for you. It takes about 3 minutes.',
    successMessage: 'Thanks for your feedback! We read every response.',
    accent,
    blocks: [
      { id: 'name', type: 'short', label: 'Full name', help: '2–80 characters.', required: true, minLength: 2, maxLength: 80, pattern: '', patternMessage: '' },
      { id: 'order', type: 'short', label: 'Order number', help: 'Format: FB- followed by 6 digits', required: false, pattern: '^FB-\\d{6}$', patternMessage: 'Enter an order number like FB-123456.' },
      { id: 'phone', type: 'short', label: 'Phone number', help: '', required: false },
      { id: 'email', type: 'email', label: 'Email address', help: 'We’ll only use this to follow up on your feedback.', required: true },
      { id: 'h1', type: 'heading', text: 'Your experience' },
      { id: 'd1', type: 'description', text: 'Answer based on the last 30 days.' },
      { id: 'sat', type: 'scale', label: 'How satisfied are you with Form Builder?', help: '', required: true, max: 5, leftLabel: 'Not at all', rightLabel: 'Very satisfied' },
      { id: 'features', type: 'checkbox', label: 'Which features do you use?', help: 'Choose 1 to 3.', required: true, options: ['Form editor', 'Responses table', 'CSV export', 'Public links'], minSelected: 1, maxSelected: 3 },
      { id: 'source', type: 'radio', label: 'How did you hear about us?', help: '', required: false, options: ['Search engine', 'A friend or colleague', 'Social media', 'Other'] },
      { id: 'count', type: 'number', label: 'How many forms do you manage?', help: 'Whole number from 1 to 500.', required: false, min: 1, max: 500, integer: true },
      { id: 'start', type: 'date', label: 'When did you start using Form Builder?', help: 'Between Jan 1, 2024 and today.', required: false, earliest: '2024-01-01', latestMode: 'today', latest: '' },
      { id: 'country', type: 'dropdown', label: 'Country', help: '', required: true, options: ['Canada', 'Germany', 'India', 'Poland', 'Ukraine', 'United Kingdom', 'United States'] },
      { id: 'comments', type: 'long', label: 'Anything else you’d like to tell us?', help: '', required: false, maxLength: 1000 },
    ],
  };
}

export async function createForm(ctx, schema) {
  const f = await api(ctx, 'POST', '/api/forms');
  await api(ctx, 'PUT', `/api/forms/${f.id}/draft`, schema);
  return f.id;
}

export const publish = (ctx, id) => api(ctx, 'POST', `/api/forms/${id}/publish`);

export async function submit(ctx, publicId, version, answers) {
  const r = await ctx.request.post(`${B}/api/public/forms/${publicId}/responses`, { data: { version, answers, website: '' } });
  if (r.status() !== 201) throw new Error(`submit → ${r.status()} ${await r.text()}`);
  return r.json();
}

export const PEOPLE = [
  ['Priya Nair', 'priya.nair@example.com', '5', ['Form editor', 'CSV export'], 'Canada'],
  ['Daniel Okafor', 'daniel.okafor@example.com', '4', ['Form editor', 'Responses table', 'CSV export'], 'United Kingdom'],
  ['Sofia Lindqvist', 'sofia.l@example.se', '5', ['Public links'], 'Germany'],
  ['Marco Bianchi', 'm.bianchi@example.it', '3', ['Form editor'], 'Poland'],
  ['Hannah Weber', 'hannah.weber@example.de', '4', ['Responses table'], 'Germany'],
  ['Kenji Tanaka', 'kenji.t@example.jp', '2', ['CSV export'], 'India'],
  ['Amara Mensah', 'amara.mensah@example.com', '5', ['Form editor', 'Public links'], 'Ukraine'],
  ['Lucas Moreau', 'lucas.moreau@example.fr', '4', ['Form editor'], 'Canada'],
  ['Elena Petrova', 'elena.p@example.com', '3', ['Responses table', 'CSV export'], 'Ukraine'],
  ['Tom Becker', 'tom.becker@example.com', '4', ['Form editor'], 'Germany'],
  ['Grace Kim', 'grace.kim@example.com', '5', ['Public links', 'CSV export'], 'United States'],
  ['Rachel Adeyemi', 'rachel.adeyemi@example.com', '5', ['Form editor', 'Public links'], 'United Kingdom'],
];

export function answersFor(i, withPhone) {
  const [name, email, sat, features, country] = PEOPLE[i % PEOPLE.length];
  const a = { name, email, sat, features, country, source: 'A friend or colleague', count: String(3 + i), start: '2025-03-14' };
  if (withPhone) a.phone = '+44 20 7946 0958';
  if (i % 3 === 0) a.comments = 'The preview mode saves me a lot of time when I build a new survey.\nIt would be great to reorder options faster on my phone.';
  return a;
}

/** Seeds: v1 (with phone) + 3 responses, v2 (phone removed, Order number added) + 6 responses (under the 10/min submit limit). */
export async function seedFeedback(ctx, accent = 'teal') {
  const s1 = feedbackSchema(accent);
  s1.blocks = s1.blocks.filter((b) => b.id !== 'order');
  const id = await createForm(ctx, s1);
  const p1 = await publish(ctx, id);
  for (let i = 0; i < 3; i++) await submit(ctx, p1.publicId, 1, answersFor(11 - i, true));
  const s2 = feedbackSchema(accent);
  s2.blocks = s2.blocks.filter((b) => b.id !== 'phone');
  await api(ctx, 'PUT', `/api/forms/${id}/draft`, s2);
  const p2 = await publish(ctx, id);
  for (let i = 0; i < 6; i++) await submit(ctx, p2.publicId, 2, answersFor(5 - i, false));
  return { id, publicId: p2.publicId };
}
