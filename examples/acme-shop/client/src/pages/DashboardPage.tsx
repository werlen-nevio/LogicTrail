import { useEffect, useState } from "react";
import { logout } from "@/api/auth";

export function DashboardPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => response.json())
      .then((body) => setEmail(body.user.email));
  }, []);

  return (
    <section>
      <p>Signed in as {email}</p>
      <button onClick={() => logout()}>Sign out</button>
    </section>
  );
}
