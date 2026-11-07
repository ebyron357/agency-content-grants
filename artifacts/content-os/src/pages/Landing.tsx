import { useState } from 'react';
import { Mic, Mountain } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Where the sign-up form picks up an email typed on the landing page. Session-only, never a URL. */
export const SIGNUP_EMAIL_KEY = 'grantcrest.signup.email';

const GRANTS_GOV_NOTICE =
  'This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.';

interface ExampleMatch {
  name: string;
  source: string;
  fit: string;
  due: string;
  strong?: boolean;
  hidden?: string;
}

/** Illustrative rows for the product preview. They are labelled "Example" on the page. */
const EXAMPLE_MATCHES: ExampleMatch[] = [
  { name: 'Youth Literacy Expansion Fund', source: 'Private foundation', fit: '4 of 4 met', due: '24 days', strong: true },
  { name: 'Community Arts Access Grant', source: 'Federal · Grants.gov', fit: '3 of 4 met', due: '41 days' },
  { name: 'After-School Learning Partners', source: 'Community foundation', fit: '3 of 4 met', due: 'Rolling' },
  { name: 'Early Reading Innovation Award', source: 'Private foundation', fit: '3 of 4 met', due: '58 days' },
  { name: 'Workforce Development Loan', source: '', fit: '', due: '', hidden: 'Hidden by your rule: grants only' },
];

function BrandLink() {
  return (
    <a href={`${BASE}/`} className="flex items-center gap-2.5 text-[#eef0f3]">
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#d4363c] text-white">
        <Mountain className="h-[15px] w-[15px]" aria-hidden="true" />
      </span>
      <span className="text-base font-semibold tracking-tight">GrantCrest</span>
    </a>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-[1176px] text-left sm:mt-20">
      <div aria-hidden="true" className="absolute inset-x-[12%] -top-px h-px bg-gradient-to-r from-transparent via-[#ff7979] to-transparent" />
      <figure
        aria-label="Example of the GrantCrest matches screen"
        className="overflow-hidden rounded-[14px] border border-[#222837] bg-[#0b0e14] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]"
      >
        <div className="flex h-10 items-center gap-2 border-b border-[#171b25] bg-[#0d1017] px-3.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#262c3a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#262c3a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#262c3a]" />
          <span className="mx-auto font-mono text-[11px] text-[#8a919e]">Example</span>
        </div>
        <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_300px]">
          <div className="hidden flex-col gap-0.5 border-r border-[#171b25] bg-[#090c11] p-3 text-[13px] lg:flex">
            <span className="flex justify-between rounded-[7px] bg-[#151922] px-2.5 py-2 font-medium text-[#eef0f3]">Matches</span>
            <span className="px-2.5 py-2 text-[#9aa1ad]">Applications</span>
            <span className="px-2.5 py-2 text-[#9aa1ad]">Deadlines</span>
            <span className="px-2.5 py-2 text-[#9aa1ad]">Our profile</span>
            <span className="mt-4 px-2.5 pb-1 text-[11px] tracking-wider text-[#8a919e]">YOUR RULES</span>
            <span className="px-2.5 py-1.5 text-[#9aa1ad]">Grants only</span>
            <span className="px-2.5 py-1.5 text-[#9aa1ad]">Georgia</span>
          </div>
          <div className="min-w-0 p-4 sm:p-5">
            <p className="mb-3 text-[15px] font-semibold text-[#eef0f3]">Open grants that fit you</p>
            <ul className="space-y-1">
              {EXAMPLE_MATCHES.map((m) => (
                <li
                  key={m.name}
                  className={
                    'flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-3 text-[13px] ' +
                    (m.strong ? 'bg-[#11151d] shadow-[inset_2px_0_0_#ff7979]' : '') +
                    (m.hidden ? ' opacity-60' : '')
                  }
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-[#eef0f3]">{m.name}</span>
                    <span className="block text-xs text-[#8a919e]">{m.hidden ?? m.source}</span>
                  </span>
                  {!m.hidden && (
                    <span className="flex gap-5 text-xs">
                      <span className={m.strong ? 'text-[#7ee0a1]' : 'text-[#c9ced7]'}>{m.fit}</span>
                      <span className={m.strong ? 'text-[#ff9a9a]' : 'text-[#c9ced7]'}>{m.due}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden flex-col gap-4 border-l border-[#171b25] bg-[#0a0d12] p-[18px] lg:flex">
            <div>
              <p className="text-sm font-semibold text-[#eef0f3]">Youth Literacy Expansion Fund</p>
              <p className="mt-1 font-mono text-[11px] text-[#8a919e]">WHY YOU QUALIFY</p>
            </div>
            <ul className="space-y-2 text-[12.5px] text-[#c9ced7]">
              <li>Open to 501(c)(3) nonprofits</li>
              <li>Funds work in Georgia</li>
              <li>Youth education is a priority</li>
              <li>Has funded groups your size</li>
            </ul>
            <div className="rounded-[10px] border border-[#1f2533] bg-[#0e1118] p-3.5">
              <p className="mb-2 font-mono text-[10.5px] tracking-wider text-[#8a919e]">STATEMENT OF NEED · DRAFT</p>
              <p className="text-[13px] leading-relaxed text-[#d6dae1]">
                Last spring, a mother of three walked into our pantry for the first time.{' '}
                <span className="border-b border-dashed border-[#ff7979] text-[#ff9a9a]">Add: what changed for her?</span>
              </p>
            </div>
          </div>
        </div>
      </figure>
    </div>
  );
}

const FEATURES = [
  { title: 'Matches with receipts', body: 'Every match lists the checks it passed, so you can see why you fit before you spend an hour on it.' },
  { title: 'Rules that stick', body: 'Set your filters once, like grants only or your state, and they apply to every search.' },
  { title: 'Your voice, not a robot’s', body: 'Drafts are built from your own stories and facts, and nothing is final until a person approves it.' },
];

/** The public front page of grantcrest.co, shown to signed-out visitors while sign-up is open. */
export default function Landing({ navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void } = {}) {
  const [email, setEmail] = useState('');

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (email.trim()) sessionStorage.setItem(SIGNUP_EMAIL_KEY, email.trim());
    } catch {
      // Storage can be unavailable (private windows); the form simply starts empty.
    }
    navigate(`${BASE}/signup`);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#07090d] text-[#eef0f3]">
      <header className="border-b border-[#151922]">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <BrandLink />
          <nav aria-label="Account" className="flex items-center gap-1.5 text-sm">
            <a href={`${BASE}/login`} className="rounded-lg px-3.5 py-2.5 text-[#c9ced7] hover:text-white">Log in</a>
            <a href={`${BASE}/signup`} className="rounded-lg bg-[#eef0f3] px-4 py-2.5 font-semibold text-[#07090d] hover:bg-white">Start free</a>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="relative px-5 pt-20 text-center sm:px-8 sm:pt-28">
          <div
            aria-hidden="true"
            className="absolute inset-0 [background-image:radial-gradient(#1b2030_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(#000,transparent_70%)]"
          />
          <div className="relative">
            <h1 className="mx-auto max-w-[900px] text-[42px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[76px] sm:leading-[1.02]">
              Every grant you qualify for. <span className="text-[#8a919e]">One place to win them.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[600px] text-base leading-relaxed text-[#9aa1ad] sm:text-[19px]">
              GrantCrest finds open grants that fit your organization, shows exactly why, and walks your application to done, in your own words.
            </p>
            <form onSubmit={start} className="mx-auto mt-9 flex max-w-[460px] flex-col gap-2 rounded-xl border border-[#262c3a] bg-[#0e1118] p-1.5 sm:flex-row">
              <label htmlFor="landing-email" className="sr-only">Work email</label>
              <input
                id="landing-email"
                type="email"
                autoComplete="email"
                placeholder="you@yourorganization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-[#eef0f3] placeholder:text-[#6f7684] focus:outline-none"
              />
              <button type="submit" className="h-11 rounded-lg bg-[#d4363c] px-[18px] text-[15px] font-semibold text-white hover:bg-[#c02f35]">
                Get my matches
              </button>
            </form>
            <p className="mt-3.5 text-[13px] text-[#8a919e]">Free to search. No card.</p>
          </div>
          <ProductPreview />
        </section>

        <section aria-label="Where matches come from" className="px-5 pt-16 sm:px-8">
          <p className="flex flex-wrap justify-center gap-x-11 gap-y-3 font-mono text-xs tracking-wider text-[#8a919e]">
            <span>FEDERAL GRANTS · GRANTS.GOV</span>
            <span>FOUNDATION GIVING · PUBLIC TAX FILINGS</span>
          </p>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 pt-28 sm:px-8">
          <h2 className="max-w-[700px] text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">
            Built to fix what other grant tools get wrong.
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="rounded-[14px] border border-[#1c212d] bg-[#0b0e14] p-6">
                {i === 2 && <Mic className="mb-4 h-5 w-5 text-[#ff7979]" aria-hidden="true" />}
                <h3 className="text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#9aa1ad]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-5 pb-28 pt-32 text-center sm:px-8">
          <h2 className="mx-auto max-w-[760px] text-[32px] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[56px]">
            See which grants fit you. <span className="text-[#8a919e]">It takes two minutes.</span>
          </h2>
          <a href={`${BASE}/signup`} className="mt-9 inline-block rounded-[10px] bg-[#d4363c] px-6 py-3.5 text-[15px] font-semibold text-white hover:bg-[#c02f35]">
            Get my matches
          </a>
        </section>
      </main>

      <footer className="border-t border-[#151922] px-5 py-9 sm:px-8">
        <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-4 text-[13px] text-[#8a919e] sm:flex-row">
          <span className="font-semibold text-[#c9ced7]">GrantCrest</span>
          <span className="max-w-[640px] leading-relaxed" data-testid="grants-gov-notice">{GRANTS_GOV_NOTICE}</span>
        </div>
      </footer>
    </div>
  );
}
