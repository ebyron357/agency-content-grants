/**
 * Create page unit tests.
 *
 * Tests form validation, content-type selection, and duplicate-
 * submission prevention. All API calls and navigation are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Create from "../pages/Create";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock wouter navigation
const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["", mockNavigate],
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock API client hooks
vi.mock("@workspace/api-client-react", () => ({
  useListBrands: () => ({
    data: [
      { id: "brand1", name: "Test Brand", industry: "Tech" },
    ],
  }),
}));

// Capture API calls for assertion
const mockApiPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiPost: (...args: any[]) => mockApiPost(...args),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Create page — form validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the creation form correctly", () => {
    render(<Create />);
    expect(screen.getByText("What would you like to write?")).toBeDefined();
    expect(screen.getByPlaceholderText(/how electric vehicles/i)).toBeDefined();
    expect(screen.getByText("Generate Content")).toBeDefined();
  });

  it("shows all 8 content type options", () => {
    render(<Create />);
    expect(screen.getByText("Blog Post")).toBeDefined();
    expect(screen.getByText("Article")).toBeDefined();
    expect(screen.getByText("Guide")).toBeDefined();
    expect(screen.getByText("White Paper")).toBeDefined();
    expect(screen.getByText("Newsletter")).toBeDefined();
    expect(screen.getByText("Ebook")).toBeDefined();
    expect(screen.getByText("Report")).toBeDefined();
    expect(screen.getByText("SOP / Process")).toBeDefined();
  });

  it("Generate button is disabled when topic is empty", () => {
    render(<Create />);
    const btn = screen.getByRole("button", { name: /generate content/i });
    // Topic is empty by default, button should be disabled
    expect(btn).toBeDisabled();
  });

  it("Generate button becomes enabled when topic is filled", async () => {
    const user = userEvent.setup();
    render(<Create />);

    const topicInput = screen.getByPlaceholderText(/how electric vehicles/i);
    await user.type(topicInput, "The future of renewable energy");

    const btn = screen.getByRole("button", { name: /generate content/i });
    // Brand is pre-selected (only one brand), topic is filled → button enabled
    expect(btn).not.toBeDisabled();
  });

  it("selects Blog Post by default", () => {
    render(<Create />);
    const blogCard = screen.getByText("Blog Post").closest("button");
    // Blog Post card should have the active styling class
    expect(blogCard?.className).toContain("border-[#C8102E]");
  });

  it("allows switching content type", async () => {
    const user = userEvent.setup();
    render(<Create />);

    await user.click(screen.getByText("Guide").closest("button")!);

    const guideCard = screen.getByText("Guide").closest("button");
    const blogCard = screen.getByText("Blog Post").closest("button");

    expect(guideCard?.className).toContain("border-[#C8102E]");
    expect(blogCard?.className).not.toContain("border-[#C8102E]");
  });

  it("shows Advanced options section", async () => {
    const user = userEvent.setup();
    render(<Create />);

    await user.click(screen.getByText("Advanced options"));
    expect(screen.getByPlaceholderText(/e.g. Marketing managers/i)).toBeDefined();
  });

  it("does not call apiPost when topic is empty", async () => {
    const user = userEvent.setup();
    render(<Create />);

    const btn = screen.getByRole("button", { name: /generate content/i });
    await user.click(btn);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("shows brand selector when brands are available", () => {
    render(<Create />);
    expect(screen.getByText("Test Brand — Tech")).toBeDefined();
  });
});

describe("Create page — duplicate-submission prevention", () => {
  it("Generate button is disabled while isGenerating (prevents double submit)", async () => {
    const user = userEvent.setup();

    // Make apiPost hang (simulate long in-flight request)
    mockApiPost.mockImplementation(() => new Promise(() => {}));

    render(<Create />);

    const topicInput = screen.getByPlaceholderText(/how electric vehicles/i);
    await user.type(topicInput, "Renewable energy trends 2025");

    const btn = screen.getByRole("button", { name: /generate content/i });
    await user.click(btn);

    // After first click, should show loading state (button disappears, replaced by spinner screen)
    // The Generate button is no longer rendered during loading
    expect(screen.queryByRole("button", { name: /generate content/i })).toBeNull();
  });
});
