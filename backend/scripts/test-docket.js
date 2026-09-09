import 'dotenv/config';
import { generateRepairDocket, repairReference } from '../src/pdf.js';
import { getRepairCoordinator } from '../src/settings.js';
import { getPool } from '../src/db.js';

const company = { Name: 'MOC Pty Ltd', BrandColor: '#2E6F81', LogoFile: null };
const asset = {
  Id: 999,
  Name: 'Dell Latitude 5440',
  Type: 'Laptop',
  Category: 'Computer',
  SerialNumber: 'DL5440-X1Y2Z3',
  AssetTag: 'MOC-LT-0042',
  PurchaseDate: '2024-03-15',
  RepairBookedInAt: new Date(),
};
const owner = { Name: 'Anthony Penzes', Title: 'Operations Manager', Email: 'Anthony.Penzes@moc-pty.com' };

const coordinator = await getRepairCoordinator();
console.log('Coordinator:', coordinator);

const ref = repairReference(asset.Id, asset.RepairBookedInAt);
const file = await generateRepairDocket({
  asset, company, owner,
  problem: 'Screen flickers under load and battery drains within 90 minutes.',
  supplier: 'Dell Service Centre Sandton',
  coordinator,
  reference: ref,
});
console.log('Generated:', file, 'ref:', ref);
process.exit(0);
