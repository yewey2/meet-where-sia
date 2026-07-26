import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRightIcon,
  CheckIcon,
  MapPinIcon,
  SparkIcon,
} from './components/Icons';
import { ThemeToggle } from './components/ThemeToggle';
import './support.css';

const PAYNOW_MOBILE = '91449876';
const DISPLAY_PAYNOW_MOBILE = '9144 9876';

function ExternalLinkNotice() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}

export function SupportPage() {
  const [copyStatus, setCopyStatus] = useState('');
  const numberFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const previousDescription = description?.content;

    document.title = 'Support Meet Where Sia';
    description?.setAttribute(
      'content',
      'Leave an optional tip to help keep Meet Where Sia free and improving.',
    );

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) {
        description.content = previousDescription;
      }
    };
  }, []);

  async function copyPayNowNumber() {
    try {
      await navigator.clipboard.writeText(PAYNOW_MOBILE);
      setCopyStatus('PayNow mobile number copied.');
      return;
    } catch {
      const field = numberFieldRef.current;
      if (!field) {
        setCopyStatus('Copy failed. Enter 9144 9876 in your banking app.');
        return;
      }

      field.focus();
      field.select();
      try {
        const copied = document.execCommand('copy');
        setCopyStatus(
          copied
            ? 'PayNow mobile number copied.'
            : 'Copy failed. The number is selected for manual copying.',
        );
      } catch {
        setCopyStatus('Copy failed. The number is selected for manual copying.');
      }
    }
  }

  return (
    <div className="support-site">
      <a className="support-skip-link" href="#support-content">
        Skip to support options
      </a>

      <header className="topbar support-topbar">
        <a className="brand-lockup support-brand" href="/" aria-label="Meet Where Sia home">
          <span className="brand-mark"><MapPinIcon /></span>
          <span className="support-brand-copy">
            <strong>Meet Where Sia</strong>
            <span>Singapore meetup planner</span>
          </span>
        </a>
        <div className="topbar-actions">
          <a className="support-back-link" href="/">Back to planner</a>
          <ThemeToggle />
        </div>
      </header>

      <main className="support-main" id="support-content" tabIndex={-1}>
        <section className="support-intro" aria-labelledby="support-title">
          <div className="support-kicker"><SparkIcon /> Independent Singapore project</div>
          <h1 id="support-title">Saved the group chat? Buy me a kopi.</h1>
          <p className="support-lead">
            I’m building Meet Where Sia independently in Singapore. If it saved your
            group some back-and-forth, an optional tip helps keep it free and improving.
          </p>
          <ul className="support-trust-list" aria-label="Support principles">
            <li>Optional</li>
            <li>Any amount</li>
            <li>Results stay fair</li>
          </ul>
        </section>

        <article className="paynow-card" aria-labelledby="paynow-title">
          <div className="paynow-card-heading">
            <div>
              <span className="support-method-kicker">Fastest for Singapore</span>
              <h2 id="paynow-title">PayNow a kopi</h2>
              <p>Pay in your banking app. No Meet Where Sia sign-up needed.</p>
            </div>
            <span className="support-badge">SGD · instant</span>
          </div>

          <div className="paynow-content">
            <div className="paynow-details">
              <div className="support-amount-nudge">
                <span>Choose the amount in your bank app</span>
                <strong>S$2 or S$5 is plenty — any amount works</strong>
              </div>

              <div className="support-actions">
                <button
                  className="support-primary-action"
                  type="button"
                  onClick={copyPayNowNumber}
                >
                  {copyStatus === 'PayNow mobile number copied.'
                    ? 'Copied ✓'
                    : 'Copy 9144 9876'}
                </button>
                <a
                  className="support-secondary-action"
                  href="/paynow-qr-ff86bbf4.png"
                  download="meet-where-sia-paynow.png"
                >
                  Save QR instead
                </a>
              </div>

              <label className="paynow-number-field">
                <span>PayNow mobile</span>
                <input
                  ref={numberFieldRef}
                  readOnly
                  value={DISPLAY_PAYNOW_MOBILE}
                  aria-label="PayNow mobile number"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p className="support-copy-status" role="status" aria-live="polite">
                {copyStatus || '\u00a0'}
              </p>

              <div className="paynow-steps">
                <div className="paynow-step-desktop">
                  <strong>On desktop</strong>
                  <span>Open your banking app and scan the QR.</span>
                </div>
                <div className="paynow-step-mobile">
                  <strong>On this phone</strong>
                  <span>Open your banking app → PayNow → Mobile number, then paste 9144 9876.</span>
                </div>
              </div>

              <div className="paynow-safety-note">
                <CheckIcon />
                <p>
                  Only continue if you recognise the recipient shown by your bank. Otherwise, cancel.
                </p>
              </div>
            </div>

            <figure className="paynow-qr-figure">
              <div className="paynow-qr-frame">
                <img
                  src="/paynow-qr-ff86bbf4.png"
                  alt="PayNow QR code for mobile number 9144 9876"
                  width="630"
                  height="630"
                />
              </div>
              <figcaption>
                <span className="qr-caption-desktop">Scan with your banking app</span>
                <span className="qr-caption-mobile">
                  Prefer QR? If it opens, long-press to save, then upload it in Scan &amp; Pay.
                </span>
              </figcaption>
            </figure>
          </div>

          <p className="paynow-privacy-note">
            This page never receives your bank login or payment status. Payment happens in your banking app.
          </p>
        </article>

        <section className="support-info-card" aria-labelledby="support-impact-title">
          <h2 id="support-impact-title">What a kopi helps with</h2>
          <ul>
            <li><CheckIcon /><span>Hosting and map services</span></li>
            <li><CheckIcon /><span>Singapore station and route upkeep</span></li>
            <li><CheckIcon /><span>Small, useful UX improvements</span></li>
          </ul>
          <p>Tips never unlock features, buy priority, or influence meeting recommendations.</p>
        </section>

        <section className="support-other-card" aria-labelledby="support-other-title">
          <div>
            <span className="support-method-kicker">Prefer another platform?</span>
            <h2 id="support-other-title">Other ways to support</h2>
          </div>
          <nav aria-label="Other support platforms">
            <a
              href="https://ko-fi.com/sycprojects"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span><strong>Ko-fi</strong><small>Cards and wallets</small></span>
              <ArrowUpRightIcon /><ExternalLinkNotice />
            </a>
            <a
              href="https://github.com/sponsors/yewey2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span><strong>GitHub Sponsors</strong><small>For GitHub users</small></span>
              <ArrowUpRightIcon /><ExternalLinkNotice />
            </a>
          </nav>
        </section>
      </main>

      <footer className="app-footer support-footer">
        <div>
          <strong>Meet Where Sia</strong>
          <span>Free to use · Built in Singapore · © {new Date().getFullYear()}</span>
        </div>
        <nav aria-label="Footer links">
          <a href="/">Planner</a>
          <a
            href="https://github.com/yewey2/meet-where-sia"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub<ExternalLinkNotice />
          </a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </nav>
      </footer>
    </div>
  );
}