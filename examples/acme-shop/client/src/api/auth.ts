export interface SignedInUser {
  id: string;
  email: string;
}

/** Sends the credentials to the API; the server answers with a session cookie. */
export async function login(email: string, password: string): Promise<SignedInUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid email or password");
  }
  const body = await response.json();
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}
