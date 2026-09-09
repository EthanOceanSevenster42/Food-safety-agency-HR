// Monthly management report — August 2026 (handoff §5.3).
//
// The handoff is explicit that the figures in the prototype are illustrative
// placeholders and that real August figures are still owed by FSA (§9.1). These
// are consistent with the registers seeded elsewhere in this database so the
// report reconciles against the other screens, but they are not FSA's audited
// numbers. Replace via this file, or edit the rows directly.

export const REPORT = {
  period: '2026-08',
  periodLabel: '1–31 August 2026',
  sourceNote: 'Source: FSA HR register, 1–31 August 2026.',
  positionStatement:
    'The establishment held at 214 employees against an approved 225, and every site except '
    + 'Rustenburg carried the placement its scope requires. One inspector registration lapsed '
    + 'during the month and the affected placement was suspended the same day, with relief cover '
    + 'drawn from Brits. Employee packs are complete for 191 of 214 employees; the shortfall sits '
    + 'almost entirely in the two services that grew fastest this year. Reliance on relief travel '
    + 'to hold single-inspector sites is now the largest controllable cost in the function and is '
    + 'put to the directors as a decision this month.',
  compiledBy: 'H. Marais, Human Resources Manager',
  compiledAt: '2026-09-02',
  reviewedBy: 'T. Streicher, Director',
  reviewedAt: '2026-09-04',
  acceptedBy: null,
  acceptedAt: null,
};

// [name, actual, target, statusKind, note]
// statusKind: ok | observation | finding — the report's three status classes.
export const INDICATORS = [
  ['Headcount against approved establishment', '214', '225', 'observation', 'Eleven posts unfilled; four are in IMI & Classification.'],
  ['Placement coverage', '96.4%', '98%', 'observation', 'Rustenburg abattoir short for the full month.'],
  ['Registration validity', '98.1%', '100%', 'finding', 'One lapsed registration; placement suspended 31 August.'],
  ['Registrations expiring within 90 days', '2', '0', 'observation', 'Both hold booked Academy re-certification dates.'],
  ['Employee packs complete', '191 of 214', '214', 'observation', 'Twenty-three packs outstanding, 89.3% complete.'],
  ['Onboarding programmes on schedule', '5 of 7', '7', 'observation', 'Two starters behind their target week.'],
  ['Median days to green', '91', '90', 'ok', 'Within tolerance of the 90-day target.'],
  ['Annual turnover', '7.3%', '≤ 10%', 'ok', 'Down from 9.1% in the prior year.'],
  ['Leave requests decided within 2 working days', '88%', '95%', 'observation', 'Three requests still awaiting a decision at month end.'],
  ['Medical surveillance current', '205 of 214', '214', 'finding', 'Nine reviews outstanding across three sites.'],
  ['Academy training hours delivered', '1 480', '1 400', 'ok', 'Above plan; HACCP intake ran at full capacity.'],
];

// [kind, ref, title, evidence, correctiveAction, owner, dueDate]
export const FINDINGS = [
  [
    'Finding', 'HR-2026-0431',
    'Placement held without a valid registration',
    'M. Sithole’s DALRRD registration expired on 31 August 2026 while placed at Rustenburg '
    + 'abattoir. The placement was suspended the same day and relief cover was arranged from Brits '
    + 'until 19 September. The register did not raise the expiry before the date was reached.',
    'Introduce automated notification at 90, 60 and 30 days before a registration expiry, with the '
    + 'placement holder and their manager both notified. Re-registration to be confirmed in writing '
    + 'before the placement resumes.',
    'H. Marais', '2026-09-30',
  ],
  [
    'Finding', 'HR-2026-0419',
    'Medical surveillance reviews past due',
    'Nine annual occupational health reviews were outstanding at month end across Cato Ridge, '
    + 'Bethlehem and Paarl. The oldest is four months past its due date.',
    'Accept the provider’s offer of a single on-site day on 24 September, clearing all nine reviews '
    + 'in one visit and avoiding nine separate journeys.',
    'H. Marais', '2026-09-24',
  ],
  [
    'Observation', 'HR-2026-0428',
    'Two registrations expire within 90 days',
    'A. Pretorius (classification, expires 14 October 2026) and one veterinary technician '
    + '(2 November 2026). Both hold booked Academy re-certification dates.',
    'Confirm attendance at the booked dates and record the renewed registrations on the competence '
    + 'register before expiry.',
    'K. Mahlangu', '2026-10-07',
  ],
  [
    'Observation', 'HR-2026-0433',
    'Employee packs outstanding for twenty-three employees',
    'Pack completeness is 89.3%. The outstanding packs are concentrated in APS and Auditing, the '
    + 'two services that grew fastest during the year.',
    'Complete the outstanding job descriptions and KPA schedules for those two services before the '
    + 'performance cycle opens on 1 October.',
    'H. Marais', '2026-09-30',
  ],
  [
    'Recommendation', 'HR-2026-0435',
    'Convert relief cover at two sites to permanent posts',
    'Relief travel and overtime at Rustenburg and Bethlehem came to R 214 800 over six months. Two '
    + 'permanent appointments are estimated at R 96 000. Rustenburg has run on a third successive '
    + 'relief arrangement this quarter.',
    'Approve the two permanent inspector posts and end the standing relief arrangement.',
    'Directors', '2026-09-30',
  ],
  [
    'Note', 'HR-2026-0412',
    'Two fixed-term contracts end this month',
    'J. van Wyk (Ceres packhouse) and P. September (Paarl grading station) end on 30 September 2026. '
    + 'Both sites have confirmed continued volumes for the citrus season.',
    null, 'H. Marais', '2026-09-20',
  ],
];

// [section, body, owner, dueDate, state]
export const ACTIONS = [
  // Progress on the actions committed to last month.
  ['prior', 'Publish the 2027 Academy course calendar.', 'K. Mahlangu', '2026-08-31', 'done'],
  ['prior', 'Update travel and subsistence rates and communicate to all sites.', 'Finance', '2026-08-31', 'done'],
  ['prior', 'Complete the Red to Green templates for the six non-APS departments.', 'H. Marais', '2026-08-31', 'in progress'],
  ['prior', 'Close the medical surveillance backlog at Cato Ridge.', 'H. Marais', '2026-08-15', 'not started'],
  ['prior', 'Fill the Academy facilitator vacancy.', 'H. Marais', '2026-08-31', 'in progress'],

  // Next-step commitments — ticked in the meeting.
  ['commitment', 'Implement registration expiry notification at 90, 60 and 30 days.', 'H. Marais', '2026-09-30', null],
  ['commitment', 'Hold the provider on-site medical surveillance day on 24 September.', 'H. Marais', '2026-09-24', null],
  ['commitment', 'Complete the twenty-three outstanding employee packs in APS and Auditing.', 'H. Marais', '2026-09-30', null],
  ['commitment', 'Confirm re-registration for A. Pretorius before 14 October.', 'K. Mahlangu', '2026-10-07', null],
  ['commitment', 'Prepare renewal papers for the two fixed-term contracts ending 30 September.', 'H. Marais', '2026-09-20', null],
  ['commitment', 'Advertise the Academy facilitator post through the pipeline.', 'H. Marais', '2026-09-12', null],
  ['commitment', 'Complete the six outstanding department Red to Green templates.', 'H. Marais', '2026-09-30', null],
  ['commitment', 'Bring leave decisions within the two working day standard.', 'Department managers', '2026-09-30', null],
  ['commitment', 'Table the relief-cover cost comparison with the two permanent post motivations.', 'H. Marais', '2026-09-16', null],
];

// [title, body]
export const DECISIONS = [
  [
    'Approve two permanent inspector posts at Rustenburg and Bethlehem',
    'Relief travel and overtime at the two sites came to R 214 800 over six months against an '
    + 'estimated R 96 000 for two permanent appointments. Approval ends a standing reliance on '
    + 'relief cover that has now run for three successive quarters at Rustenburg.',
  ],
  [
    'Accept the provider’s single on-site medical surveillance day on 24 September',
    'Nine reviews are outstanding across three sites. One on-site day clears all nine and avoids '
    + 'nine separate journeys; the alternative is nine individual appointments through October.',
  ],
];
