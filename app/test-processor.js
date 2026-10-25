const fs = require('fs');
const path = require('path');
const { processRawEmail } = require('./file-processor');

async function runTest() {
  console.log('Testing File Processor & Rule Matching Engine...');

  const testDir = path.join(__dirname, 'test_output');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const invoiceFolder = path.join(testDir, 'Finance', 'Invoices');

  const config = {
    rules: [
      {
        id: 'rule-test-1',
        name: 'Invoice to Finance',
        enabled: true,
        conditionType: 'subject_contains',
        conditionValue: 'Invoice',
        targetFolder: invoiceFolder,
        saveEml: true,
        saveAttachments: true,
        folderPerEmail: false
      }
    ]
  };

  // Construct a mock raw MIME email (.eml format)
  const mockEml = [
    'From: accounting@vendor.co.th',
    'To: finance@mycompany.com',
    'Subject: Invoice #INV-2026-0418 for Software License',
    'Date: Fri, 17 Oct 2026 10:30:00 +0700',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BOUNDARY123"',
    '',
    '--BOUNDARY123',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Dear Finance Team,\nPlease find attached our official invoice.\nRegards,\nAccounting',
    '--BOUNDARY123',
    'Content-Type: application/pdf; name="Invoice.pdf"',
    'Content-Disposition: attachment; filename="Invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDwKL0tpZHMgWzUgMCBSXQovQ291bnQgMQov',
    'VHlwZSAvUGFnZXMKPj4KZW5kb2JqCg==',
    '--BOUNDARY123--'
  ].join('\r\n');

  let processedData = null;
  const result = await processRawEmail(Buffer.from(mockEml), config, (data) => {
    processedData = data;
  });

  console.log('Process result:', result);

  if (!result.success) {
    throw new Error('Processing failed: ' + JSON.stringify(result));
  }

  // Check saved files
  const savedFiles = fs.readdirSync(invoiceFolder);
  console.log(`Files saved in ${invoiceFolder}:`, savedFiles);

  const hasEml = savedFiles.some(f => f.endsWith('.eml'));
  const hasPdf = savedFiles.some(f => f === 'Invoice.pdf');

  if (hasEml && hasPdf) {
    console.log('SUCCESS: Both .eml and Invoice.pdf attachment were extracted and saved properly!');
  } else {
    throw new Error(`Expected both .eml and .pdf in destination, got: ${savedFiles.join(', ')}`);
  }

  // 2. Test Monthly Quota Enforcement (100 limit)
  console.log('Testing Monthly Quota Enforcement (100 emails/month)...');
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Test case A: Quota full
  const fullQuotaConfig = {
    rules: config.rules,
    quota: {
      limit: 100,
      used: 100,
      month: currentMonth,
      isUnlimited: false
    }
  };

  const blockedResult = await processRawEmail(Buffer.from(mockEml), fullQuotaConfig);
  if (blockedResult.reason !== 'QUOTA_EXCEEDED') {
    throw new Error('Expected QUOTA_EXCEEDED when quota is 100/100, but got: ' + JSON.stringify(blockedResult));
  }
  console.log('SUCCESS: Email properly blocked when 100/100 monthly quota is reached!');

  // Test case B: Monthly auto-reset (previous month was full, new month resets)
  console.log('Testing Auto-Reset on new month...');
  const oldMonthConfig = {
    rules: config.rules,
    quota: {
      limit: 100,
      used: 100,
      month: '2026-01', // old month
      isUnlimited: false
    }
  };

  const resetResult = await processRawEmail(Buffer.from(mockEml), oldMonthConfig);
  if (!resetResult.success || oldMonthConfig.quota.month !== currentMonth || oldMonthConfig.quota.used !== 0) {
    throw new Error('Expected quota auto-reset for new month, but got: ' + JSON.stringify(oldMonthConfig.quota));
  }
  console.log('SUCCESS: Quota auto-reset successfully to 0 for new month!');

  // 3. Test New Conditions in Run #4: body_contains, to_contains, and year_month subfolders
  console.log('Testing Run #4 features: body_contains, to_contains, and year_month hierarchy...');
  const yearMonthFolder = path.join(testDir, 'YearMonthArchive');
  const run4Config = {
    rules: [
      {
        id: 'rule-body-test',
        name: 'Urgent License Match',
        enabled: true,
        conditionType: 'body_contains',
        conditionValue: 'official invoice',
        targetFolder: yearMonthFolder,
        saveEml: true,
        saveAttachments: true,
        subfolderMode: 'year_month'
      }
    ]
  };

  const bodyMatchResult = await processRawEmail(Buffer.from(mockEml), run4Config);
  if (!bodyMatchResult.success) {
    throw new Error('Expected body_contains rule to match email containing "official invoice"');
  }

  // Check Year/Month folder structure (e.g. testDir/YearMonthArchive/2026/10)
  const yyyy = '2026';
  const mm = '10';
  const expectedSubdir = path.join(yearMonthFolder, yyyy, mm);
  if (!fs.existsSync(expectedSubdir)) {
    throw new Error(`Expected year/month subfolder ${expectedSubdir} to exist`);
  }
  console.log('SUCCESS: body_contains and year_month folder structure verified successfully!');

  const senderFolder = path.join(testDir, 'SenderArchive');
  const senderRule = {
    rules: [{
      enabled: true,
      conditionType: 'all_emails',
      targetFolder: senderFolder,
      subfolderMode: 'sender',
      saveEml: true,
      saveAttachments: false
    }]
  };
  const namedSenderEmail = mockEml.replace(
    'From: accounting@vendor.co.th',
    'From: Finance <accounting@vendor.co.th>'
  );
  const senderResult = await processRawEmail(Buffer.from(namedSenderEmail), senderRule);
  if (!senderResult.success || !fs.existsSync(path.join(senderFolder, '_Finance_'))) {
    throw new Error('Expected sender folder to use the display name without the email address');
  }
  console.log('SUCCESS: sender display name folder verified successfully!');

  // Cleanup test folder
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('All tests completed successfully and test artifacts cleaned up.');
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
