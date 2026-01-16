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

export const EMAIL_TEMPLATES = [
  {
    id: 'networking',
    name: 'Networking Request',
    subject: 'Reaching out from {university}',
    body: `Hi {first_name},

I'm a student at {university} and I'm very interested in {company}. I came across your profile and would love to learn more about your experience there.

Would you be open to a brief 15-minute call at your convenience?

Best regards`,
  },
  {
    id: 'coffee-chat',
    name: 'Coffee Chat',
    subject: 'Coffee Chat Request - {university} Student',
    body: `Hi {first_name},

I hope this message finds you well! I'm currently a student at {university} exploring opportunities in {role}.

I noticed you work at {company} and would greatly appreciate the chance to hear about your journey and any advice you might have.

Would you have 15-20 minutes for a virtual coffee chat?

Thank you for your time!`,
  },
  {
    id: 'informational',
    name: 'Informational Interview',
    subject: 'Informational Interview Request',
    body: `Dear {first_name},

I am a student at {university} with a strong interest in {role} at {company}.

I am reaching out to request an informational interview to learn more about your career path and experience in the industry.

I would be grateful for any time you could spare.

Best regards`,
  },
] as const;

export type Company = (typeof COMPANIES)[number];
export type Role = (typeof ROLES)[number];
export type University = (typeof UNIVERSITIES)[number];
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
