// Order a group of sibling org-chart nodes so that any two whose subtrees are
// linked by an "also reports to" (additional-manager) relationship sit NEXT to
// each other. That keeps the dashed extra-manager connector lines short and
// stops them stretching underneath unrelated cards.
//
// Nodes not involved in any such link keep plain alphabetical order; linked
// nodes are grouped into a contiguous cluster placed at the cluster's
// alphabetically-first member.
//
//   `sibs`  — array of tree nodes (each { id, name, children, additionalManagerIds })
//   `byId`  — Map of employeeId -> node (used to read additionalManagerIds)
export function orderSiblings(sibs, byId) {
  if (!sibs || sibs.length < 2) return sibs;

  // The set of employee ids contained in each sibling's subtree.
  const subtreeOf = new Map();
  const collect = (n, set) => { set.add(n.id); (n.children || []).forEach((c) => collect(c, set)); };
  sibs.forEach((s) => { const set = new Set(); collect(s, set); subtreeOf.set(s.id, set); });
  const sibIndexOfEmp = (empId) => sibs.findIndex((s) => subtreeOf.get(s.id).has(empId));

  // Union-find: link two siblings whenever an "also reports to" edge crosses
  // between their subtrees.
  const parent = sibs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  sibs.forEach((s, si) => {
    for (const empId of subtreeOf.get(s.id)) {
      const addl = byId.get(empId)?.additionalManagerIds || [];
      for (const mid of addl) {
        const mi = sibIndexOfEmp(mid);
        if (mi >= 0 && mi !== si) union(si, mi);
      }
    }
  });

  // Group into clusters, alphabetise inside each, then order clusters by their
  // first member's name.
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const clusters = new Map();
  sibs.forEach((s, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(s);
  });
  const clusterList = [...clusters.values()].map((members) => { members.sort(byName); return members; });
  clusterList.sort((a, b) => byName(a[0], b[0]));
  return clusterList.flat();
}
