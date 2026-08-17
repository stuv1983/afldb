import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What AFLDB stores, what it does not, and how to change your mind.',
};

/**
 * The page the consent banner links to. Written as an honest inventory
 * rather than a policy: everything below is checkable against the code
 * it names, and naming the file is deliberate -- a claim someone can
 * verify is worth more than a paragraph of assurance.
 */
export default function PrivacyPage() {
  return (
    <>
      <div className="page-header">
        <h1>Privacy</h1>
        <p className="subtitle">What AFLDB stores, and what it does not.</p>
      </div>

      <section className="section">
        <h2>What AFLDB does not do</h2>
        <p>
          There is no third-party analytics, no advertising, no tracking pixel and no social
          embed on this site. Nothing you do here is sent to another company. The
          Content-Security-Policy blocks scripts, fonts and images from other origins outright,
          so this is enforced by the browser rather than promised.
        </p>
        <p>
          No account is needed to read anything, and reading does not create one.
        </p>
      </section>

      <section className="section">
        <h2>Cookies</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Cookie</th>
              <th scope="col">Purpose</th>
              <th scope="col">Lasts</th>
              <th scope="col">Needs consent</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>nl_sid</code></td>
              <td>
                Links the searches made in one visit, so we can tell when the search engine
                misread a question and you had to rephrase it. A random number. Not derived from
                your address, your device or any account.
              </td>
              <td>30 minutes</td>
              <td>Yes — set only if you accept</td>
            </tr>
            <tr>
              <td><code>afldb_consent</code></td>
              <td>Remembers the answer you gave the banner, so it stops asking.</td>
              <td>1 year</td>
              <td>No — it exists to honour your choice</td>
            </tr>
            <tr>
              <td>Session and access cookies</td>
              <td>
                Keep an administrator logged in, and remember that a beta code was accepted.
                Only set if you use those things.
              </td>
              <td>Session</td>
              <td>No — the site cannot do what you asked without them</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>Searches</h2>
        <p>
          AFLDB records the questions typed into search, along with how the engine interpreted
          them and whether it managed to answer. This is how the search engine gets better: the
          questions it fails on are the list of what to fix next.
        </p>
        <p>
          What is stored is the question text and the engine’s own workings. No IP address, no
          browser fingerprint and no account identifier is stored against a search.
        </p>
        <p>
          If you answer <em>“Did AFLDB understand this question?”</em> under a result, that reply
          and anything you type in the box is stored too, and is linked to that one search. It is
          anonymous, so please don’t type anything personal into it.
        </p>
      </section>

      <section className="section">
        <h2>Changing your mind</h2>
        <p>
          Declining removes the <code>nl_sid</code> cookie immediately if one was already set, and
          it stays removed: that cookie is kept only while an acceptance is on record, so any
          later visit without one clears it again. You can also clear cookies for this site in
          your browser at any time; the banner will then ask again.
        </p>
        <p>
          <Link href="/">Back to AFLDB</Link>
        </p>
      </section>
    </>
  );
}
