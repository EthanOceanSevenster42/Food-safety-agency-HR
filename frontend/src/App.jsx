import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import SetPasswordPage from './pages/SetPasswordPage.jsx';
import AssetControlPage from './pages/AssetControlPage.jsx';
import ProcurementPage from './pages/ProcurementPage.jsx';
import HrPage from './pages/HrPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import MyReviewsPage from './pages/MyReviewsPage.jsx';
import KpiSelfAssessmentPage from './pages/KpiSelfAssessmentPage.jsx';
import TeamReviewsPage from './pages/TeamReviewsPage.jsx';
import ManagerReviewPage from './pages/ManagerReviewPage.jsx';
import ReviewSessionPage from './pages/ReviewSessionPage.jsx';
import OrganogramPage from './pages/OrganogramPage.jsx';
import NoAccessPage from './pages/NoAccessPage.jsx';

// FSA HR — the People & management hub
import ReportPage from './fsa/ReportPage.jsx';
import PerformancePage from './fsa/PerformancePage.jsx';
import HrHomePage from './fsa/HrHomePage.jsx';
import DashboardPage from './fsa/DashboardPage.jsx';
import DirectoryPage from './fsa/DirectoryPage.jsx';
import CompetencePage from './fsa/CompetencePage.jsx';
import RequisitionsPage from './fsa/RequisitionsPage.jsx';
import RecruitmentPage from './fsa/RecruitmentPage.jsx';
import RedToGreenPage from './fsa/RedToGreenPage.jsx';
import ProgrammePage from './fsa/ProgrammePage.jsx';
import TemplatesPage from './fsa/TemplatesPage.jsx';
import LeavePage from './fsa/LeavePage.jsx';
import DocumentsPage from './fsa/DocumentsPage.jsx';

import ApsShell from './components/ApsShell.jsx';
import { auth } from './auth.js';
import { canAccessPath, homeFor } from './roles.js';

function RequireAuth({ children }) {
  const location = useLocation();
  // Remember where they were headed so login can bounce them back (e.g. a
  // review link opened before signing in).
  return auth.isAuthenticated()
    ? children
    : <Navigate to="/login" replace state={{ from: location }} />;
}

// Keep each role on pages it can actually use (the backend still enforces
// access; this just avoids dead-ends / 403 screens). Denied paths bounce to the
// role's home. Re-runs on every navigation via useLocation.
function RequireRole({ children }) {
  const location = useLocation();
  const user = auth.getUser();
  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to={homeFor(user)} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <RequireRole>
              <ApsShell />
            </RequireRole>
          </RequireAuth>
        }
      >
        {/* --- People & management hub ---------------------------------- */}
        <Route path="/hr-home" element={<HrHomePage />} />
        <Route path="/management-dashboard" element={<DashboardPage />} />
        <Route path="/monthly-report" element={<ReportPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/performance/:staffNo" element={<PerformancePage />} />
        <Route path="/directory" element={<DirectoryPage />} />
        <Route path="/competence" element={<CompetencePage />} />
        <Route path="/requisitions" element={<RequisitionsPage />} />
        <Route path="/recruitment" element={<RecruitmentPage />} />
        <Route path="/red-to-green" element={<RedToGreenPage />} />
        <Route path="/red-to-green/:code" element={<ProgrammePage />} />
        <Route path="/department-templates" element={<TemplatesPage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/documents" element={<DocumentsPage />} />

        {/* --- inherited asset / procurement / KPI tools ---------------- */}
        <Route path="/" element={<AssetControlPage />} />
        {/* Old direct routes — redirect to the unified Asset Control page */}
        <Route path="/allocated" element={<Navigate to="/" replace />} />
        <Route path="/all-assets" element={<Navigate to="/" replace />} />
        <Route path="/repairs" element={<Navigate to="/" replace />} />
        <Route path="/procurement" element={<ProcurementPage department="Procurement"   pageLabel="Procurement Process" segment="procurement" />} />
        <Route path="/hr"          element={<HrPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/my-reviews" element={<MyReviewsPage />} />
        <Route path="/kpi-review/:id" element={<KpiSelfAssessmentPage />} />
        <Route path="/team-reviews" element={<TeamReviewsPage />} />
        <Route path="/team-review/:id" element={<ManagerReviewPage />} />
        <Route path="/review-session/:id" element={<ReviewSessionPage />} />
        <Route path="/organogram" element={<OrganogramPage />} />
        <Route path="/no-access" element={<NoAccessPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/hr-home" replace />} />
    </Routes>
  );
}
