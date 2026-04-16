import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Signl',
  description: 'Privacy Policy for Signl',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-surface-100 rounded-lg shadow-sm p-8">
        <Link
          href="/"
          className="text-blue-600 hover:text-blue-800 text-sm mb-6 inline-block"
        >
          &larr; Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-white mb-8">Last updated: February 24, 2026</p>

        <div className="prose prose-gray max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
            <p className="text-gray-700 mb-4">
              Signl (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is a networking outreach tool designed to help
              users connect with professionals. This Privacy Policy explains how we
              collect, use, disclose, and safeguard your information when you use our service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Account Information</h3>
            <p className="text-gray-700 mb-4">
              When you sign in with Google, we collect:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Name and email address</li>
              <li>Profile picture</li>
              <li>University, major, and classification (if provided)</li>
              <li>Career preferences</li>
              <li>Custom email generation instructions (if provided)</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Google Account Access</h3>
            <p className="text-gray-700 mb-4">
              We request access to your Google account for the following purposes:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li><strong>Gmail Send:</strong> To send outreach emails on your behalf</li>
              <li><strong>Google Calendar (optional):</strong> To view your calendar events and help schedule meetings</li>
            </ul>
            <p className="text-gray-700 mb-4">
              We store OAuth tokens securely to maintain your session. We do not read
              the content of emails in your inbox.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Resume Data</h3>
            <p className="text-gray-700 mb-4">
              If you upload a resume, we store the file securely and use AI to extract
              relevant information (organizations, skills, interests) to help personalize
              your outreach emails. Resume summaries are generated and stored to improve
              email generation quality.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Professional Contact Data</h3>
            <p className="text-gray-700 mb-4">
              When you search for contacts, we collect publicly available professional information
              from LinkedIn profiles using server-side data providers. This includes:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Name, current company, and job title</li>
              <li>Work location</li>
              <li>Education history</li>
              <li>LinkedIn profile URL</li>
              <li>Professional email addresses (discovered via third-party enrichment services)</li>
            </ul>
            <p className="text-gray-700 mb-4">
              This data is collected from publicly available sources and third-party data
              providers to facilitate professional outreach. We do not access private or
              restricted LinkedIn profile information.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Email Content</h3>
            <p className="text-gray-700 mb-4">
              We store email drafts and the content of emails sent through the Service
              (subjects, bodies, and recipient information) as part of your send history.
              This data is retained to provide you with outreach tracking and history features.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Payment Information</h3>
            <p className="text-gray-700 mb-4">
              If you subscribe to a paid plan, payment processing is handled by Stripe.
              We store your Stripe customer ID and subscription status but do not store
              credit card numbers or full payment details on our servers. Please refer to{' '}
              <a href="https://stripe.com/privacy" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">
                Stripe&apos;s Privacy Policy
              </a>{' '}
              for information on how they handle payment data.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Usage Data</h3>
            <p className="text-gray-700 mb-4">
              We collect information about how you use the service, including:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Search queries and connection history</li>
              <li>Email drafts and sent messages</li>
              <li>Feedback you submit</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
            <p className="text-gray-700 mb-4">We use the collected information to:</p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Provide and maintain the service</li>
              <li>Send emails on your behalf through Gmail</li>
              <li>Generate personalized email drafts using AI</li>
              <li>Discover and verify professional email addresses</li>
              <li>Display calendar events and meeting suggestions</li>
              <li>Process subscription payments</li>
              <li>Improve and optimize our service</li>
              <li>Respond to your feedback and support requests</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Sharing, Transfer, and Disclosure of Google User Data</h2>
            <p className="text-gray-700 mb-4">
              We only share Google user data with third parties as necessary to provide
              and operate the Service. We do not sell Google user data. Below is a
              complete list of third parties that receive Google user data, what data is
              shared, and why:
            </p>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Service Infrastructure</h3>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>
                <strong>Supabase</strong> (database hosting): Your name, email address, and
                profile picture obtained from Google are stored in our database hosted on
                Supabase to maintain your account. Supabase also stores OAuth tokens in
                encrypted form.{' '}
                <a href="https://supabase.com/privacy" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">
                  Supabase Privacy Policy
                </a>
              </li>
              <li>
                <strong>Vercel</strong> (hosting): Your Google user data passes through
                Vercel&apos;s infrastructure as part of normal application hosting and delivery.{' '}
                <a href="https://vercel.com/legal/privacy-policy" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">
                  Vercel Privacy Policy
                </a>
              </li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Email Sending</h3>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>
                <strong>Google Gmail API:</strong> We use your OAuth access token (obtained
                through Google sign-in) to send outreach emails on your behalf via the
                Gmail API. The email content you compose or approve is transmitted to
                Google&apos;s servers for delivery. We do not read or access emails in your
                inbox.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">AI Email Generation</h3>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>
                <strong>Groq</strong> (AI/LLM provider): To generate personalized email
                drafts, we send your name, university, major, and career preferences
                (collected at sign-up via your Google account) along with resume summary
                data (if provided) to Groq&apos;s language model. We do not send your email
                address, OAuth tokens, or profile picture to Groq.{' '}
                <a href="https://groq.com/privacy-policy/" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">
                  Groq Privacy Policy
                </a>
              </li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">Payment Processing</h3>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>
                <strong>Stripe:</strong> Your email address (obtained from Google sign-in)
                is shared with Stripe to create a customer record and process subscription
                payments. We do not share your name, profile picture, or OAuth tokens with
                Stripe.{' '}
                <a href="https://stripe.com/privacy" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">
                  Stripe Privacy Policy
                </a>
              </li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">No Other Sharing of Google User Data</h3>
            <p className="text-gray-700 mb-4">
              The following services are used by Signl but do <strong>not</strong> receive
              any data obtained from your Google account (they only receive professional
              contact data collected from public sources, or search queries):
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li><strong>Apollo:</strong> Receives names and company information from public LinkedIn profiles (not from your Google account) for email discovery</li>
              <li><strong>Apify:</strong> Receives public LinkedIn URLs (not Google user data) for profile data collection</li>
              <li><strong>Google Custom Search:</strong> Receives search queries (not Google user data) for discovering professional profiles</li>
            </ul>

            <p className="text-gray-700 mb-4">
              We do not sell, rent, or trade your Google user data to any third party.
              We do not share Google user data with third parties for their own marketing
              or advertising purposes. We only transfer Google user data as described
              above, strictly to provide the Service&apos;s functionality to you.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Third-Party Services</h2>
            <p className="text-gray-700 mb-4">We use the following third-party services to operate the Service:</p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li><strong>Google OAuth, Gmail API &amp; Calendar API:</strong> For authentication, email sending, and calendar features</li>
              <li><strong>Stripe:</strong> For payment processing and subscription management</li>
              <li><strong>Apify:</strong> For collecting publicly available LinkedIn profile data</li>
              <li><strong>Apollo:</strong> For professional email address discovery and contact enrichment</li>
              <li><strong>Google Custom Search:</strong> For discovering professional profiles on the web</li>
              <li><strong>Groq:</strong> For AI-powered email generation and resume analysis</li>
              <li><strong>Supabase:</strong> For database hosting and secure file storage (resumes)</li>
              <li><strong>Vercel:</strong> For hosting and deployment</li>
            </ul>
            <p className="text-gray-700 mb-4">
              Each of these services has their own privacy policies governing their use of data.
              We encourage you to review those policies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Data Security</h2>
            <p className="text-gray-700 mb-4">
              We implement appropriate technical and organizational security measures to protect
              your personal information, including:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Encrypted data transmission (HTTPS)</li>
              <li>Secure token storage for OAuth credentials</li>
              <li>Database encryption at rest</li>
              <li>Access controls and authentication</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Data Retention</h2>
            <p className="text-gray-700 mb-4">
              We retain your data for as long as your account is active or as needed to provide
              you services. Email send history is retained indefinitely to provide outreach
              tracking. You may request deletion of your account and associated data at any
              time by contacting us.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Your Rights</h2>
            <p className="text-gray-700 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Revoke Google account access at any time through your Google Account settings</li>
              <li>Cancel your subscription at any time</li>
              <li>Export your data</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Changes to This Policy</h2>
            <p className="text-gray-700 mb-4">
              We may update this Privacy Policy from time to time. We will notify you of any
              changes by posting the new Privacy Policy on this page and updating the
              &quot;Last updated&quot; date.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Contact Us</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about this Privacy Policy, please contact us at:{' '}
              <a href="mailto:mihirmirpuri@gmail.com" className="text-blue-600 hover:text-blue-800">
                mihirmirpuri@gmail.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
