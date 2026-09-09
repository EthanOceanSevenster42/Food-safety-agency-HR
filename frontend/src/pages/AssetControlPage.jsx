import { useState } from 'react';
import AnalyticsPage from './AnalyticsPage.jsx';
import AssetsOverviewPage from './AssetsOverviewPage.jsx';
import AllAssetOverviewPage from './AllAssetOverviewPage.jsx';
import RepairsPage from './RepairsPage.jsx';
import { auth } from '../auth.js';
import { canView } from '../roles.js';

const ALL_TABS = [
  { key: 'analytics',  label: 'Analytics',        icon: '▤', seg: 'asset_analytics' },
  { key: 'allocated',  label: 'Allocated Assets', icon: '◇', seg: 'asset_allocated' },
  { key: 'all-assets', label: 'All Assets',       icon: '◆', seg: 'asset_all' },
  { key: 'repairs',    label: 'Repairs',          icon: '⚒', seg: 'asset_repairs' },
];

export default function AssetControlPage() {
  const user = auth.getUser();
  const TABS = ALL_TABS.filter((t) => canView(user, t.seg));
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem('fsa.assetControlTab');
    return TABS.some((t) => t.key === saved) ? saved : TABS[0]?.key;
  });

  function changeTab(next) {
    setTab(next);
    try { sessionStorage.setItem('fsa.assetControlTab', next); } catch {}
  }

  return (
    <>
      <nav className="tab-strip" role="tablist" aria-label="Asset Control sections">
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

      {tab === 'analytics'  && <AnalyticsPage />}
      {tab === 'allocated'  && <AssetsOverviewPage />}
      {tab === 'all-assets' && <AllAssetOverviewPage />}
      {tab === 'repairs'    && <RepairsPage />}
    </>
  );
}
