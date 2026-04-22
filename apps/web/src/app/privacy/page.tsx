import Link from "next/link";
import { Gem } from "lucide-react";

export const metadata = {
  title: "Privacy Policy - Opcify",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8 sm:py-16">
      {/* Header */}
      <div className="mb-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-secondary">
          <Gem className="h-5 w-5 text-emerald-400" />
          <span className="text-lg font-bold tracking-tight text-primary">Opcify</span>
        </Link>
      </div>

      <h1 className="text-3xl font-bold tracking-tight text-primary">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Last updated: March 27, 2026</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-secondary">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">1. Introduction</h2>
          <p>
            Opcify (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI Workspace Platform, including our website, applications, and related services (collectively, the &quot;Service&quot;).
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">2. Information We Collect</h2>
          <h3 className="mb-2 font-medium text-primary">2.1 Information You Provide</h3>
          <ul className="mb-4 list-disc space-y-1.5 pl-5">
            <li>Account registration data (name, email address, password)</li>
            <li>Profile information (company name, role)</li>
            <li>Workspace configuration and settings</li>
            <li>Content you create, upload, or share through the Service</li>
            <li>Communications with us (support requests, feedback)</li>
          </ul>
          <h3 className="mb-2 font-medium text-primary">2.2 Information Collected Automatically</h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Device and browser information</li>
            <li>IP address and approximate location</li>
            <li>Usage data and interaction patterns</li>
            <li>Cookies and similar tracking technologies</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">3. How We Use Your Information</h2>
          <p className="mb-3">We use the information we collect to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Provide, maintain, and improve the Service</li>
            <li>Process transactions and manage your account</li>
            <li>Operate AI agents and workspaces on your behalf</li>
            <li>Send you technical notices, updates, and support messages</li>
            <li>Respond to your inquiries and provide customer support</li>
            <li>Monitor and analyze usage trends to improve user experience</li>
            <li>Detect, prevent, and address fraud, abuse, or technical issues</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">4. Data Sharing and Disclosure</h2>
          <p className="mb-3">We do not sell your personal information. We may share your information with:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Service providers</strong> who assist us in operating the platform</li>
            <li><strong>AI model providers</strong> to process tasks you assign to AI agents (task content only)</li>
            <li><strong>Legal authorities</strong> when required by law or to protect our rights</li>
            <li><strong>Business partners</strong> in connection with a merger, acquisition, or sale of assets</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">5. Data Security</h2>
          <p>
            We implement industry-standard security measures to protect your data, including encryption in transit and at rest, access controls, and regular security assessments. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">6. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as needed to provide the Service. You may request deletion of your account and associated data at any time by contacting us. Some data may be retained for legal or legitimate business purposes.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">7. Your Rights</h2>
          <p className="mb-3">Depending on your location, you may have the right to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Access and receive a copy of your personal data</li>
            <li>Correct inaccurate or incomplete data</li>
            <li>Request deletion of your data</li>
            <li>Object to or restrict processing of your data</li>
            <li>Data portability</li>
            <li>Withdraw consent at any time</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">8. Cookies</h2>
          <p>
            We use cookies and similar technologies to maintain your session, remember your preferences, and analyze usage. You can manage cookie preferences through your browser settings. Disabling cookies may affect the functionality of the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">9. Children&apos;s Privacy</h2>
          <p>
            The Service is not intended for users under the age of 16. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete it promptly.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page and updating the &quot;Last updated&quot; date. Your continued use of the Service after changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">11. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, please contact us at{" "}
            <a href="mailto:privacy@opcify.com" className="text-emerald-500 hover:text-emerald-400">
              privacy@opcify.com
            </a>.
          </p>
        </section>
      </div>

      {/* Footer */}
      <div className="mt-12 border-t border-border-muted pt-6 text-xs text-muted">
        <div className="flex items-center gap-4">
          <Link href="/terms" className="transition-colors hover:text-secondary">Terms of Service</Link>
          <span className="text-border-muted">|</span>
          <Link href="/login" className="transition-colors hover:text-secondary">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
