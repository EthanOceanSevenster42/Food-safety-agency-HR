// Content for the FSA HR module, taken from the FSA HR Portal design canvas.
// Kept as data (not inline in the seed script) so it can be reviewed and
// edited without touching the loading logic.

// The group method every department inherits. [week, activity, owner]
export const MASTER = {
  0: [
    ['Contract issued and signed', 'Admin'],
    ['Policy and procedure pack issued', 'Admin'],
    ['Vehicle allowance confirmed', 'Admin'],
    ['Equipment declaration signed', 'Admin'],
    ['Bound legislation pack issued', 'Admin'],
    ['Red to Green programme issued', 'Admin'],
    ['Authorisation card initiated', 'Marketing'],
    ['Laptop, email and drive access allocated', 'Marketing'],
    ['Contract, vehicle allowance and provident fund explained', 'HR'],
    ['Added to payroll and personnel file created', 'Finance'],
    ['Office tour and introductions to the team', 'Manager'],
    ['Vehicle tracker installation arranged', 'Marketing'],
  ].map((x) => [1, ...x]),
  1: [
    [1, 'Introduction to the legislation and the mandate', 'Manager'],
    [1, 'Information pack issued and worked through', 'Manager'],
    [1, 'Responsibilities, targets and reporting lines', 'Manager'],
    [1, 'Common violations reviewed', 'Manager'],
    [1, 'Documentation and reporting requirements', 'Manager'],
    [2, 'Accompanied practical inspections', 'Green mentor'],
    [3, 'Supervised independent work applying weeks 1 and 2', 'Green mentor'],
    [4, 'Written phase test — minimum 60%', 'Manager'],
    [4, 'Performance review — improvement areas and goals', 'Manager'],
  ],
  2: [
    [1, 'Introduction to the approval process', 'Manager'],
    [1, 'Effect of incomplete or incorrect records', 'Manager'],
    [2, 'Monitored work across all mandated commodities', 'Manager'],
    [2, 'Feedback and guidance session', 'Manager'],
    [3, 'Participation in the approval process', 'Assistant manager'],
    [3, 'Follow-up actions and enforcement reviewed', 'Manager'],
    [4, 'Independent practice — reports submitted for review', 'Manager'],
    [4, 'Phase 2 signed off', 'Manager'],
  ],
  3: [
    [1, 'Volume targets met in full', 'Inspector'],
    [3, 'Supervised approval of own work', 'Green mentor'],
    [3, 'Case study review — five facilities contacted', 'Manager'],
    [4, 'Final written test — minimum 80%', 'Manager'],
    [4, 'Performance review', 'Manager'],
    [5, 'Additional training on weak areas, if required', 'Manager'],
    [5, 'Competence decision recorded', 'Manager'],
    [5, 'Green inspector signs off all phases; certificate issued', 'Green mentor'],
  ],
};

// What each department adds on top of the group method.
export const EXTRAS = {
  APS: {
    0: [['Haugh meter and scale issued', 'Manager', 1], ['E-Click access created', 'Manager', 1]],
    1: [
      ['Sampling procedure — PMP, RAW, eggs and poultry', 'Green mentor', 2],
      ['Marking and container requirements per commodity', 'Manager', 2],
    ],
    2: [['E-Click monitoring inspections — poultry, eggs, RAW, PMP', 'Manager', 2]],
    3: [['Compositional checklists completed at the source', 'Inspector', 1]],
  },
  'IMI & Classification': {
    0: [['Knives, scabbard and PPE issued', 'Manager', 1]],
    1: [['Ante- and post-mortem inspection with a registered inspector', 'Green mentor', 2]],
    2: [['Marking, detention and condemnation records', 'Manager', 2]],
    3: [['Classification accuracy check against a second classifier', 'Green mentor', 1]],
  },
  Lab: {
    0: [['LIMS access and laboratory induction', 'Manager', 1]],
    1: [['Chain of custody and sample receipt', 'Green mentor', 2]],
    2: [['Method observation on the microbiology bench', 'Manager', 2]],
    3: [['Analyst competence panel', 'Manager', 1]],
  },
  Auditing: {
    0: [['Audit tablet and standards library issued', 'Manager', 1]],
    1: [['Audit checklist and evidence capture', 'Green mentor', 2]],
    2: [['Shadow audit against a retailer standard', 'Manager', 2]],
    3: [['Lead an audit under observation', 'Green mentor', 1]],
  },
  'Vet Services': {
    0: [['SAVC registration verified', 'HR', 1]],
    1: [['Veterinary oversight rounds', 'Green mentor', 2]],
    2: [['Technical review of two reports', 'Manager', 2]],
    3: [['Independent technical opinion issued', 'Manager', 1]],
  },
  Training: {
    0: [['Academy facilitator pack issued', 'Manager', 1]],
    1: [['Facilitation observed by a senior facilitator', 'Green mentor', 2]],
    2: [['Course pack and assessment marking reviewed', 'Manager', 2]],
    3: [['Deliver a full module under observation', 'Green mentor', 1]],
  },
  'Egg Production Verification': {
    0: [['Grading scale and candling lamp issued', 'Manager', 1]],
    1: [['Grading, weighing and freshness verification', 'Green mentor', 2]],
    2: [['Packhouse records and labelling review', 'Manager', 2]],
    3: [['Verification set at four packhouses', 'Inspector', 1]],
  },
};

// Phase 3 volume targets — set per department.
export const TARGETS = {
  APS: [
    ['New or existing egg packhouses', '10'],
    ['Butcheries, producers, manufacturers and retailers', '25'],
    ['Poultry abattoirs', '05'],
    ['Cold stores, where available', '05'],
    ['RAW samples collected', '25'],
    ['PMP samples collected', '15'],
  ],
  'IMI & Classification': [
    ['Slaughter days inspected', '20'],
    ['Carcasses classified under supervision', '400'],
    ['Detention and condemnation records completed', '15'],
  ],
  Lab: [
    ['Samples processed under supervision', '60'],
    ['Methods signed off', '06'],
    ['Chain-of-custody files reviewed', '20'],
  ],
  Auditing: [
    ['Audits observed', '06'],
    ['Audits led under observation', '03'],
    ['Findings written to standard', '20'],
  ],
  'Vet Services': [
    ['Site oversight visits', '12'],
    ['Technical reviews issued', '08'],
  ],
  Training: [
    ['Modules delivered under observation', '04'],
    ['Assessments marked and moderated', '30'],
  ],
  'Egg Production Verification': [
    ['Packhouse verifications', '12'],
    ['Grading checks', '40'],
  ],
};

// Directory & site placements
export const STAFF = [
  ['FSA-0142', 'T. Mokoena', 'Meat inspector', 'IMI', 'Cato Ridge abattoir', 'Valid to 2027-04-30', 'ok', 'Permanent'],
  ['FSA-0088', 'A. Pretorius', 'Senior classifier', 'IMI', 'Bethlehem abattoir', 'Expires 2026-10-14', 'warn', 'Permanent'],
  ['FSA-0203', 'N. Dlamini', 'Laboratory technologist', 'Lab', 'Lynnwood laboratory', 'Valid to 2028-02-28', 'ok', 'Permanent'],
  ['FSA-0117', 'J. van Wyk', 'Product inspector', 'APS', 'Ceres packhouse', 'Valid to 2027-01-31', 'ok', 'Fixed term'],
  ['FSA-0164', 'S. Naidoo', 'Lead auditor', 'Auditing', 'Regional — Gauteng', 'Valid to 2027-09-30', 'ok', 'Permanent'],
  ['FSA-0221', 'M. Sithole', 'Meat inspector', 'IMI', 'Rustenburg abattoir', 'Expired 2026-08-31', 'bad', 'Permanent'],
  ['FSA-0031', 'Dr L. Botha', 'Veterinarian', 'Vet', 'Regional — Free State', 'Valid to 2029-03-31', 'ok', 'Permanent'],
  ['FSA-0189', 'K. Mahlangu', 'Training facilitator', 'Training', 'FSA Academy, Pretoria', 'Not applicable', 'na', 'Permanent'],
  ['FSA-0176', 'P. September', 'Egg grading verifier', 'APS', 'Paarl grading station', 'Valid to 2027-06-30', 'ok', 'Fixed term'],
];

// Competence matrix: name, site, then [text, kind] for DALRRD, ante/post-mortem,
// classification, HACCP, medical surveillance.
export const COMPETENCE = [
  ['T. Mokoena', 'Cato Ridge abattoir', ['2027-04-30', 'ok'], ['Valid', 'ok'], ['Not required', 'na'], ['Valid', 'ok'], ['Overdue', 'bad']],
  ['A. Pretorius', 'Bethlehem abattoir', ['2026-10-14', 'warn'], ['Valid', 'ok'], ['2026-10-14', 'warn'], ['Valid', 'ok'], ['Valid', 'ok']],
  ['M. Sithole', 'Rustenburg abattoir', ['Expired', 'bad'], ['Valid', 'ok'], ['Not required', 'na'], ['Valid', 'ok'], ['Valid', 'ok']],
  ['N. Dlamini', 'Lynnwood laboratory', ['2028-02-28', 'ok'], ['Not required', 'na'], ['Not required', 'na'], ['Valid', 'ok'], ['Valid', 'ok']],
  ['J. van Wyk', 'Ceres packhouse', ['2027-01-31', 'ok'], ['Not required', 'na'], ['Not required', 'na'], ['2026-11-02', 'warn'], ['Valid', 'ok']],
  ['S. Naidoo', 'Regional — Gauteng', ['2027-09-30', 'ok'], ['Not required', 'na'], ['Not required', 'na'], ['Valid', 'ok'], ['Valid', 'ok']],
  ['Dr L. Botha', 'Regional — Free State', ['2029-03-31', 'ok'], ['Valid', 'ok'], ['Valid', 'ok'], ['Valid', 'ok'], ['Valid', 'ok']],
];

// Role requisitions
export const REQUISITIONS = [
  ['REQ-0146', 'Meat inspector', 'IMI & Classification', 'Rustenburg abattoir', 'Permanent', '2', 'T. Streicher', '2026-11-01', 'Ends reliance on relief cover', 2, [true, true, false]],
  ['REQ-0145', 'Laboratory assistant', 'Lab', 'Lynnwood laboratory', 'Permanent', '1', 'N. Dlamini', '2026-10-15', 'Replacement — resignation', 3, [true, true, true]],
  ['REQ-0144', 'Training facilitator', 'Training', 'FSA Academy, Pretoria', 'Permanent', '1', 'K. Mahlangu', '2026-10-01', 'New post — growth', 4, [true, true, true]],
  ['REQ-0143', 'Product inspector', 'APS', 'Ceres packhouse', 'Fixed term', '1', 'J. van Wyk', '2026-10-01', 'Replacement — end of contract', 1, [false, false, false]],
];

// Recruitment pipeline: ref, role, site, tag, tagKind, stage
export const CANDIDATES = [
  ['REQ-0142', 'Meat inspector', 'Rustenburg abattoir', '8 applicants', 'n', 0],
  ['REQ-0139', 'Laboratory assistant', 'Lynnwood laboratory', '11 applicants', 'n', 0],
  ['REQ-0137', 'Meat inspector', 'Bethlehem abattoir', 'Registration check', 'w', 1],
  ['REQ-0135', 'Product inspector', 'Ceres packhouse', '3 shortlisted', 'n', 1],
  ['REQ-0128', 'Senior classifier', 'Cato Ridge abattoir', 'Panel 11 Sept', 't', 2],
  ['REQ-0121', 'Veterinary technician', 'Regional — Free State', 'Offer sent', 't', 3],
  ['REQ-0119', 'Training facilitator', 'FSA Academy', 'Awaiting reply', 'w', 3],
  ['REQ-0114', 'Meat inspector', 'Paarl grading station', 'Starts 9 Sept', 'g', 4],
  ['REQ-0108', 'Lead auditor', 'Regional — Gauteng', 'Induction booked', 'g', 4],
];

// Red to Green cohort
export const PROGRAMMES = [
  ['k1', 'L. Khumalo', 'Product inspector', 'APS', 'Nelspruit region', '2026-07-01', 'J. van Wyk', 1, 'Day 22 of 30', [74, 0, 0], 'Behind', 'bad', 'Phase test — 60%'],
  ['k2', 'B. Adams', 'Product inspector', 'APS', 'Cape Winelands', '2026-07-01', 'P. September', 1, 'Day 22 of 30', [68, 0, 0], 'At risk', 'bad', 'Phase test — 60%'],
  ['k3', 'S. Mthembu', 'Meat inspector', 'IMI & Classification', 'Cato Ridge abattoir', '2026-06-01', 'T. Mokoena', 2, 'Day 18 of 30', [100, 62, 0], 'On track', 'ok', 'Phase 2 sign-off'],
  ['k4', 'R. Pillay', 'Laboratory technologist', 'Lab', 'Lynnwood laboratory', '2026-06-01', 'N. Dlamini', 2, 'Day 24 of 30', [100, 80, 0], 'On track', 'ok', 'Phase 2 sign-off'],
  ['k5', 'C. Wessels', 'Auditor', 'Auditing', 'Regional — Gauteng', '2026-05-04', 'S. Naidoo', 3, 'Day 26 of 30', [100, 100, 84], 'Awaiting sign-off', 'info', 'Final test — 80%'],
  ['k6', 'T. Mabaso', 'Egg grading verifier', 'Egg Production Verification', 'Paarl grading station', '2026-08-03', 'P. September', 1, 'Day 8 of 30', [28, 0, 0], 'On track', 'ok', 'Practical week'],
  ['k7', 'A. Jacobs', 'Veterinary technician', 'Vet Services', 'Regional — Free State', '2026-06-15', 'Dr L. Botha', 2, 'Day 12 of 30', [100, 38, 0], 'On track', 'ok', 'Approval participation'],
];

// Manager notes, seeded against L. Khumalo (the programme that is behind).
export const PROGRAMME_NOTES = {
  k1: [
    ['2026-09-04', 'T. Streicher', 'Accompanied inspections at two butcheries. Labelling verification is sound; sample integrity and cooler-box handling need a second practical session.'],
    ['2026-08-27', 'J. van Wyk', 'Route planning improved — four facilities per day met on three of five days. Continue with the weekly schedule on the group every Friday.'],
    ['2026-08-14', 'H. Nel', 'Information pack and bound legislation pack signed for. Vehicle tracker installed.'],
  ],
};

// Leave & site coverage.
// Typed fields are the source of truth — the screen's display strings
// ("2026-09-14 → 2026-09-25", "6.5 days") are derived from them at seed time
// so they cannot drift. coverageKind is the severity if the request is
// approved: ok | warn | bad.
export const LEAVE = [
  {
    staffNo: 'FSA-0221', name: 'M. Sithole', role: 'Meat inspector', service: 'IMI',
    site: 'Rustenburg abattoir', type: 'Annual leave',
    start: '2026-09-14', end: '2026-09-25', days: 10, balanceDays: 6.5,
    coverageKind: 'bad',
    impact: 'Rustenburg drops to one inspector for two slaughter days. Relief cover from Brits is 84 km each way.',
  },
  {
    staffNo: 'FSA-0203', name: 'N. Dlamini', role: 'Laboratory technologist', service: 'Lab',
    site: 'Lynnwood laboratory', type: 'Family responsibility',
    start: '2026-09-10', end: '2026-09-11', days: 2, balanceDays: 1,
    coverageKind: 'ok',
    impact: 'No effect on turnaround — two technologists remain on the microbiology bench.',
  },
  {
    staffNo: 'FSA-0088', name: 'A. Pretorius', role: 'Senior classifier', service: 'IMI',
    site: 'Bethlehem abattoir', type: 'Study leave — Academy',
    start: '2026-09-28', end: '2026-09-30', days: 3, balanceDays: 3,
    coverageKind: 'warn',
    impact: 'Classification re-certification. Approving this also closes the registration expiry flagged on 14 October.',
  },
];

// The leave types the queue filters by.
export const LEAVE_TYPES = [
  'Annual leave',
  'Sick leave',
  'Family responsibility',
  'Study leave — Academy',
  'Unpaid leave',
];

export const COVERAGE = [
  ['Cato Ridge abattoir', 100, 'Covered', 'ok', '4 of 4 inspectors on shift'],
  ['Bethlehem abattoir', 100, 'Covered', 'ok', '3 of 3 inspectors · 1 classifier'],
  ['Rustenburg abattoir', 50, 'At risk', 'bad', '1 of 2 inspectors · relief from Brits'],
  ['Ceres packhouse', 100, 'Covered', 'ok', '2 of 2 product inspectors'],
  ['Paarl grading station', 75, 'Watch', 'warn', '3 of 4 verifiers · peak volume week'],
  ['Lynnwood laboratory', 100, 'Covered', 'ok', '6 of 6 technologists'],
];

// Document depository
export const LIBRARIES = [
  'Policies',
  'Procedures',
  'Contracts & templates',
  'Employee pack',
  'Training records',
  'Personnel files',
];

export const DOCUMENTS = [
  ['Conditions of employment — permanent staff', 'HR-POL-001', 'Policy', 'v4.2', 'H. Nel', '2027-03-31', 'Current', 'ok', 'Policies'],
  ['Inspector placement and relief procedure', 'HR-SOP-014', 'Procedure', 'v2.1', 'T. Streicher', '2026-11-30', 'Current', 'ok', 'Procedures'],
  ['Disciplinary code and procedure', 'HR-POL-007', 'Policy', 'v3.0', 'H. Nel', '2026-09-30', 'Review due', 'warn', 'Policies'],
  ['Occupational health and medical surveillance', 'HR-POL-011', 'Policy', 'v1.4', 'Dr L. Botha', '2026-08-31', 'Overdue', 'bad', 'Policies'],
  ['Fixed-term contract template — seasonal', 'HR-TPL-003', 'Template', 'v5.0', 'H. Nel', '2027-02-28', 'Current', 'ok', 'Contracts & templates'],
  ['Induction pack — abattoir placements', 'HR-TPL-009', 'Template', 'v2.3', 'K. Mahlangu', '2027-01-31', 'Current', 'ok', 'Contracts & templates'],
  ['Academy course register and attendance record', 'HR-REC-021', 'Record', 'v1.1', 'K. Mahlangu', '2026-12-31', 'Current', 'ok', 'Training records'],
  ['Travel and subsistence claim procedure', 'HR-SOP-006', 'Procedure', 'v3.1', 'EJ. Smit', '2027-08-31', 'Current', 'ok', 'Procedures'],
  ['Personnel file checklist', 'HR-REC-002', 'Record', 'v2.0', 'H. Nel', '2026-10-31', 'Review due', 'warn', 'Personnel files'],
  ['Information pack — new inspectors', 'HR-PACK-001', 'Employee pack', 'v3.2', 'T. Streicher', '2027-03-31', 'Current', 'ok', 'Employee pack'],
  ['Red to Green programme — APS', 'HR-PACK-004', 'Employee pack', 'v2.0', 'T. Streicher', '2027-01-31', 'Current', 'ok', 'Employee pack'],
  ['Bound legislation pack — APS Act', 'HR-PACK-006', 'Employee pack', 'v1.8', 'T. Streicher', '2026-10-31', 'Review due', 'warn', 'Employee pack'],
  ['Equipment declaration form', 'HR-PACK-008', 'Employee pack', 'v1.2', 'Admin', '2027-06-30', 'Current', 'ok', 'Employee pack'],
  ['Vehicle allowance and tracker information', 'HR-PACK-011', 'Employee pack', 'v2.1', 'EJ. Smit', '2027-04-30', 'Current', 'ok', 'Employee pack'],
];

export const ACKNOWLEDGEMENTS = [
  ['Conditions of employment v4.2', '206 of 214 acknowledged', 96],
  ['Disciplinary code v3.0', '198 of 214 acknowledged', 93],
  ['Occupational health policy v1.4', '171 of 214 acknowledged', 80],
];

// HR home
export const ALERTS = [
  ['Finding', 'Placement blocked — Rustenburg abattoir', 'M. Sithole’s DALRRD registration lapsed on 31 August 2026. The placement is suspended until re-registration is confirmed; relief cover is in place from Brits until 19 September.', 'Open competence register', 'HR-2026-0431'],
  ['Observation', 'Two registrations expire within 60 days', 'A. Pretorius (classification, 14 October) and one veterinary technician (2 November). Both have Academy re-certification dates booked.', 'View expiry schedule', 'HR-2026-0428'],
  ['Recommendation', 'Medical surveillance overdue at Cato Ridge', 'Four inspectors are past their annual occupational health review. The provider has offered an on-site day on 24 September, which avoids four separate trips.', 'Confirm the on-site day', 'HR-2026-0419'],
  ['Note', 'Two fixed-term contracts end this month', 'J. van Wyk (Ceres packhouse) and P. September (Paarl) end on 30 September. Both sites have confirmed continued volumes for the citrus season.', 'Prepare renewals', 'HR-2026-0412'],
];

export const NOTICES = [
  ['2026-09-07', 'Performance review cycle opens 1 October', 'Managers rate against the placement record, not recollection. Guidance and the review form are on the Policies library.'],
  ['2026-09-04', 'Academy 2027 course calendar published', 'Ante- and post-mortem refresher moves to a quarterly intake. Book before 30 September for the November group.'],
  ['2026-08-28', 'Travel and subsistence rates updated', 'Effective 1 September 2026. Relief travel is now claimed per site visit rather than per day.'],
];

export const WEEK = [
  ['Tue', 'Academy: HACCP principles, 12 delegates, Lynnwood'],
  ['Wed', 'Two new starters begin induction — Cato Ridge and Paarl'],
  ['Thu', 'Directors’ people review, 09:00 — dashboard pack due Wednesday'],
  ['Fri', 'Occupational health provider site visit, Bethlehem'],
];

// Management dashboard
export const SERVICES = [
  ['IMI & Classification', '118', '4', '97%', 97],
  ['APS', '34', '2', '91%', 91],
  ['Auditing', '21', '1', '88%', 88],
  ['Lab', '18', '2', '84%', 84],
  ['Vet Services', '11', '1', '93%', 93],
  ['Training', '8', '1', '79%', 79],
  ['Egg Production Verification', '4', '0', '86%', 86],
];

export const WATCH = [
  ['Rustenburg abattoir', 'Single-inspector site since June. Third relief arrangement this quarter.', 'Escalate', 'bad'],
  ['Academy facilitator vacancy', 'Open 74 days. Delays the quarterly ante- and post-mortem intake.', '74 days', 'warn'],
  ['Medical surveillance backlog', 'Nine reviews outstanding across three sites. On-site day proposed.', 'In progress', 'info'],
  ['Fixed-term renewals', 'Two contracts end 30 September. Both sites confirmed volumes.', 'On track', 'ok'],
];

// Headline figures, per screen.
export const STATS = {
  home: [
    ['214', 'Employees on register', null],
    ['38', 'Sites with placements', null],
    ['3', 'Leave requests pending', null],
    ['2', 'Registrations expiring', null],
  ],
  dash: [
    ['214', 'Headcount', '+6 against 1 March 2026'],
    ['96.4%', 'Placement coverage', 'Target 98% · Rustenburg short'],
    ['98.1%', 'Registration compliance', 'One placement suspended'],
    ['7.3%', 'Annual turnover', 'Down from 9.1% last year'],
    ['R 96k', 'Cost to fill two posts', 'Against R 214 800 relief spend'],
  ],
  competence: [
    ['98.1%', 'Registrations valid', null],
    ['2', 'Expiring within 60 days', null],
    ['1', 'Expired — placement blocked', null],
    ['1 480', 'Academy hours delivered', null],
  ],
  r2g: [
    ['7', 'In the programme', null],
    ['2', 'Behind or at risk', null],
    ['1', 'Awaiting green sign-off', null],
    ['91', 'Median days to green', null],
  ],
  docs: [
    ['142', 'Controlled documents', null],
    ['2', 'Review due within 30 days', null],
    ['1', 'Past review date', null],
    ['96%', 'Acknowledgements received', null],
  ],
};
