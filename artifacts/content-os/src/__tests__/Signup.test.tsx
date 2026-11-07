import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Landing, { SIGNUP_EMAIL_KEY } from "@/pages/Landing";
import Signup from "@/pages/Signup";
import Login from "@/pages/Login";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("landing page", () => {
  it("states the offer, labels the product preview as an example and shows the Grants.gov notice", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1, name: /Every grant you qualify for/ })).toBeTruthy();
    expect(screen.getByRole("figure", { name: /Example of the GrantCrest matches screen/ })).toBeTruthy();
    expect(screen.getByTestId("grants-gov-notice").textContent).toMatch(/not endorsed or certified/);
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toMatch(/\/login$/);
  });

  it("carries a typed email to sign-up in session storage, never in the address", () => {
    const navigate = vi.fn();
    render(<Landing navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ada@riverside.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Get my matches" }));
    expect(sessionStorage.getItem(SIGNUP_EMAIL_KEY)).toBe("ada@riverside.org");
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/\/signup$/));
  });
});

describe("sign-up form", () => {
  function fillForm(overrides: Partial<Record<"name" | "org" | "email" | "password", string>> = {}) {
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: overrides.name ?? "Ada Founder" } });
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: overrides.org ?? "Riverside Literacy" } });
    if (overrides.email !== undefined || !(screen.getByLabelText("Work email") as HTMLInputElement).value) {
      fireEvent.change(screen.getByLabelText("Work email"), { target: { value: overrides.email ?? "ada@riverside.org" } });
    }
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: overrides.password ?? "Correct horse battery 42" } });
  }

  it("prefills the email from the landing page, sends the details, and asks the person to confirm their email", async () => {
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, "ada@riverside.org");
    const message = "If this email can be used, we sent a link to it. Open it within 24 hours to finish creating your workspace.";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "check_email", message }), { status: 202 }));
    render(<Signup />);
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe("ada@riverside.org");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("ada@riverside.org");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/signup$/);
    // The one sign-up endpoint (routes/signup.ts): organizationName, plus the empty bot trap.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Ada Founder",
      organizationName: "Riverside Literacy",
      email: "ada@riverside.org",
      password: "Correct horse battery 42",
      website: "",
    });
    expect(sessionStorage.getItem(SIGNUP_EMAIL_KEY)).toBeNull();
    // Nothing else is called: no sign-in happens until the emailed link is opened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's plain-language reason when sign-up is refused", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Use at least 12 characters." }), { status: 400 }));
    render(<Signup />);
    fillForm({ password: "short" });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/12 characters/);
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
  });

  it("says plainly when sign-up is not open", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Sign-up is not available." }), { status: 404 }));
    render(<Signup />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not open yet/);
  });

  it("keeps the button off until every field is filled, and links to sign-in", () => {
    render(<Signup />);
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(true);
    fillForm();
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toMatch(/\/login$/);
  });
});

describe("sign-in screen", () => {
  it("offers sign-up only while it is open", () => {
    const { unmount } = render(<Login onSuccess={() => {}} />);
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    unmount();
    render(<Login onSuccess={() => {}} signupOpen />);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toMatch(/\/signup$/);
  });
});
