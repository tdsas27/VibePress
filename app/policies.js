/* Starter privacy and cookie policy text, written to match what this software actually does. Review and adjust for your situation. */
exports.privacy = v => `*Last updated: ${v.date}*

${v.name} ("we", "us") runs ${v.domain}. This policy explains what information we handle when you use the site. Questions? Contact us at ${v.contact}.

## What we collect

**Server logs.** Like most websites, our server automatically records your IP address, the time of your visit, the pages you request, your browser type, and the page that sent you here. We use this to keep the site running, stop spam and abuse, and block attacks. Addresses that cause many errors may be blocked for a few hours. We also look at summary reports built from these logs, such as which pages are popular, which websites send visitors, and which countries and devices visitors use. These reports do not identify individual visitors. Logs are kept for a short time (usually about two weeks) and then deleted.

**Feedback and tester forms.** If you send feedback, we receive what you type: the message type, your message, and optionally your name and contact details. If you apply to be a tester, we also collect the app you want to test, your device and system, your age range, your country or region, and any social links you choose to add. We use this to reply, fix problems, improve our apps, and choose testers. We do not store your IP address with your message. We keep messages until they are no longer needed, and you can ask us to delete yours at any time.

**Downloads.** We count how many times each file is downloaded. The count is not linked to you.

**Site owner login.** Only the site owner signs in to the admin area. Visitors do not need an account.

## What we do not do

We do not sell your information, show advertising, or use third-party analytics or tracking cookies at the time of writing. If that changes, we will update this policy and our [Cookie Policy](/cookies/).

## Other services

Some features involve other companies, which have their own privacy policies:

- **Google Fonts.** Your browser downloads our font from Google, so Google receives your IP address and browser details.
- **Cloudflare Turnstile.** Our feedback form may use Cloudflare Turnstile to tell people from bots.
- **Games and apps hosted elsewhere.** Some games appear inside a frame from another website, which handles your information under its own rules.
- **Tips and support.** If you tip us through Buy Me A Coffee, Venmo, or a cryptocurrency network, that service processes your payment. We never see or store your payment details.
- **Links.** Links to social networks and other sites take you outside our control.
- **Hosting.** The site runs on a server from a hosting provider.

## How we protect information

We use HTTPS, hashed passwords with two-step sign-in for the admin area, and automatic blocking of abusive traffic. No system is perfectly secure, so please do not send us sensitive information in the feedback form.

## Your choices and rights

You can ask us to show you, correct, or delete the information we hold about you. Depending on where you live (for example the European Economic Area, the United Kingdom, or California), you may have additional rights under local law. Contact us at ${v.contact} and we will respond within a reasonable time, normally within 30 days.

## Children

The site is not directed at children under 13, and our tester program is for adults (18 and over). If you believe a child has sent us personal information, contact us and we will delete it.

## International visitors

Our server may be in a different country from you. By using the site you understand that your information may be processed there.

## Changes

We may update this policy. The date at the top shows when it last changed.
`;
exports.cookies = v => `*Last updated: ${v.date}*

## What are cookies?

Cookies are small text files that a website stores in your browser. Websites also use similar tools, such as local storage, to remember things.

## Cookies we use

**Visitors: none.** ${v.name} does not set cookies in your browser when you read pages, download files, or send feedback.

**Site owner sign-in.** The admin area uses one strictly necessary cookie to keep the site owner signed in. It is not used for tracking and only applies to the admin area. While the owner is signed in, a second small cookie lets pages show a link back to the dashboard.

## Third-party content

Some features load content from other companies, which may set their own cookies or similar storage:

- **Cloudflare Turnstile** (on the feedback form, when enabled) checks that a visitor is human and may use cookies or local storage to do that.
- **Games and tools shown from other websites** run on that website, which may store your progress or settings in your browser.
- **Google Fonts** delivers our font. It receives your IP address but does not need cookies to do so.
- **Links to social networks, payment services and other sites** follow those sites' own cookie rules.

We do not control these, so please check their policies.

## No tracking, so no banner

Because we only use cookies that are strictly necessary, we do not show a cookie consent banner. If we ever add analytics, advertising or other optional cookies, we will ask for your permission first and update this page.

## Your choices

You can block or delete cookies in your browser settings, and most browsers can block third-party cookies. Blocking third-party content may stop some embedded games, or the spam check on the feedback form, from working.

## Contact

Questions? Contact us at ${v.contact}. See also our [Privacy Policy](/privacy/).
`;
