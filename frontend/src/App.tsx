import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthError } from './pages/AuthError';
import { SetupWizard } from './pages/SetupWizard/SetupWizard';

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route path="/auth/error" element={<AuthError />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}
