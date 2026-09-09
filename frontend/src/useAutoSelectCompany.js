import { useEffect, useRef } from 'react';

// Skip the company picker when there is only one company to pick.
//
// The five tools that hang off a company (assets, all-assets, procurement, KPI
// tracker, HR analysis) all opened on a chooser. With a single company that
// screen showed one card above roughly 500px of empty background, and cost a
// click on every single visit to reach the thing you came for.
//
// The picker still exists and is still where a company is added — "All
// companies" goes back to it. Once someone has deliberately gone back, this
// leaves them there for the rest of the mount rather than yanking them
// straight back into the only company.
export default function useAutoSelectCompany(companies, selectedId, setSelectedId) {
  const autoSelected = useRef(false);

  useEffect(() => {
    if (autoSelected.current) return;      // already done once on this mount
    if (selectedId != null) return;        // a choice is already in force
    if (!Array.isArray(companies) || companies.length !== 1) return;
    autoSelected.current = true;
    setSelectedId(companies[0].id);
  }, [companies, selectedId, setSelectedId]);
}
