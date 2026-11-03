import {
  fireEvent,
  render,
  screen,
  within,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Grants from "@/pages/Grants";
import { grantResources, needsSourceReview } from "@/data/grants";

afterEach(cleanup);

describe("grant discovery", () => {
  it("combines funding and geography filters without claiming applicant eligibility", () => {
    render(<Grants />);
    fireEvent.change(screen.getByLabelText("Funding types"), {
      target: { value: "Cash grant" },
    });
    fireEvent.change(screen.getByLabelText("Locations"), {
      target: { value: "Haiti" },
    });
    expect(
      screen.getByRole("heading", {
        name: "Peace Development Fund — Community Organizing",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Google Ad Grants" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Walmart Spark Good Local Grants",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/they do not confirm that you qualify/),
    ).toBeInTheDocument();
  });
  it("searches mission and expenses, and recovers from empty results", () => {
    render(<Grants />);
    fireEvent.change(screen.getByLabelText("Search grants"), {
      target: { value: "literacy books" },
    });
    expect(
      screen.getByRole("heading", { name: "Dollar General — Youth Literacy" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search grants"), {
      target: { value: "no-such-grant-xyz" },
    });
    expect(screen.getByText("No matching resources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all resources" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      `${grantResources.length} of ${grantResources.length} resources`,
    );
  });
  it("distinguishes advertising credit from cash and retains official sources", () => {
    render(<Grants />);
    fireEvent.change(screen.getByLabelText("Search grants"), {
      target: { value: "Google Ad Grants" },
    });
    const card = screen.getByRole("article");
    expect(within(card).getByText("Advertising credit")).toBeInTheDocument();
    expect(
      within(card).getByText(/Not cash; cannot pay salaries/),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /Program terms and value/ }),
    ).toHaveAttribute("href", "https://www.google.com/grants/faq/");
  });
  it("makes unavailable programs discoverable as unavailable", () => {
    render(<Grants />);
    fireEvent.change(screen.getByLabelText("Statuses"), {
      target: { value: "Paused" },
    });
    expect(
      screen.getByRole("heading", { name: "Inter-American Foundation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reports proposal review and grant funding paused/),
    ).toBeInTheDocument();
  });
});

describe("source freshness", () => {
  const example = {
    ...grantResources[0],
    checkedOn: "2026-11-02",
    deadline: "2026-11-15",
  };
  it("marks old checks and elapsed deadlines for review", () => {
    expect(needsSourceReview(example, new Date("2026-11-03T12:00:00Z"))).toBe(
      false,
    );
    expect(needsSourceReview(example, new Date("2026-11-16T12:00:00Z"))).toBe(
      true,
    );
    expect(
      needsSourceReview(
        { ...example, deadline: null },
        new Date("2026-12-03T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      needsSourceReview({ ...example, checkedOn: "invalid" }, new Date()),
    ).toBe(true);
  });
  it("requires source provenance for every resource", () => {
    expect(new Set(grantResources.map((item) => item.id)).size).toBe(
      grantResources.length,
    );
    for (const item of grantResources) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(
        item.sources.every(
          (source) => new URL(source.url).protocol === "https:",
        ),
      ).toBe(true);
      expect(item.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
