/**
 * Shared types for email templates and drafts
 */

export interface TemplatePrompt {
  subject: string;
  body: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}
