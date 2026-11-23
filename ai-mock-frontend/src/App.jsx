import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import InterviewCreatePage from './pages/InterviewCreatePage';
import InterviewWorkspacePage from './pages/InterviewWorkspacePage';
import ResultsPage from './pages/ResultsPage';
import ResumePage from './pages/ResumePage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/resume" element={<ResumePage />} />
          <Route path="/interview/new" element={<InterviewCreatePage />} />
          <Route path="/interview/:sessionId" element={<InterviewWorkspacePage />} />
          <Route path="/results/:sessionId" element={<ResultsPage />} />
          <Route path="/results" element={<ResultsPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
