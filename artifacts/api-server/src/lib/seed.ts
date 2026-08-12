import { db } from "@workspace/db";
import {
  brandsTable,
  projectsTable,
  contentBlueprintsTable,
  sourcesTable,
  claimsTable,
  dependencyRegistryTable,
  modelConfigTable,
  activityLogTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import { ensureAdminUser } from "./adoptData";

export async function seedDatabase() {
  // Check if already seeded
  const existing = await db.select().from(brandsTable).limit(1);
  if (existing.length > 0) {
    return { skipped: true, message: "Database already seeded" };
  }

  // Ensure the shared admin user exists so brands/projects have an owner
  const adminId = await ensureAdminUser();

  // ── Brands ──────────────────────────────────────────────────────────────────
  const brand1Id = randomUUID();
  const brand2Id = randomUUID();
  const brand3Id = randomUUID();

  await db.insert(brandsTable).values([
    {
      id: brand1Id,
      userId: adminId,
      name: "FirstHome Financial",
      description: "A personal finance brand helping first-time homebuyers navigate the mortgage and buying process.",
      industry: "Personal Finance / Real Estate",
      website: "https://example.com/firsthome",
      voiceDescription: "Warm, reassuring, and practical. Speak like a knowledgeable friend, not a bank representative. Use plain language, avoid jargon, and acknowledge that buying a home is stressful.",
      tonePreferences: "Supportive, educational, clear",
      readingLevel: "General adult (8th-10th grade)",
      preferredVocabulary: "home, buyer, mortgage, monthly payment, down payment, closing costs",
      prohibitedVocabulary: "easy, simple, just, obviously, guaranteed returns",
      geographicFocus: "United States",
      complianceNotes: "Do not provide specific financial advice. Always recommend consulting a licensed professional.",
      status: "active",
    },
    {
      id: brand2Id,
      userId: adminId,
      name: "AutoInsight",
      description: "An automotive industry publication covering car prices, market trends, and consumer guidance.",
      industry: "Automotive",
      website: "https://example.com/autoinsight",
      voiceDescription: "Authoritative, data-driven, and objective. Cite specific numbers and market sources. Readers are car enthusiasts and informed consumers who expect accuracy.",
      tonePreferences: "Analytical, precise, informative",
      readingLevel: "Informed adult consumer",
      preferredVocabulary: "MSRP, invoice price, dealer markup, inventory, supply chain, trim level",
      prohibitedVocabulary: "amazing deal, best car ever, must buy",
      geographicFocus: "North America",
      complianceNotes: "All price data must include a date reference. Do not guarantee any specific pricing.",
      status: "active",
    },
    {
      id: brand3Id,
      userId: adminId,
      name: "Curious World Education",
      description: "An educational content brand producing accessible science and nature content for curious adults.",
      industry: "Education / Science Communication",
      website: "https://example.com/curiousworld",
      voiceDescription: "Delightful, specific, and genuinely curious. Write like David Attenborough meets a great science teacher — precise facts delivered with wonder. Avoid condescension.",
      tonePreferences: "Engaging, curious, precise",
      readingLevel: "General adult, science-curious",
      preferredVocabulary: "species, ecosystem, behavior, habitat, research, findings",
      prohibitedVocabulary: "gross, weird, crazy, bizarre",
      geographicFocus: "Global",
      complianceNotes: "All species claims should cite peer-reviewed sources or official conservation databases.",
      status: "active",
    },
  ]);

  // ── Content Blueprints ───────────────────────────────────────────────────────
  const bp1Id = randomUUID();
  const bp2Id = randomUUID();
  const bp3Id = randomUUID();
  const bp4Id = randomUUID();

  await db.insert(contentBlueprintsTable).values([
    {
      id: bp1Id,
      name: "Blog Post",
      contentType: "blog",
      description: "A research-backed blog post optimized for reader value and search intent.",
      isDefault: true,
      structureDefinition: JSON.stringify({
        sections: ["Reader Problem / Search Intent", "Opening Hook", "Key Background", "Evidence and Explanation", "Practical Recommendations", "Frequently Asked Questions", "Conclusion and Next Step", "Meta Title and Description"],
        targetWordCount: 1500,
        citationStyle: "inline",
      }),
    },
    {
      id: bp2Id,
      name: "Educational Manual",
      contentType: "manual",
      description: "A comprehensive step-by-step manual for a complex process or topic.",
      isDefault: true,
      structureDefinition: JSON.stringify({
        sections: ["Purpose and Scope", "Prerequisites", "Chapter Sequence", "Step-by-Step Instructions", "Warnings and Common Mistakes", "Checklists", "Worked Examples", "Glossary", "Resources", "Final Action Plan"],
        targetWordCount: 5000,
        citationStyle: "footnote",
      }),
    },
    {
      id: bp3Id,
      name: "Ebook",
      contentType: "ebook",
      description: "A structured ebook that takes readers from problem-aware to transformation.",
      isDefault: true,
      structureDefinition: JSON.stringify({
        sections: ["Introduction: The Reader's Problem", "Chapter 1: Foundation", "Chapter 2: Core Concepts", "Chapter 3: Application", "Chapter 4: Common Mistakes", "Chapter 5: Advanced Strategies", "Conclusion: Your Next Steps", "Glossary", "References"],
        targetWordCount: 8000,
        citationStyle: "endnote",
      }),
    },
    {
      id: bp4Id,
      name: "Standard Operating Procedure",
      contentType: "sop",
      description: "A formal SOP document for internal business processes.",
      isDefault: true,
      structureDefinition: JSON.stringify({
        sections: ["Objective", "Scope", "Responsible Roles", "Prerequisites and Required Tools", "Procedure", "Decision Points", "Exception Handling", "Quality Checks", "Escalation Process", "Version History"],
        targetWordCount: 2000,
        citationStyle: "none",
      }),
    },
  ]);

  // ── Projects ─────────────────────────────────────────────────────────────────
  const proj1Id = randomUUID();
  const proj2Id = randomUUID();
  const proj3Id = randomUUID();

  await db.insert(projectsTable).values([
    {
      id: proj1Id,
      userId: adminId,
      brandId: brand1Id,
      blueprintId: bp2Id,
      title: "The Complete First-Time Homeownership Manual",
      topic: "Step-by-step guide to buying your first home in the United States",
      contentType: "manual",
      purpose: "Help first-time buyers understand the entire process from saving to closing",
      intendedAudience: "Adults 25-40 considering or planning their first home purchase",
      audienceKnowledgeLevel: "Beginner — unfamiliar with mortgages and the buying process",
      desiredReaderOutcome: "Reader can confidently start the homebuying process and understands each step",
      geographicFocus: "United States",
      targetLength: "5000-7000 words",
      tone: "Warm and supportive",
      readingLevel: "General adult",
      pointOfView: "Second person (you/your)",
      researchFreshness: "Last 2 years",
      citationRequirement: "Required for all statistics and regulation references",
      requiredSections: "Down payment requirements, mortgage types, closing costs, home inspection",
      subjectsToAvoid: "Stock market investing, rental income strategies",
      wordsToAvoid: "easy, simple, just, obviously",
      status: "active",
      workflowStage: "assignment",
    },
    {
      id: proj2Id,
      userId: adminId,
      brandId: brand2Id,
      blueprintId: bp1Id,
      title: "Why Car Prices Are Still High: A 2025 Market Analysis",
      topic: "Current state of new and used car prices, supply chain factors, and consumer guidance",
      contentType: "blog",
      purpose: "Explain the ongoing elevated car prices with current data and give practical buying advice",
      intendedAudience: "Car buyers researching whether now is a good time to buy",
      audienceKnowledgeLevel: "Moderate — familiar with concept of supply and demand but not auto industry specifics",
      desiredReaderOutcome: "Reader understands why prices are high and has a strategy for their purchase",
      geographicFocus: "United States",
      targetLength: "1500-2000 words",
      tone: "Analytical and objective",
      readingLevel: "Informed adult",
      pointOfView: "Third person with direct reader address",
      researchFreshness: "Last 6 months only for pricing data",
      citationRequirement: "Required for all pricing statistics",
      subjectsToAvoid: "EV subsidies debate, autonomous vehicles",
      status: "active",
      workflowStage: "assignment",
    },
    {
      id: proj3Id,
      userId: adminId,
      brandId: brand3Id,
      blueprintId: bp3Id,
      title: "The Remarkable World of Snails: A Complete Guide",
      topic: "Biology, behavior, ecology, and fascinating facts about land and marine snails",
      contentType: "ebook",
      purpose: "Engage curious adults with accurate, delightful content about snail biology and ecology",
      intendedAudience: "Science-curious adults, nature enthusiasts",
      audienceKnowledgeLevel: "General curiosity — no biology background required",
      desiredReaderOutcome: "Reader gains genuine fascination and solid understanding of snail biology",
      geographicFocus: "Global",
      targetLength: "6000-8000 words",
      tone: "Curious and delightful",
      readingLevel: "General adult",
      pointOfView: "Third person, narrative",
      researchFreshness: "Timeless biological facts, recent research where relevant",
      citationRequirement: "Recommended for specific research findings",
      subjectsToAvoid: "Escargot recipes, pest control",
      status: "active",
      workflowStage: "assignment",
    },
  ]);

  // ── Sample Sources ────────────────────────────────────────────────────────────
  await db.insert(sourcesTable).values([
    {
      id: randomUUID(),
      projectId: proj2Id,
      title: "Cox Automotive: Used Vehicle Values Report Q1 2025",
      url: "https://www.coxautoinc.com/market-insights",
      publisher: "Cox Automotive",
      author: "Cox Automotive Research Team",
      publicationDate: "2025-01-15",
      retrievalDate: "2025-07-01",
      sourceType: "industry_report",
      relevantExcerpts: "Used vehicle values remain 28% above pre-pandemic levels despite modest declines from 2022 peaks. New vehicle inventory has recovered to approximately 85% of pre-pandemic levels, with dealer markups declining from an average of $5,400 in 2022 to $1,200 in early 2025.",
      authorityScore: 0.9,
      freshnessScore: 0.95,
      isPrimarySource: true,
      status: "approved",
    },
    {
      id: randomUUID(),
      projectId: proj2Id,
      title: "Bureau of Labor Statistics: Consumer Price Index - New Vehicles",
      url: "https://www.bls.gov/cpi",
      publisher: "U.S. Bureau of Labor Statistics",
      publicationDate: "2025-06-01",
      retrievalDate: "2025-07-01",
      sourceType: "government",
      relevantExcerpts: "The CPI for new vehicles rose 2.3% year-over-year as of May 2025, compared to overall CPI growth of 3.1%. This represents continued normalization from the 14% spike observed in 2021.",
      authorityScore: 1.0,
      freshnessScore: 0.98,
      isPrimarySource: true,
      status: "approved",
    },
  ]);

  // ── Sample Claims ─────────────────────────────────────────────────────────────
  await db.insert(claimsTable).values([
    {
      id: randomUUID(),
      projectId: proj2Id,
      claimText: "Used vehicle values remain approximately 28% above pre-pandemic (2019) levels as of early 2025.",
      claimType: "statistical",
      supportingExcerpt: "Used vehicle values remain 28% above pre-pandemic levels despite modest declines from 2022 peaks.",
      confidence: 0.9,
      timeSensitive: true,
      verificationStatus: "supported",
      conflictStatus: "none",
    },
    {
      id: randomUUID(),
      projectId: proj2Id,
      claimText: "Average dealer markups on new vehicles fell from $5,400 in 2022 to approximately $1,200 in early 2025.",
      claimType: "statistical",
      supportingExcerpt: "dealer markups declining from an average of $5,400 in 2022 to $1,200 in early 2025",
      confidence: 0.88,
      timeSensitive: true,
      verificationStatus: "supported",
      conflictStatus: "none",
    },
  ]);

  // ── Dependency Registry ───────────────────────────────────────────────────────
  const dependencies = [
    { repositorySlug: "pydantic/pydantic-ai", componentName: "PydanticAI", purpose: "Typed AI agents and structured workflows", category: "AI Framework", installStatus: "optional", decisionReason: "Reserved for future Python agent layer if needed" },
    { repositorySlug: "langchain-ai/langgraph", componentName: "LangGraph", purpose: "Stateful workflow graphs with human approval points", category: "AI Framework", installStatus: "optional", decisionReason: "Workflow orchestration option for complex multi-step AI processes" },
    { repositorySlug: "BerriAI/litellm", componentName: "LiteLLM", purpose: "Unified provider interface and model routing", category: "AI Provider", installStatus: "not_installed", decisionReason: "Replaced by direct provider adapters in the Node.js stack for lower overhead" },
    { repositorySlug: "instructor-ai/instructor", componentName: "Instructor", purpose: "Reliable structured model responses via Pydantic", category: "AI Framework", installStatus: "optional", decisionReason: "Useful for Python backend if added; Node.js uses JSON schema prompting" },
    { repositorySlug: "langfuse/langfuse", componentName: "Langfuse", purpose: "AI traces, prompt versioning, cost tracking, observability", category: "Observability", installStatus: "optional", decisionReason: "Add when observability needs exceed built-in generation_runs logging" },
    { repositorySlug: "adbar/trafilatura", componentName: "Trafilatura", purpose: "Extract clean article text from web pages", category: "Web Extraction", installStatus: "not_installed", decisionReason: "Python library; Node.js uses built-in fetch + HTML stripping" },
    { repositorySlug: "microsoft/playwright-python", componentName: "Playwright", purpose: "JavaScript-rendered page retrieval and PDF rendering", category: "Web Extraction", installStatus: "optional", decisionReason: "Available via playwright npm for Node.js; install when JS-rendered sources are needed" },
    { repositorySlug: "scrapy/scrapy", componentName: "Scrapy", purpose: "Controlled multi-page web crawling", category: "Web Extraction", installStatus: "not_installed", decisionReason: "Not needed for MVP single-URL source collection" },
    { repositorySlug: "deedy5/ddgs", componentName: "DuckDuckGo Search", purpose: "Search provider abstraction for research", category: "Search", installStatus: "optional", decisionReason: "Behind SearchProvider interface; installable when AI research automation is built" },
    { repositorySlug: "docling-project/docling", componentName: "Docling", purpose: "Parse PDFs, DOCX, presentations into structured content", category: "Document Ingestion", installStatus: "not_installed", decisionReason: "Python library; integrate when file upload parsing is needed" },
    { repositorySlug: "pymupdf/PyMuPDF", componentName: "PyMuPDF", purpose: "Fast PDF text extraction and metadata", category: "Document Ingestion", installStatus: "not_installed", decisionReason: "Python library; pair with Docling for document upload" },
    { repositorySlug: "python-openxml/python-docx", componentName: "python-docx", purpose: "Read and generate DOCX files", category: "Export", installStatus: "not_installed", decisionReason: "Python library; Node.js export uses HTML-to-DOCX approach" },
    { repositorySlug: "pgvector/pgvector", componentName: "pgvector", purpose: "Vector embeddings in PostgreSQL for semantic retrieval", category: "Retrieval", installStatus: "optional", decisionReason: "Enable when brand knowledge base RAG features are built" },
    { repositorySlug: "UKPLab/sentence-transformers", componentName: "Sentence Transformers", purpose: "Local embedding generation and semantic similarity", category: "Retrieval", installStatus: "not_installed", decisionReason: "Python library; use with pgvector for brand knowledge retrieval" },
    { repositorySlug: "promptfoo/promptfoo", componentName: "Promptfoo", purpose: "Prompt regression tests and model comparisons", category: "Evaluation", installStatus: "optional", decisionReason: "Install when prompt regression testing workflow is established" },
    { repositorySlug: "confident-ai/deepeval", componentName: "DeepEval", purpose: "Custom quality metrics and faithfulness testing", category: "Evaluation", installStatus: "not_installed", decisionReason: "Python evaluation framework; integrate with quality pipeline" },
    { repositorySlug: "Kozea/WeasyPrint", componentName: "WeasyPrint", purpose: "Generate polished PDFs from HTML/CSS", category: "Export", installStatus: "not_installed", decisionReason: "Python library; current PDF export uses print-ready HTML; add WeasyPrint for server-side PDF" },
    { repositorySlug: "microsoft/presidio", componentName: "Presidio", purpose: "Detect PII in uploaded and generated content", category: "Security", installStatus: "optional", decisionReason: "Add as a content screening layer when handling client-provided documents" },
    { repositorySlug: "open-telemetry/opentelemetry-python", componentName: "OpenTelemetry", purpose: "Application traces and workflow timing", category: "Monitoring", installStatus: "not_installed", decisionReason: "Add when distributed tracing is needed across AI pipeline stages" },
    { repositorySlug: "getsentry/sentry-python", componentName: "Sentry", purpose: "Error monitoring and performance diagnostics", category: "Monitoring", installStatus: "optional", decisionReason: "Configure SENTRY_DSN in environment when error tracking is needed" },
    { repositorySlug: "FlagOpen/FlagEmbedding", componentName: "FlagEmbedding (BGE)", purpose: "BGE embeddings and reranking for improved research relevance", category: "Retrieval", installStatus: "not_installed", decisionReason: "Optional after baseline retrieval is measured" },
    { repositorySlug: "explodinggradients/ragas", componentName: "RAGAS", purpose: "Retrieval and RAG evaluation framework", category: "Evaluation", installStatus: "not_installed", decisionReason: "Add after research retrieval has enough real test data" },
    { repositorySlug: "Unstructured-IO/unstructured", componentName: "Unstructured", purpose: "Fallback parser for unsupported file types", category: "Document Ingestion", installStatus: "not_installed", decisionReason: "Optional fallback after Docling; do not use for all files" },
  ];

  await db.insert(dependencyRegistryTable).values(
    dependencies.map((d) => ({
      id: randomUUID(),
      ...d,
      securityReviewStatus: "pending",
    }))
  );

  // ── Model Config singleton ────────────────────────────────────────────────────
  await db.insert(modelConfigTable).values({ id: "singleton" }).onConflictDoNothing();

  // ── Activity Log ─────────────────────────────────────────────────────────────
  await db.insert(activityLogTable).values([
    { id: randomUUID(), type: "brand_created", description: 'Brand "FirstHome Financial" created', projectId: proj1Id, projectTitle: "The Complete First-Time Homeownership Manual", brandName: "FirstHome Financial" },
    { id: randomUUID(), type: "brand_created", description: 'Brand "AutoInsight" created', projectId: proj2Id, projectTitle: "Why Car Prices Are Still High", brandName: "AutoInsight" },
    { id: randomUUID(), type: "project_created", description: 'Project "Why Car Prices Are Still High" created', projectId: proj2Id, projectTitle: "Why Car Prices Are Still High", brandName: "AutoInsight" },
    { id: randomUUID(), type: "source_approved", description: 'Source approved: Cox Automotive Q1 2025 Report', projectId: proj2Id, projectTitle: "Why Car Prices Are Still High", brandName: "AutoInsight" },
  ]);

  return { seeded: true, brands: 3, projects: 3, blueprints: 4, dependencies: dependencies.length };
}
