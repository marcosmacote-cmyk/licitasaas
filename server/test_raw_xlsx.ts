import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { downloadSinapiViaBrowser } from './services/engineering/sinapiCrawler';
const AdmZip = require('adm-zip');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinapi-test-'));
  const filePath = await downloadSinapiViaBrowser('CE', 3, 2026, false, tmpDir);
  if (!filePath) { console.error('Download failed'); return; }

  const buf = fs.readFileSync(filePath);
  const zip = new AdmZip(Buffer.from(buf));
  
  let refBuf = null;
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toUpperCase();
    if (name.includes('REFER') && name.endsWith('.XLSX')) {
       refBuf = entry.getData(); break;
    }
  }

  const xlsxZip = new AdmZip(Buffer.from(refBuf));
  console.log('Inside XLSX entries:');
  xlsxZip.getEntries().forEach((e: any) => {
    console.log(e.entryName, '->', e.header.size);
  });
}
run();
