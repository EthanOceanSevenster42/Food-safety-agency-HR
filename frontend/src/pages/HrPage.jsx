import { useState } from 'react';
import ProcurementPage from './ProcurementPage.jsx';
import HrKpiOverviewPage from './HrKpiOverviewPage.jsx';
import HrAnalysisPage from './HrAnalysisPage.jsx';
import { auth } from '../auth.js';
import { canView } from '../roles.js';

const ALL_TABS = [
  { key: 'kpi',      label: 'KPI Tracker', icon: '◇', seg: 'hr_kpi' },
  { key: 'projects', label: 'HR Projects', icon: '⛁', seg: 'hr_projects' },
  { key: 'analysis', label: 'Analysis',    icon: '◈', seg: 'hr_analysis' },
];

export default function HrPage() {
  const user = auth.getUser();
  const TABS = ALL_TABS.filter((t) => canView(user, t.seg));
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem('fsa.hrTab');
    return TABS.some((t) => t.key === saved) ? saved : TABS[0]?.key;
  });

  function changeTab(next) {
    setTab(next);
    try { sessionStorage.setItem('fsa.hrTab', next); } catch {}
  }

  return (
    <>
      <nav className="tab-strip" role="tablist" aria-label="Human Resources sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={'tab-strip-btn' + (tab === t.key ? ' is-active' : '')}
            onClick={() => changeTab(t.key)}
          >
            <span className="tab-strip-icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {tab === 'kpi'      && <HrKpiOverviewPage />}
      {tab === 'projects' && <ProcurementPage department="Human Resources" pageLabel="Human Resources" segment="hr_projects" />}
      {tab === 'analysis' && <HrAnalysisPage />}
    </>
  );
}
