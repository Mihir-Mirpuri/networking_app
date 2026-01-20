export const COMPANIES = [
  'Goldman Sachs',
  'Morgan Stanley',
  'JPMorgan Chase',
  'Bank of America',
  'Citigroup',
  'Blackstone',
  'KKR',
  'Carlyle Group',
  'Apollo Global Management',
  'McKinsey & Company',
  'Boston Consulting Group',
  'Bain & Company',
  'Deloitte',
  'PwC',
  'EY',
  'KPMG',
  'Lazard',
  'Evercore',
  'Centerview Partners',
  'Moelis & Company',
] as const;

export const ROLES = [
  'Analyst',
  'Associate',
  'Vice President',
  'Director',
  'Managing Director',
  'Investment Banking',
  'Private Equity',
  'Consulting',
  'Asset Management',
  'Sales & Trading',
  'Research',
  'Wealth Management',
] as const;

export const UNIVERSITIES = [
  'Harvard University',
  'Yale University',
  'Princeton University',
  'Stanford University',
  'MIT',
  'Columbia University',
  'University of Pennsylvania',
  'Duke University',
  'Northwestern University',
  'University of Chicago',
  'New York University',
  'Cornell University',
  'Dartmouth College',
  'Brown University',
  'University of Michigan',
  'UC Berkeley',
  'UCLA',
  'Georgetown University',
] as const;

export const LOCATIONS = [
  '',
  'New York',
  'San Francisco',
  'Los Angeles',
  'Chicago',
  'Boston',
  'London',
  'Hong Kong',
  'Singapore',
  'Dallas',
  'Houston',
  'Atlanta',
  'Charlotte',
  'Miami',
  'Washington DC',
  'Seattle',
  'Denver',
] as const;

export const EMAIL_TEMPLATES = [
  {
    id: 'default',
    name: 'Default',
    subject: 'Reaching out from {university}',
    body: `Hi {first_name},

I hope you are doing well. My name is {user_name} and I am a {classification} pursuing my {major} at {university}. I am interested in {career} and would love to grab 10-15 minutes on the phone with you to hear about your experiences at {company}.

In case it's helpful to provide more context on my background, I have attached my resume below for your reference. I look forward to hearing from you.

Warm regards,
{user_name}`,
  },
] as const;

export type Company = (typeof COMPANIES)[number];
export type Role = (typeof ROLES)[number];
export type University = (typeof UNIVERSITIES)[number];
export type Location = (typeof LOCATIONS)[number];
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
