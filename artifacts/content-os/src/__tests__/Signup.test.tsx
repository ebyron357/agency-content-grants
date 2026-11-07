import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Landing, { SIGNUP_EMAIL_KEY } from "@/pages/Landing";
import Signup from "@/pages/Signup";

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
  it("prefills the email from the landing page and signs in after the server creates the account", async () => {
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, "ada@riverside.org");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ authenticated: true, role: "owner" }), { status: 201 }));
    const onSuccess = vi.fn();
    render(<Signup onSuccess={onSuccess} />);
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe("ada@riverside.org");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Founder" } });
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Riverside Literacy" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Correct horse battery 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/signup$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Ada Founder",
      organization: "Riverside Literacy",
      email: "ada@riverside.org",
      password: "Correct horse battery 42",
    });
    expect(sessionStorage.getItem(SIGNUP_EMAIL_KEY)).toBeNull();
  });

  it("shows the server's plain-language reason when sign-up is refused", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "An account with this email already exists. Sign in instead." }), { status: 409 }));
    const onSuccess = vi.fn();
    render(<Signup onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Riverside" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ada@riverside.org" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Correct horse battery 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
