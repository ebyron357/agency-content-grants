/** Curated primary-source research. No network scraping, applicant data or eligibility scoring. */
export type FundingKind =
  | "Cash grant"
  | "Partner-led grant"
  | "Grant or investment"
  | "Advertising credit"
  | "Software grant"
  | "Cloud credit"
  | "Fundraising platform"
  | "Funding directory";
export type ProgramStatus =
  | "Cycle published"
  | "Chapter dependent"
  | "Rolling"
  | "Upcoming"
  | "Partner required"
  | "Closed"
  | "Paused"
  | "Program available"
  | "Verify terms"
  | "Platform"
  | "Directory";
export interface GrantResource {
  id: string;
  name: string;
  kind: FundingKind;
  amount: string;
  regions: string[];
  topics: string[];
  summary: string;
  eligibility: string;
  uses: string;
  restrictions: string;
  cycle: string;
  status: ProgramStatus;
  sources: { label: string; url: string }[];
  checkedOn: string;
  deadline: string | null;
}
export const grantResources: GrantResource[] = [
  {
    id: "walmart",
    name: "Walmart Spark Good Local Grants",
    kind: "Cash grant",
    amount: "$250–$5,000",
    regions: ["United States"],
    topics: ["Community", "Food", "Education"],
    summary: "Local community funding from Walmart and Sam’s Club facilities.",
    eligibility:
      "Eligible U.S. public charities, schools, government entities and qualifying faith-based organizations; Spark Good account and Deed verification required.",
    uses: "Projects directly benefiting the community served by the facility.",
    restrictions:
      "A U.S. registration alone does not make an overseas-only project eligible. Check facility service area and current guidelines.",
    cycle:
      "Published 2026 cycle 3: August 1–December 31. Confirm the closing time in the portal.",
    status: "Cycle published",
    sources: [
      {
        label: "Program and cycles",
        url: "https://www.walmart.org/sg/Join-Spark-Good/program/local-grants",
      },
      {
        label: "Eligibility and local service area",
        url: "https://www.walmart.org/resources/faqs",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: "2026-12-31",
  },
  {
    id: "awesome",
    name: "The Awesome Foundation",
    kind: "Cash grant",
    amount: "Usually $1,000",
    regions: ["United States", "International"],
    topics: ["Community", "Arts", "Technology"],
    summary: "Small grants awarded independently by local or themed chapters.",
    eligibility:
      "Individuals, groups and organizations may apply; chapter priorities and location matter.",
    uses: "A concrete project with a useful community benefit.",
    restrictions:
      "Many chapters prioritize their own communities. Not a guaranteed source for ongoing operating costs.",
    cycle: "Usually monthly; select a chapter to check its schedule.",
    status: "Chapter dependent",
    sources: [
      {
        label: "Program",
        url: "https://www.awesomefoundation.org/en",
      },
      {
        label: "Eligibility and chapters",
        url: "https://www.awesomefoundation.org/faq",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "pollination",
    name: "The Pollination Project",
    kind: "Cash grant",
    amount: "Up to $500",
    regions: ["United States", "International"],
    topics: ["Community", "Environment", "Food"],
    summary:
      "Seed support for small volunteer-led charitable projects worldwide.",
    eligibility:
      "First-time recipients; no paid staff; project budget under $10,000 and organization budget under $50,000.",
    uses: "Early project costs within the funder’s charitable and environmental rules.",
    restrictions:
      "No payments for the grantee’s or family’s time, animal products or animal agriculture. Food banks may request eligible infrastructure costs.",
    cycle:
      "Rolling review, with a brief year-end closure; English application.",
    status: "Rolling",
    sources: [
      {
        label: "Application and restrictions",
        url: "https://thepollinationproject.org/apply/",
      },
      {
        label: "Grant amount",
        url: "https://thepollinationproject.org/funding-eligibility/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "peace",
    name: "Peace Development Fund — Community Organizing",
    kind: "Cash grant",
    amount: "Varies by fund",
    regions: ["United States", "Haiti", "Mexico"],
    topics: ["Social justice", "Youth", "Community"],
    summary:
      "Grassroots organizing that builds collective power and advances social justice.",
    eligibility:
      "Community organizations with annual budgets of $250,000 or less; check legal status or fiscal sponsor requirements.",
    uses: "Community organizing and organizational support aligned with the fund’s pillars.",
    restrictions:
      "Direct charity services alone may not meet the organizing focus. Confirm the new cycle’s full criteria.",
    cycle:
      "Next community organizing application opening announced for January 2027; exact deadline not yet published.",
    status: "Upcoming",
    sources: [
      {
        label: "Current timeline",
        url: "https://peacedevelopmentfund.org/grantmaking/how-to-apply/",
      },
      {
        label: "Geography and budget",
        url: "https://peacedevelopmentfund.org/frequently-asked-questions/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "dprize",
    name: "D-Prize",
    kind: "Cash grant",
    amount: "Up to $20,000",
    regions: ["International"],
    topics: ["Poverty", "Health", "Education"],
    summary:
      "Pilot funding for new organizations distributing proven poverty interventions.",
    eligibility:
      "Founders aged 18+ with a plan to live and operate in the implementation country. Typically under 18 months of operations and $30,000 raised.",
    uses: "A three-month pilot distributing an intervention accepted by the competition.",
    restrictions:
      "Not general aid, school construction, scholarships, new inventions or unproven products.",
    cycle:
      "Regular deadline November 15, 2026, midnight Pacific; registered extension December 6.",
    status: "Cycle published",
    sources: [
      {
        label: "Current competition",
        url: "https://d-prize.org/",
      },
      {
        label: "Eligibility and exclusions",
        url: "https://d-prize.org/faqs",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: "2026-11-15",
  },
  {
    id: "drk",
    name: "Draper Richards Kaplan Foundation",
    kind: "Grant or investment",
    amount: "Up to $300,000 over three years",
    regions: ["United States", "Africa", "Europe", "India"],
    topics: ["Social enterprise", "Community"],
    summary:
      "Growth support for scalable social impact organizations with demonstrated results.",
    eligibility:
      "Independent early-stage organizations operating in Africa, Europe, India or the U.S.; beyond idea stage.",
    uses: "Unrestricted grant funding or investment capital plus hands-on capacity support; instrument determined during diligence.",
    restrictions:
      "Haiti-only operations are outside the published geography. Requires scale potential and an intensive working relationship.",
    cycle: "Applications accepted year round.",
    status: "Rolling",
    sources: [
      {
        label: "Funding model",
        url: "https://www.drkfoundation.org/apply/overview/",
      },
      {
        label: "Geographic and stage criteria",
        url: "https://www.drkfoundation.org/apply/faq/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "ned",
    name: "National Endowment for Democracy",
    kind: "Cash grant",
    amount: "Project-specific",
    regions: ["International", "Haiti"],
    topics: ["Human rights", "Democracy", "Media"],
    summary:
      "Funding for independent, nonpartisan democracy and human rights work abroad.",
    eligibility:
      "Nongovernmental groups working in eligible countries; individuals and government bodies are not eligible.",
    uses: "Civic education, independent media, human rights, accountability and related democratic work.",
    restrictions:
      "Not general humanitarian relief. U.S.-implemented democracy programs are excluded. Registration explanation required if unregistered.",
    cycle: "Next published proposal deadline: January 27, 2027.",
    status: "Cycle published",
    sources: [
      {
        label: "Eligibility, documents and deadlines",
        url: "https://www.ned.org/apply-for-grant/en/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: "2027-01-27",
  },
  {
    id: "rotary",
    name: "Rotary Foundation Global Grants",
    kind: "Partner-led grant",
    amount: "Project budget at least $30,000",
    regions: ["United States", "International"],
    topics: ["Water", "Health", "Education", "Environment"],
    summary:
      "International projects with measurable, sustainable community outcomes.",
    eligibility:
      "Qualified Rotary/Rotaract clubs or districts lead applications with host and international sponsors.",
    uses: "Activities within Rotary’s areas of focus and approved project terms.",
    restrictions:
      "A nonprofit cannot apply independently; first secure qualified Rotary partners. Project budget is not an automatic grant award.",
    cycle: "Confirm the applicable schedule with sponsoring clubs.",
    status: "Partner required",
    sources: [
      {
        label: "Who can apply",
        url: "https://www.rotary.org/get-involved/our-programs/grants",
      },
      {
        label: "Global grant requirements",
        url: "https://my.rotary.org/en/take-action/apply-grants/global-grants",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "dg-adult",
    name: "Dollar General — Adult Literacy",
    kind: "Cash grant",
    amount: "Up to $10,000",
    regions: ["United States"],
    topics: ["Literacy", "Education", "Youth"],
    summary: "Literacy support in Dollar General communities.",
    eligibility:
      "Eligible nonprofits, schools or public libraries providing direct literacy services within 15 miles of a Dollar General store; confirm category rules.",
    uses: "Adult literacy, English-language instruction or high school equivalency; eligible staff and instructional costs.",
    restrictions:
      "Geographic restriction applies. Awards and allowed costs vary by category.",
    cycle:
      "Next cycle expected January 2027; check published opening and deadline.",
    status: "Upcoming",
    sources: [
      {
        label: "Program cycles",
        url: "https://www.dgliteracy.org/grant-programs",
      },
      {
        label: "Amounts and eligibility",
        url: "https://grantprograms.dgliteracy.org/en/faq",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "dg-family",
    name: "Dollar General — Family Literacy",
    kind: "Cash grant",
    amount: "Up to $10,000",
    regions: ["United States"],
    topics: ["Literacy", "Education", "Youth"],
    summary: "Literacy support in Dollar General communities.",
    eligibility:
      "Eligible nonprofits, schools or public libraries providing direct literacy services within 15 miles of a Dollar General store; confirm category rules.",
    uses: "Programs combining adult instruction, children’s education and parent-child learning time.",
    restrictions:
      "Geographic restriction applies. Awards and allowed costs vary by category.",
    cycle:
      "Next cycle announced for January 2027; exact deadline not yet listed.",
    status: "Upcoming",
    sources: [
      {
        label: "Program cycles",
        url: "https://www.dgliteracy.org/grant-programs",
      },
      {
        label: "Amounts and eligibility",
        url: "https://grantprograms.dgliteracy.org/en/faq",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "dg-summer",
    name: "Dollar General — Summer Reading",
    kind: "Cash grant",
    amount: "Up to $3,000",
    regions: ["United States"],
    topics: ["Literacy", "Education", "Youth"],
    summary: "Literacy support in Dollar General communities.",
    eligibility:
      "Eligible nonprofits, schools or public libraries providing direct literacy services within 15 miles of a Dollar General store; confirm category rules.",
    uses: "Summer reading for pre-K through grade 12, particularly new or struggling readers.",
    restrictions:
      "Geographic restriction applies. Awards and allowed costs vary by category.",
    cycle:
      "Next cycle announced for January 2027; exact deadline not yet listed.",
    status: "Upcoming",
    sources: [
      {
        label: "Program cycles",
        url: "https://www.dgliteracy.org/grant-programs",
      },
      {
        label: "Amounts and eligibility",
        url: "https://grantprograms.dgliteracy.org/en/faq",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "dg-youth",
    name: "Dollar General — Youth Literacy",
    kind: "Cash grant",
    amount: "Up to $5,000",
    regions: ["United States"],
    topics: ["Literacy", "Education", "Youth"],
    summary: "Literacy support in Dollar General communities.",
    eligibility:
      "Eligible nonprofits, schools or public libraries providing direct literacy services within 15 miles of a Dollar General store; confirm category rules.",
    uses: "K–12 literacy support, books, instructional materials, software and technology.",
    restrictions:
      "Geographic restriction applies. Awards and allowed costs vary by category.",
    cycle: "2026 solicitation closed; check the next youth cycle.",
    status: "Closed",
    sources: [
      {
        label: "Program cycles",
        url: "https://www.dgliteracy.org/grant-programs",
      },
      {
        label: "Amounts and eligibility",
        url: "https://grantprograms.dgliteracy.org/en/faq",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "roddenberry",
    name: "Roddenberry Catalyst Fund",
    kind: "Cash grant",
    amount: "Historically $2,500–$15,000",
    regions: ["United States", "International"],
    topics: ["Innovation", "Community"],
    summary:
      "Early-stage social impact ideas; retained as a watchlist resource.",
    eligibility:
      "Historical program accepted applicants worldwide; any reopened call may change requirements.",
    uses: "Use a future call’s funding rules; no current application budget should rely on this award.",
    restrictions:
      "Current FAQ says no programs are open and no reopening dates are scheduled.",
    cycle: "No open call or scheduled reopening reported.",
    status: "Closed",
    sources: [
      {
        label: "Current availability",
        url: "https://apply.roddenberryfoundation.org/app/main/faqs",
      },
      {
        label: "Historical Catalyst range",
        url: "https://apply.roddenberryfoundation.org/app/catalyst",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "iaf",
    name: "Inter-American Foundation",
    kind: "Cash grant",
    amount: "No current award assumed",
    regions: ["Haiti", "Latin America", "Caribbean"],
    topics: ["Community", "Poverty"],
    summary:
      "Grassroots community development funder retained for status monitoring.",
    eligibility:
      "Do not rely on historical eligibility while funding is paused.",
    uses: "No currently available funding represented in this directory.",
    restrictions:
      "The official applicant portal reports proposal review and grant funding paused. Older grant listings may be misleading.",
    cycle: "Paused; no confirmed reopening date.",
    status: "Paused",
    sources: [
      {
        label: "Official applicant portal status",
        url: "https://iaf-grants.my.site.com/ApplicantLanding",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "google",
    name: "Google Ad Grants",
    kind: "Advertising credit",
    amount: "Up to $10,000/month in ads",
    regions: ["United States", "International"],
    topics: ["Advertising", "Fundraising", "Volunteers"],
    summary:
      "Google Search advertising credit to bring people to a nonprofit website.",
    eligibility:
      "Eligible verified nonprofits in supported countries, with a qualifying website and ongoing policy compliance.",
    uses: "Mission-related search advertising for donations, services, events and volunteer recruitment.",
    restrictions:
      "Not cash; cannot pay salaries, food, website development or agency fees. Unused credit does not roll over. Country eligibility must be checked.",
    cycle: "Apply through Google for Nonprofits; ongoing compliance required.",
    status: "Program available",
    sources: [
      {
        label: "Program terms and value",
        url: "https://www.google.com/grants/faq/",
      },
      {
        label: "Mission-based campaigns",
        url: "https://support.google.com/nonprofits/answer/4410314",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "microsoft365",
    name: "Microsoft 365 Business Basic for Nonprofits",
    kind: "Software grant",
    amount: "Up to 300 granted users",
    regions: ["United States", "International"],
    topics: ["Technology", "Operations"],
    summary: "Productivity tools for eligible nonprofits.",
    eligibility:
      "Microsoft nonprofit verification and country-specific offer availability required.",
    uses: "Eligible nonprofit email, collaboration, cloud storage and web/mobile productivity applications.",
    restrictions:
      "Not cash or a grant for equipment, payroll or desktop Office licenses. Confirm eligible users and current license terms.",
    cycle: "Available through nonprofit offer enrollment.",
    status: "Program available",
    sources: [
      {
        label: "Current nonprofit offers",
        url: "https://www.microsoft.com/en-us/nonprofits/offers-for-nonprofits",
      },
      {
        label: "Offer changes",
        url: "https://learn.microsoft.com/industry/nonprofit/microsoft-for-nonprofits/updates",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "azure",
    name: "Microsoft Azure Nonprofit Grant",
    kind: "Cloud credit",
    amount: "$2,000/year in Azure credit",
    regions: ["United States", "International"],
    topics: ["Technology", "Hosting"],
    summary: "Azure service credits for approved nonprofit cloud workloads.",
    eligibility:
      "Eligible verified nonprofits; activate the Azure offer separately and review country availability.",
    uses: "Eligible Azure cloud services under the grant terms.",
    restrictions:
      "Not cash. Subscription, renewal, excluded services and spending beyond credit need review before use.",
    cycle: "Annual grant; confirm enrollment and renewal terms.",
    status: "Program available",
    sources: [
      {
        label: "Microsoft nonprofit product guidance",
        url: "https://learn.microsoft.com/en-us/industry/nonprofit/microsoft-for-nonprofits/nonprofit-offerings-products",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "aws",
    name: "AWS Nonprofit Credit Program",
    kind: "Cloud credit",
    amount: "Tier-dependent; confirm current amount",
    regions: ["United States", "International"],
    topics: ["Technology", "Hosting"],
    summary:
      "Promotional AWS service credits through nonprofit program partners.",
    eligibility:
      "Registered nonprofits must satisfy the applicable partner and country eligibility rules.",
    uses: "Eligible AWS cloud services used for the organization’s mission.",
    restrictions:
      "Official pages describe differing credit amounts. Confirm tier, fees, expiry and exclusions with the provider; excess usage can create charges.",
    cycle: "Check the current partner application and availability.",
    status: "Verify terms",
    sources: [
      {
        label: "Credit program and exclusions",
        url: "https://aws.amazon.com/government-education/nonprofits/nonprofit-credit-program/",
      },
      {
        label: "AWS nonprofit overview",
        url: "https://aws.amazon.com/government-education/nonprofits/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "globalgiving",
    name: "GlobalGiving",
    kind: "Fundraising platform",
    amount: "Donations and conditional matching",
    regions: ["United States", "International", "Haiti"],
    topics: ["Fundraising", "Community"],
    summary:
      "A fundraising platform with access to matching campaigns and corporate giving opportunities.",
    eligibility: "Registered nonprofits worldwide can apply for vetting.",
    uses: "Raise donations for approved charitable projects and participate in eligible campaigns.",
    restrictions:
      "Joining does not guarantee donors or a grant. Check fees, due diligence and campaign-specific conditions.",
    cycle:
      "Join through the nonprofit application; matching campaigns have separate schedules.",
    status: "Platform",
    sources: [
      {
        label: "Join and eligibility",
        url: "https://support.globalgiving.org/hc/en-us/articles/360026161632-How-do-I-know-if-my-organization-is-eligible-for-GlobalGiving",
      },
      {
        label: "Funding not guaranteed",
        url: "https://support.globalgiving.org/hc/en-us/articles/360033367672-How-does-GlobalGiving-work",
      },
      {
        label: "Matching opportunities",
        url: "https://www.globalgiving.org/application/startTemplates/index.hbs",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "grantsgov",
    name: "Grants.gov / Simpler.Grants.gov",
    kind: "Funding directory",
    amount: "Varies by federal opportunity",
    regions: ["United States", "International"],
    topics: ["Federal", "Research", "Community"],
    summary: "Official discovery tools for U.S. federal funding opportunities.",
    eligibility:
      "Applicant types, countries and registrations are set by each individual notice.",
    uses: "Search official notices, review budgets and eligibility, and follow the specified application process.",
    restrictions:
      "A listing is not an eligibility decision. Many awards require SAM.gov/UEI and applicant registration; confirm the notice. Not all notices are open.",
    cycle: "Opportunity-specific deadlines and status.",
    status: "Directory",
    sources: [
      {
        label: "Official search",
        url: "https://www.grants.gov/search-grants",
      },
      {
        label: "Eligibility",
        url: "https://grants.gov/learn-grants/grant-eligibility",
      },
      {
        label: "Developer API",
        url: "https://www.grants.gov/api/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
  {
    id: "candid",
    name: "Candid — Find Nonprofit Funding",
    kind: "Funding directory",
    amount: "Research service; no direct award",
    regions: ["United States", "International"],
    topics: ["Foundations", "Research"],
    summary: "Research foundations by cause, geography and past giving.",
    eligibility:
      "Research access depends on the service plan or available access arrangements; each funder has separate eligibility.",
    uses: "Find prospective funders and investigate their official application requirements.",
    restrictions:
      "Candid is not itself a promise of grant funding. Historical giving does not mean a funder accepts unsolicited applications.",
    cycle: "Search anytime; confirm deadlines on each funder’s website.",
    status: "Directory",
    sources: [
      {
        label: "Funding research",
        url: "https://candid.org/candid-search/find-nonprofit-funding/",
      },
    ],
    checkedOn: "2026-11-02",
    deadline: null,
  },
];

export interface GrantFilters {
  query: string;
  kind: string;
  region: string;
  status: string;
}
export function filterGrantResources(
  resources: GrantResource[],
  filters: GrantFilters,
) {
  const words = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return resources.filter((item) => {
    const text = [
      item.name,
      item.summary,
      item.eligibility,
      item.uses,
      item.restrictions,
      ...item.topics,
      ...item.regions,
    ]
      .join(" ")
      .toLowerCase();
    return (
      words.every((word) => text.includes(word)) &&
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.region || item.regions.includes(filters.region)) &&
      (!filters.status || item.status === filters.status)
    );
  });
}
export function needsSourceReview(item: GrantResource, today = new Date()) {
  const checked = Date.parse(`${item.checkedOn}T00:00:00Z`);
  const age = today.getTime() - checked;
  // A dated deadline is treated conservatively after its calendar day in UTC.
  const elapsed =
    item.deadline !== null &&
    today.getTime() >= Date.parse(`${item.deadline}T00:00:00Z`) + 86_400_000;
  return (
    !Number.isFinite(checked) || age < 0 || age > 30 * 86_400_000 || elapsed
  );
}
