// Equipment the agency issues to its inspectors, laboratory and academy.
//
// The Equipment & assets screens read dbo.Assets, which was empty — every
// figure on the analytics tab was a genuine zero rather than a display fault.
// LANCorp's own asset data is deliberately not loaded (see the note in the
// repository README), so this is FSA-appropriate equipment instead.
//
// Row shape:
//   [ownerStaffName | null,   // null = held in storage
//    category, type, name, serial, tag,
//    purchaseDate, purchaseValue, depreciationPctPerYear, usefulLifeYears,
//    notes,
//    repair]                  // null, or [stage, problem, supplier, bookedInAt]
//
// Values are rands. Depreciation and useful life drive the book value and the
// end-of-life window on the analytics tab, so they are set per category the
// way a public entity's asset register would: 3 years for field electronics,
// 5 for laptops and lab instruments, 8 for vehicles.

export const ASSETS = [
  // --- Vehicles: relief travel between sites is the agency's biggest cost ---
  ['M. Sithole', 'Vehicles', 'Light commercial vehicle', 'Toyota Hilux 2.4 GD-6 single cab', 'AHTKB8CD1234567', 'FSA-VEH-001', '2021-03-15', 486000, 12.5, 8, 'Rustenburg circuit. Highest mileage in the fleet.', null],
  ['S. Naidoo', 'Vehicles', 'Light commercial vehicle', 'Toyota Hilux 2.4 GD-6 double cab', 'AHTKB8CD7654321', 'FSA-VEH-002', '2022-07-01', 592000, 12.5, 8, 'Gauteng regional audit circuit.', null],
  ['Dr L. Botha', 'Vehicles', 'SUV', 'Isuzu MU-X 3.0', 'MPATFS85J00123', 'FSA-VEH-003', '2023-02-20', 715000, 12.5, 8, 'Free State veterinary circuit. Carries the cold-chain box.', null],
  [null, 'Vehicles', 'Panel van', 'VW Caddy 1.6i', 'WV1ZZZ2KZAX00456', 'FSA-VEH-004', '2019-11-05', 318000, 12.5, 8, 'Pool vehicle, Pretoria. Due for replacement assessment.', null],

  // --- Field equipment carried by inspectors -------------------------------
  ['T. Mokoena', 'Field equipment', 'Thermometer', 'Testo 104-IR probe thermometer', 'TS104-88213', 'FSA-FLD-011', '2024-04-12', 8450, 33.3, 3, 'Calibrated annually. Ante- and post-mortem line checks.', null],
  ['A. Pretorius', 'Field equipment', 'Carcass classification kit', 'FSA classification kit (probe, callipers, stamps)', 'CK-2024-0031', 'FSA-FLD-012', '2024-02-28', 12900, 33.3, 3, 'Bethlehem abattoir. Stamps re-issued each cycle.', null],
  ['M. Sithole', 'Field equipment', 'Thermometer', 'Testo 104-IR probe thermometer', 'TS104-88301', 'FSA-FLD-013', '2023-09-19', 8450, 33.3, 3, 'Rustenburg. Due for calibration in October.', null],
  ['J. van Wyk', 'Field equipment', 'Sampling kit', 'Sterile swab and sampling kit, 200-unit case', 'SK-2025-0114', 'FSA-FLD-014', '2025-01-30', 6300, 33.3, 3, 'Ceres packhouse. Consumable stock tracked separately.', null],
  ['P. September', 'Field equipment', 'Egg candling lamp', 'OvaScope candling lamp', 'OV-4471', 'FSA-FLD-015', '2022-06-14', 4200, 33.3, 3, 'Paarl grading station.', ['at_supplier', 'Lamp housing cracked; light leak affects grading accuracy.', 'Agri Instruments CC', '2026-08-24']],
  [null, 'Field equipment', 'Thermometer', 'Testo 104-IR probe thermometer', 'TS104-88356', 'FSA-FLD-016', '2022-05-02', 8450, 33.3, 3, 'Spare, held at Pretoria stores for relief cover.', null],

  // --- Laboratory ----------------------------------------------------------
  ['N. Dlamini', 'Laboratory equipment', 'Incubator', 'Memmert IN55 incubator', 'MEM-IN55-2213', 'FSA-LAB-021', '2021-08-11', 78400, 20, 5, 'Lynnwood laboratory. Microbiological plate counts.', null],
  ['N. Dlamini', 'Laboratory equipment', 'Analytical balance', 'Mettler Toledo ME204 balance', 'MT-ME204-9087', 'FSA-LAB-022', '2023-03-07', 64200, 20, 5, 'Annual verification by SANAS-accredited provider.', null],
  [null, 'Laboratory equipment', 'Autoclave', 'Systec DX-65 benchtop autoclave', 'SYS-DX65-4410', 'FSA-LAB-023', '2020-10-22', 154000, 20, 5, 'Lynnwood. Past useful life — replacement budgeted.', null],
  [null, 'Laboratory equipment', 'Microscope', 'Zeiss Primostar 3 microscope', 'ZS-P3-1188', 'FSA-LAB-024', '2024-09-16', 96500, 20, 5, 'Lynnwood laboratory, trichinella screening.', null],

  // --- IT ------------------------------------------------------------------
  ['H. Marais', 'IT equipment', 'Laptop', 'Dell Latitude 5450', 'DL5450-7781', 'FSA-IT-031', '2024-06-03', 24800, 20, 5, 'HR. Runs the placement and competence registers.', null],
  ['S. Naidoo', 'IT equipment', 'Laptop', 'Dell Latitude 5450', 'DL5450-7782', 'FSA-IT-032', '2024-06-03', 24800, 20, 5, 'Audit reporting, works offline on site.', null],
  ['K. Mahlangu', 'IT equipment', 'Laptop', 'Lenovo ThinkPad L14', 'LN-L14-3391', 'FSA-IT-033', '2022-02-14', 21500, 20, 5, 'FSA Academy. Drives the training-room projector.', null],
  ['T. Mokoena', 'IT equipment', 'Tablet', 'Samsung Galaxy Tab Active5', 'SM-T575-8890', 'FSA-IT-034', '2025-03-11', 12300, 33.3, 3, 'Rugged tablet for on-line inspection capture.', null],
  ['A. Pretorius', 'IT equipment', 'Tablet', 'Samsung Galaxy Tab Active5', 'SM-T575-8891', 'FSA-IT-035', '2025-03-11', 12300, 33.3, 3, 'Rugged tablet, classification capture.', null],
  ['J. van Wyk', 'IT equipment', 'Tablet', 'Samsung Galaxy Tab Active5', 'SM-T575-8892', 'FSA-IT-036', '2025-03-11', 12300, 33.3, 3, 'Ceres packhouse.', ['booked_in', 'Screen unresponsive after cold-store use.', 'Comtech Repairs', '2026-09-02']],
  [null, 'IT equipment', 'Laptop', 'Dell Latitude 5420', 'DL5420-6612', 'FSA-IT-037', '2020-08-19', 19900, 20, 5, 'Held in storage. Past useful life, pending disposal.', null],
  ['Dr L. Botha', 'IT equipment', 'Laptop', 'Dell Latitude 5450', 'DL5450-7783', 'FSA-IT-038', '2023-11-27', 24800, 20, 5, 'Veterinary reporting and cold-chain logs.', null],

  // --- Academy / office ----------------------------------------------------
  ['K. Mahlangu', 'Office equipment', 'Projector', 'Epson EB-L210W laser projector', 'EP-L210W-2245', 'FSA-OFF-041', '2023-05-30', 31700, 20, 5, 'FSA Academy training room, Pretoria.', null],
  [null, 'Office equipment', 'Multifunction printer', 'Kyocera TASKalfa 3554ci', 'KY-3554-1120', 'FSA-OFF-042', '2022-01-18', 58900, 20, 5, 'Pretoria head office, shared.', null],
  ['H. Marais', 'Office equipment', 'Document scanner', 'Fujitsu fi-8170 scanner', 'FJ-8170-4408', 'FSA-OFF-043', '2024-08-08', 18400, 20, 5, 'Scans signed placement and contract records.', null],

  // --- PPE issued per inspector -------------------------------------------
  ['T. Mokoena', 'PPE', 'Protective clothing set', 'Cold-store PPE set (coat, boots, helmet, mesh glove)', 'PPE-2025-0142', 'FSA-PPE-051', '2025-02-03', 5600, 50, 2, 'Issued annually. Cato Ridge abattoir.', null],
  ['M. Sithole', 'PPE', 'Protective clothing set', 'Cold-store PPE set (coat, boots, helmet, mesh glove)', 'PPE-2025-0221', 'FSA-PPE-052', '2025-02-03', 5600, 50, 2, 'Issued annually. Rustenburg abattoir.', null],
  ['A. Pretorius', 'PPE', 'Protective clothing set', 'Cold-store PPE set (coat, boots, helmet, mesh glove)', 'PPE-2025-0088', 'FSA-PPE-053', '2025-02-03', 5600, 50, 2, 'Issued annually. Bethlehem abattoir.', null],
  ['P. September', 'PPE', 'Protective clothing set', 'Grading station PPE set', 'PPE-2025-0176', 'FSA-PPE-054', '2024-01-22', 4300, 50, 2, 'Past replacement date — reissue with the 2026 cycle.', null],
];
