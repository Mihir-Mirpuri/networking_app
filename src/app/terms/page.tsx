import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service - Lattice',
  description: 'Terms of Service for Lattice',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <Link
          href="/"
          className="text-blue-600 hover:text-blue-800 text-sm mb-6 inline-block"
        >
          &larr; Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-500 mb-8">Last updated: January 26, 2025</p>

        <div className="prose prose-gray max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
            <p className="text-gray-700 mb-4">
              By accessing or using Lattice (&quot;the Service&quot;), you agree to be bound by these
              Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Description of Service</h2>
            <p className="text-gray-700 mb-4">
              Lattice is a recruiting outreach tool that helps users connect with professionals
              in finance and consulting industries. The Service allows you to:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Search for and discover professional contacts</li>
              <li>Generate and customize outreach emails</li>
              <li>Send emails through your connected Gmail account</li>
              <li>Track email conversations and responses</li>
              <li>Upload and manage resumes for personalized outreach</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Account Requirements</h2>
            <p className="text-gray-700 mb-4">
              To use the Service, you must:
            </p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Have a valid Google account</li>
              <li>Grant the necessary permissions for Gmail access</li>
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account credentials</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Acceptable Use</h2>
            <p className="text-gray-700 mb-4">You agree NOT to use the Service to:</p>
            <ul className="list-disc pl-6 text-gray-700 mb-4">
              <li>Send spam, unsolicited bulk emails, or harassing messages</li>
              <li>Violate any applicable laws or regulations</li>
              <li>Impersonate any person or entity</li>
              <li>Collect or harvest email addresses for unauthorized purposes</li>
              <li>Interfere with or disrupt the Service or servers</li>
              <li>Attempt to gain unauthorized access to any part of the Service</li>
              <li>Use the Service for any illegal or fraudulent activity</li>
              <li>Violate the terms of service of Google or Gmail</li>
            </ul>
            <p className="text-gray-700 mb-4">
              We reserve the right to terminate accounts that violate these guidelines.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Email Sending Limits</h2>
            <p className="text-gray-700 mb-4">
              To prevent abuse and ensure service quality, we impose daily limits on the number
              of emails you can send through the Service. These limits may be adjusted at our
              discretion. You are responsible for ensuring your email activity complies with
              Gmail&apos;s sending limits and policies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">6. User Content</h2>
            <p className="text-gray-700 mb-4">
              You retain ownership of any content you submit, including resumes and email drafts.
              By using the Service, you grant us a limited license to use, process, and store
              your content solely for the purpose of providing the Service.
            </p>
            <p className="text-gray-700 mb-4">
              You are solely responsible for the content of emails you send through the Service.
              We do not review or approve email content before sending.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">7. AI-Generated Content</h2>
            <p className="text-gray-700 mb-4">
              The Service uses artificial intelligence to generate email drafts and summaries.
              AI-generated content is provided as a starting point and should be reviewed and
              edited before sending. We do not guarantee the accuracy, appropriateness, or
              effectiveness of AI-generated content.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Third-Party Services</h2>
            <p className="text-gray-700 mb-4">
              The Service integrates with third-party services including Google/Gmail. Your use
              of these integrations is subject to the respective terms of service and privacy
              policies of those providers. We are not responsible for the availability or
              functionality of third-party services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Disclaimer of Warranties</h2>
            <p className="text-gray-700 mb-4">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY
              KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES
              OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p className="text-gray-700 mb-4">
              We do not warrant that the Service will be uninterrupted, error-free, or secure.
              We do not guarantee any specific results from using the Service, including
              responses to outreach emails.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Limitation of Liability</h2>
            <p className="text-gray-700 mb-4">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS
              OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE,
              GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM YOUR USE OF THE SERVICE.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">11. Indemnification</h2>
            <p className="text-gray-700 mb-4">
              You agree to indemnify and hold harmless Lattice and its operators from any claims,
              damages, losses, or expenses arising from your use of the Service, your violation
              of these Terms, or your violation of any rights of a third party.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">12. Termination</h2>
            <p className="text-gray-700 mb-4">
              We may terminate or suspend your access to the Service at any time, with or without
              cause, with or without notice. Upon termination, your right to use the Service will
              immediately cease.
            </p>
            <p className="text-gray-700 mb-4">
              You may terminate your account at any time by contacting us. Upon termination,
              we will delete your data in accordance with our Privacy Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">13. Changes to Terms</h2>
            <p className="text-gray-700 mb-4">
              We reserve the right to modify these Terms at any time. We will notify users of
              material changes by updating the &quot;Last updated&quot; date. Your continued use of the
              Service after changes constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">14. Governing Law</h2>
            <p className="text-gray-700 mb-4">
              These Terms shall be governed by and construed in accordance with the laws of the
              United States, without regard to conflict of law principles.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">15. Contact Us</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about these Terms of Service, please contact us at:{' '}
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
