/**
 * Pre-built email templates for the AI drafter
 */

import { PresetTemplate } from './types';

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'coffee-chat',
    name: 'Coffee Chat Request',
    description: 'Request an informational conversation',
    icon: 'coffee',
    template: `Hi {{contact_name}},

I'm a {{your_classification}} at {{your_university}} interested in {{their_field_or_role}}, and I came across your profile while researching careers in {{industry}}.

{{specific_interest_or_question}}

Would you have 20 minutes for a quick virtual coffee chat? I'd love to hear about your experience at {{company}}.

Best,
{{your_name}}`,
  },
  {
    id: 'interview-thank-you',
    name: 'Interview Thank You Note',
    description: 'Follow up after an interview',
    icon: 'heart',
    template: `Hi {{first_name}},

Thank you for taking the time to tell me about the {{role}} position at {{company}} and for the opportunity to interview {{interview_date}}.

I especially enjoyed learning about {{topics_discussed}}. It was great getting a clearer picture of what the role actually looks like day-to-day.

Please let me know if there's anything else I can provide. Hope you have a great rest of your week!

Best,
{{your_name}}`,
  },
  {
    id: 'cold-recruiter',
    name: 'Cold Recruiter',
    description: 'Reach out to a recruiter at your target company',
    icon: 'briefcase',
    template: `Hi {{recruiter_name}},

I'm a {{your_classification}} at {{your_university}} studying {{your_major}}, and I'm very interested in {{target_role}} opportunities at {{company}}.

{{why_this_company}}

{{your_relevant_experience}}

Would you have 15 minutes this week or next to chat about the team and any upcoming opportunities?

Best,
{{your_name}}`,
  },
  {
    id: 'referral-request',
    name: 'Referral Request',
    description: 'Ask a connection for an internal referral',
    icon: 'users',
    template: `Hi {{contact_name}},

I hope you're doing well! I saw that {{company}} is hiring for {{target_role}}, and I'm really excited about the opportunity.

{{why_youre_a_fit}}

Would you be open to referring me for the position? I'd be happy to send over my resume and any other materials that would be helpful.

Thanks so much,
{{your_name}}`,
  },
];

export function getTemplateById(id: string): PresetTemplate | undefined {
  return PRESET_TEMPLATES.find((t) => t.id === id);
}
