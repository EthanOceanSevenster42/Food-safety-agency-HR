// Performance management — role templates and the packs built from them
// (handoff §5.6).
//
// The handoff records that FSA still owes the approved IJD format and the real
// KPA weightings per role (§9.2, §9.3); the six role templates below are
// scaffolded with indicative weights that sum to 100 per part. Ratings use a
// 1-5 scale with "Meets" at 3 — anything below that is a shortfall, and the EDP
// goals are derived from the shortfalls rather than typed in.

export const RATING_MEETS = 3;

export const RATING_LABELS = {
  1: 'Well below',
  2: 'Below',
  3: 'Meets',
  4: 'Exceeds',
  5: 'Outstanding',
};

// [role, service, mandate, reportsTo, regType]
export const ROLE_TEMPLATES = [
  [
    'Meat inspector', 'IMI',
    'Ante- and post-mortem inspection under the Meat Safety Act 40 of 2000, and the detention, '
    + 'condemnation and release of carcasses at the assigned abattoir.',
    'Area manager — IMI & Classification', 'DALRRD meat inspector registration',
  ],
  [
    'Senior classifier', 'IMI',
    'Carcass classification and the marking, roller-marking and record-keeping required by the '
    + 'Agricultural Product Standards Act 119 of 1990.',
    'Area manager — IMI & Classification', 'DALRRD classifier registration',
  ],
  [
    'Product inspector', 'APS',
    'Inspection of regulated agricultural products for compliance with product standards at '
    + 'packhouses, grading stations and cold stores.',
    'Area manager — APS', 'APS assignee appointment',
  ],
  [
    'Laboratory technologist', 'Lab',
    'Preparation and analysis of official samples, and the issue of results under the laboratory '
    + 'quality system.',
    'Laboratory manager', 'Not required for role',
  ],
  [
    'Lead auditor', 'Auditing',
    'Planning and leading system audits of assigned facilities, and reporting findings against the '
    + 'applicable scheme.',
    'Audit manager', 'Lead auditor certification',
  ],
  [
    'Training facilitator', 'Training',
    'Delivery and assessment of Academy programmes, and maintenance of the training record for '
    + 'every delegate.',
    'Academy manager', 'Assessor registration',
  ],
];

// [role, part, area, detail, weight, target]
// part: 'kra' (job description) | 'measure' (KPI & KPA schedule)
export const ROLE_ITEMS = [
  // --- Meat inspector -----------------------------------------------------
  ['Meat inspector', 'kra', 'Ante- and post-mortem inspection', 'Inspect every carcass and its offal on the line; detain, condemn or release in accordance with the Act.', 40, null],
  ['Meat inspector', 'kra', 'Hygiene and process control', 'Verify hygiene management, dressing standards and process controls at the assigned abattoir.', 20, null],
  ['Meat inspector', 'kra', 'Sampling', 'Draw official samples to the sampling plan and submit them within the required window.', 15, null],
  ['Meat inspector', 'kra', 'Records and reporting', 'Complete inspection records the same day and submit the weekly return.', 15, null],
  ['Meat inspector', 'kra', 'Registration and competence', 'Hold and maintain the registration the placement requires; attend scheduled re-certification.', 10, null],
  ['Meat inspector', 'measure', 'Facilities inspected per day', 'Counted from the daily inspection record.', 30, '1 abattoir per day'],
  ['Meat inspector', 'measure', 'Sampling volumes met', 'RAW samples submitted against the monthly sampling plan.', 25, '25 samples per month'],
  ['Meat inspector', 'measure', 'Reporting deadlines met', 'Weekly return submitted by close of business Friday.', 20, '100% on time'],
  ['Meat inspector', 'measure', 'Condemnation records complete', 'Every detention and condemnation carries a completed record.', 15, '100% complete'],
  ['Meat inspector', 'measure', 'Registration currency', 'Registration valid for the whole review period.', 10, 'Valid throughout'],

  // --- Senior classifier --------------------------------------------------
  ['Senior classifier', 'kra', 'Carcass classification', 'Classify carcasses to the prescribed scheme and apply the correct marks.', 40, null],
  ['Senior classifier', 'kra', 'Roller-marking and marking control', 'Control the application, security and reconciliation of marks.', 20, null],
  ['Senior classifier', 'kra', 'Records and reconciliation', 'Reconcile classification records against throughput daily.', 20, null],
  ['Senior classifier', 'kra', 'Mentoring', 'Mentor classifiers under training at the assigned site.', 10, null],
  ['Senior classifier', 'kra', 'Registration and competence', 'Hold and maintain the classifier registration.', 10, null],
  ['Senior classifier', 'measure', 'Classification accuracy', 'Verified on cross-check against the supervisor sample.', 35, '≥ 97% agreement'],
  ['Senior classifier', 'measure', 'Throughput classified', 'Carcasses classified against site throughput.', 25, '100% of throughput'],
  ['Senior classifier', 'measure', 'Mark reconciliation', 'Marks issued reconcile to marks applied.', 20, 'No unexplained variance'],
  ['Senior classifier', 'measure', 'Reporting deadlines met', 'Daily reconciliation submitted same day.', 10, '100% on time'],
  ['Senior classifier', 'measure', 'Registration currency', 'Registration valid for the whole review period.', 10, 'Valid throughout'],

  // --- Product inspector --------------------------------------------------
  ['Product inspector', 'kra', 'Product standard inspection', 'Inspect regulated products against the applicable product standard.', 40, null],
  ['Product inspector', 'kra', 'Packhouse and cold store verification', 'Verify grading, packing and storage practice at assigned facilities.', 25, null],
  ['Product inspector', 'kra', 'Sampling', 'Draw and submit official samples to plan.', 15, null],
  ['Product inspector', 'kra', 'Records and reporting', 'Complete inspection reports and issue outcomes to the facility.', 20, null],
  ['Product inspector', 'measure', 'Facilities inspected per month', 'Counted from the inspection register.', 35, '10 packhouses per month'],
  ['Product inspector', 'measure', 'Sampling volumes met', 'Samples submitted against the plan.', 25, '25 samples per month'],
  ['Product inspector', 'measure', 'Reports issued within 5 days', 'Inspection outcome issued to the facility.', 25, '100% within 5 days'],
  ['Product inspector', 'measure', 'Re-inspection closure', 'Non-conformances closed within the agreed period.', 15, '≥ 90% closed'],

  // --- Laboratory technologist -------------------------------------------
  ['Laboratory technologist', 'kra', 'Sample preparation and analysis', 'Prepare and analyse official samples to the documented method.', 45, null],
  ['Laboratory technologist', 'kra', 'Quality system compliance', 'Work within the laboratory quality system; record deviations.', 25, null],
  ['Laboratory technologist', 'kra', 'Equipment and calibration', 'Maintain and verify instruments to the calibration schedule.', 15, null],
  ['Laboratory technologist', 'kra', 'Result reporting', 'Issue results within the turnaround standard.', 15, null],
  ['Laboratory technologist', 'measure', 'Sample turnaround', 'Days from receipt to result issue.', 35, '≤ 5 working days'],
  ['Laboratory technologist', 'measure', 'Analytical quality control passes', 'Internal QC within control limits.', 30, '≥ 98% within limits'],
  ['Laboratory technologist', 'measure', 'Calibration schedule adherence', 'Instruments verified on schedule.', 20, '100% on schedule'],
  ['Laboratory technologist', 'measure', 'Deviations recorded and closed', 'Every deviation raised and closed.', 15, '100% closed'],

  // --- Lead auditor -------------------------------------------------------
  ['Lead auditor', 'kra', 'Audit planning and execution', 'Plan and lead audits of assigned facilities to the scheme.', 40, null],
  ['Lead auditor', 'kra', 'Findings and reporting', 'Raise findings with evidence and issue the audit report.', 25, null],
  ['Lead auditor', 'kra', 'Corrective action verification', 'Verify and close corrective actions.', 20, null],
  ['Lead auditor', 'kra', 'Team leadership', 'Lead and brief the audit team; develop auditors under training.', 15, null],
  ['Lead auditor', 'measure', 'Audits completed to plan', 'Audits delivered against the annual programme.', 35, '21 audits per year'],
  ['Lead auditor', 'measure', 'Reports issued within 10 days', 'Audit report issued after the closing meeting.', 25, '100% within 10 days'],
  ['Lead auditor', 'measure', 'Corrective actions closed', 'Findings closed within the agreed period.', 25, '≥ 95% closed'],
  ['Lead auditor', 'measure', 'Certification currency', 'Lead auditor certification maintained.', 15, 'Valid throughout'],

  // --- Training facilitator ----------------------------------------------
  ['Training facilitator', 'kra', 'Programme delivery', 'Deliver Academy programmes to the approved curriculum.', 40, null],
  ['Training facilitator', 'kra', 'Assessment', 'Assess delegates and moderate results.', 25, null],
  ['Training facilitator', 'kra', 'Training records', 'Maintain a complete record for every delegate.', 20, null],
  ['Training facilitator', 'kra', 'Curriculum maintenance', 'Keep material current with regulation and practice.', 15, null],
  ['Training facilitator', 'measure', 'Training hours delivered', 'Contact hours delivered in the period.', 35, '1 400 hours per year'],
  ['Training facilitator', 'measure', 'Delegate pass rate', 'Delegates competent at first assessment.', 25, '≥ 85%'],
  ['Training facilitator', 'measure', 'Records complete', 'Delegate records complete and filed.', 20, '100% complete'],
  ['Training facilitator', 'measure', 'Course calendar adherence', 'Scheduled intakes delivered on date.', 20, '100% on date'],
];

// Packs to create: [staffNo, role, stage, jdState, kpiState, edpState, ratings]
// `ratings` maps a measure's Area to its 1-5 rating; anything below 3 becomes a
// development goal automatically. Omit to leave the pack unrated.
export const PACKS = [
  ['FSA-0142', 'Meat inspector', 'midyear', 'complete', 'complete', 'complete', {
    'Facilities inspected per day': 4,
    'Sampling volumes met': 3,
    'Reporting deadlines met': 2,          // shortfall
    'Condemnation records complete': 4,
    'Registration currency': 3,
  }],
  ['FSA-0088', 'Senior classifier', 'midyear', 'complete', 'complete', 'draft', {
    'Classification accuracy': 4,
    'Throughput classified': 3,
    'Mark reconciliation': 3,
    'Reporting deadlines met': 2,          // shortfall
    'Registration currency': 2,            // shortfall — registration expiring
  }],
  ['FSA-0203', 'Laboratory technologist', 'objectives', 'complete', 'complete', 'outstanding', null],
  ['FSA-0117', 'Product inspector', 'midyear', 'complete', 'draft', 'outstanding', {
    'Facilities inspected per month': 3,
    'Sampling volumes met': 4,
    'Reports issued within 5 days': 3,
    'Re-inspection closure': 2,            // shortfall
  }],
  ['FSA-0164', 'Lead auditor', 'yearend', 'complete', 'complete', 'complete', {
    'Audits completed to plan': 4,
    'Reports issued within 10 days': 5,
    'Corrective actions closed': 4,
    'Certification currency': 3,
  }],
  ['FSA-0221', 'Meat inspector', 'objectives', 'complete', 'outstanding', 'outstanding', null],
  ['FSA-0189', 'Training facilitator', 'midyear', 'draft', 'outstanding', 'outstanding', null],
];

// What a shortfall turns into. Keyed by measure area; the fallback is used for
// any area without an explicit development route.
export const GOAL_ROUTES = {
  'Reporting deadlines met': ['Complete the Academy record-keeping and reporting refresher.', 'FSA Academy, Pretoria'],
  'Registration currency': ['Attend the booked re-certification and lodge the renewed registration.', 'DALRRD'],
  'Re-inspection closure': ['Complete the corrective-action follow-up module.', 'FSA Academy, Pretoria'],
  'Sampling volumes met': ['Complete sampling-plan coaching with the area manager.', 'Area manager'],
  'Classification accuracy': ['Attend classification calibration with a senior classifier.', 'FSA Academy, Pretoria'],
};
export const GOAL_FALLBACK = ['Agree a development action with the line manager for this area.', 'Line manager'];
