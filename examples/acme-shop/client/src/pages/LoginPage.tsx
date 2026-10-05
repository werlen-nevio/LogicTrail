import { useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { LoginForm } from "@/components/LoginForm";

export function LoginPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout title="Sign in to Acme">
      <LoginForm onSuccess={() => navigate("/dashboard")} />
    </AuthLayout>
  );
}
