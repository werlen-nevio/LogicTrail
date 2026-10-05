import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-layout">
      <h1>{title}</h1>
      {children}
    </main>
  );
}
