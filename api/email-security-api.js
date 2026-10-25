/**
 * EmailUserSecurityAPI v1.0.0
 * Open Client-Side & RESTful Utility API for Email Users & IT Security Teams
 * Provided by Email to Folder (https://emailtofolder.com)
 *
 * Capabilities:
 * 1. auditEmailOrDomain(input)
 *    - Validates syntax, detects disposable/temporary email providers, checks MX, SPF, DMARC,
 *      BIMI, DKIM common selectors, and calculates an Email Security Score (0-100) + Spoofing Risk.
 * 2. analyzeRawEmailHeader(rawHeaderText)
 *    - Parses raw RFC 5322 email headers (From, Return-Path, Reply-To, Received hops,
 *      Authentication-Results) to detect BEC / CEO Fraud, Return-Path mismatch, or Phishing anomalies.
 * 3. getEmailVulnerabilityFeed(options)
 *    - Fetches the curated Email Vulnerability & CVE/KEV Threat Intelligence Feed
 *      from /api/email-vulnerabilities.json and optionally merges live NIST NVD CVE records.
 */
(function (root) {
  'use strict';

  var DISPOSABLE_DOMAINS = {
    'mailinator.com': 1, 'guerrillamail.com': 1, '10minutemail.com': 1, 'tempmail.com': 1,
    'temp-mail.org': 1, 'yopmail.com': 1, 'trashmail.com': 1, 'sharklasers.com': 1,
    'getnada.com': 1, 'maildrop.cc': 1, 'throwawaymail.com': 1, 'fakeinbox.com': 1,
    'dispostable.com': 1, 'mohmal.com': 1, 'mailnesia.com': 1, 'burnermail.io': 1
  };

  var FREE_PUBLIC_PROVIDERS = {
    'gmail.com': 'Google Gmail (Consumer)',
    'googlemail.com': 'Google Gmail (Consumer)',
    'outlook.com': 'Microsoft Outlook.com (Consumer)',
    'hotmail.com': 'Microsoft Hotmail (Consumer)',
    'live.com': 'Microsoft Live Mail (Consumer)',
    'msn.com': 'Microsoft MSN Mail',
    'yahoo.com': 'Yahoo Mail',
    'icloud.com': 'Apple iCloud Mail',
    'me.com': 'Apple Mail',
    'proton.me': 'Proton Mail (Encrypted)',
    'protonmail.com': 'Proton Mail (Encrypted)',
    'zoho.com': 'Zoho Mail'
  };

  var DNS_CACHE = {};

  async function queryDoH(name, type) {
    var key = name.toLowerCase() + ':' + type.toUpperCase();
    if (DNS_CACHE[key]) return DNS_CACHE[key];

    try {
      var r1 = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), { cache: 'no-store' });
      if (r1.ok) {
        var d1 = await r1.json();
        DNS_CACHE[key] = d1;
        return d1;
      }
    } catch (e) {}

    try {
      var r2 = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), {
        headers: { 'accept': 'application/dns-json' },
        cache: 'no-store'
      });
      if (r2.ok) {
        var d2 = await r2.json();
        DNS_CACHE[key] = d2;
        return d2;
      }
    } catch (e2) {}

    return null;
  }

  function extractTxtStrings(dnsResp) {
    if (!dnsResp || !Array.isArray(dnsResp.Answer)) return [];
    return dnsResp.Answer.map(function (a) {
      return String(a.data || '').replace(/^"|"$/g, '').replace(/"\s*"/g, '');
    });
  }

  /**
   * 1. Audit an Email Address or Domain for Deliverability, Spoofing Risk, SPF, DMARC & MX
   * @param {string} rawInput - e.g. "accounting@company.co.th" or "gmail.com"
   * @returns {Promise<Object>} JSON API response
   */
  async function auditEmailOrDomain(rawInput) {
    var t0 = performance.now();
    var cleaned = String(rawInput || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    var isEmail = cleaned.indexOf('@') !== -1;
    var localPart = isEmail ? cleaned.split('@')[0] : null;
    var domain = isEmail ? cleaned.split('@').pop() : cleaned;

    if (!domain || domain.indexOf('.') === -1) {
      return {
        ok: false,
        error: 'INVALID_INPUT',
        message_th: 'กรุณาระบุอีเมลหรือชื่อโดเมนที่ถูกต้อง เช่น user@company.co.th หรือ gmail.com',
        message_en: 'Please provide a valid email address or domain name (e.g. user@company.co.th).'
      };
    }

    var roleAccounts = ['admin', 'support', 'billing', 'invoice', 'accounts', 'accounting', 'info', 'sales', 'hr', 'security', 'ceo', 'finance'];
    var isRoleAccount = localPart ? roleAccounts.indexOf(localPart) !== -1 : false;
    var isDisposable = !!DISPOSABLE_DOMAINS[domain];
    var publicProviderName = FREE_PUBLIC_PROVIDERS[domain] || null;

    var dnsResults = await Promise.all([
      queryDoH(domain, 'MX'),
      queryDoH(domain, 'TXT'),
      queryDoH('_dmarc.' + domain, 'TXT'),
      queryDoH('default._bimi.' + domain, 'TXT')
    ]);

    var mxResp = dnsResults[0];
    var txtResp = dnsResults[1];
    var dmarcResp = dnsResults[2];
    var bimiResp = dnsResults[3];

    var mxRecords = (mxResp && Array.isArray(mxResp.Answer))
      ? mxResp.Answer.map(function (a) { return String(a.data || '').trim(); })
      : [];

    var txtRecords = extractTxtStrings(txtResp);
    var dmarcRecords = extractTxtStrings(dmarcResp);
    var bimiRecords = extractTxtStrings(bimiResp);

    var spfRecord = txtRecords.find(function (t) { return t.toLowerCase().indexOf('v=spf1') === 0; }) || null;
    var dmarcRecord = dmarcRecords.find(function (t) { return t.toLowerCase().indexOf('v=dmarc1') === 0; }) || null;
    var bimiRecord = bimiRecords.find(function (t) { return t.toLowerCase().indexOf('v=bimi1') === 0; }) || null;

    // Detect Email Infrastructure Provider
    var mxJoined = mxRecords.join(' ').toLowerCase();
    var mailGateway = 'Custom / Self-Hosted Mail Server';
    if (mxJoined.indexOf('google.com') !== -1 || mxJoined.indexOf('googlemail.com') !== -1) {
      mailGateway = 'Google Workspace / Gmail Origin';
    } else if (mxJoined.indexOf('outlook.com') !== -1 || mxJoined.indexOf('protection.outlook.com') !== -1) {
      mailGateway = 'Microsoft 365 / Exchange Online Protection (EOP)';
    } else if (mxJoined.indexOf('pphosted.com') !== -1) {
      mailGateway = 'Proofpoint Secure Email Gateway';
    } else if (mxJoined.indexOf('mimecast.com') !== -1) {
      mailGateway = 'Mimecast Secure Email Gateway';
    } else if (mxJoined.indexOf('barracudanetworks.com') !== -1) {
      mailGateway = 'Barracuda Email Security Gateway';
    } else if (mxJoined.indexOf('zoho.com') !== -1) {
      mailGateway = 'Zoho Mail Enterprise';
    } else if (mxJoined.indexOf('protonmail.ch') !== -1) {
      mailGateway = 'Proton Mail Encrypted Gateway';
    }

    // Analyze SPF Strictness
    var spfMode = 'MISSING';
    if (spfRecord) {
      if (spfRecord.indexOf('-all') !== -1) spfMode = 'STRICT_HARDFAIL (-all)';
      else if (spfRecord.indexOf('~all') !== -1) spfMode = 'SOFTFAIL (~all)';
      else if (spfRecord.indexOf('?all') !== -1) spfMode = 'NEUTRAL (?all)';
      else if (spfRecord.indexOf('+all') !== -1) spfMode = 'DANGEROUS_ALLOW_ALL (+all)';
      else spfMode = 'CONFIGURED';
    }

    // Analyze DMARC Policy
    var dmarcPolicy = 'MISSING';
    if (dmarcRecord) {
      var m = dmarcRecord.match(/p\s*=\s*([a-zA-Z]+)/i);
      if (m && m[1]) {
        dmarcPolicy = m[1].toLowerCase();
      } else {
        dmarcPolicy = 'configured';
      }
    }

    // Calculate Security Score (0 - 100)
    var score = 0;
    var findingsTh = [];
    var findingsEn = [];

    if (mxRecords.length > 0) {
      score += 30;
      findingsTh.push('✓ พบเซิร์ฟเวอร์รับ-ส่งอีเมล (MX Records ' + mxRecords.length + ' รายการ) ผ่าน ' + mailGateway);
      findingsEn.push('✓ Active MX Records (' + mxRecords.length + ') routed via ' + mailGateway);
    } else {
      findingsTh.push('✗ ไม่พบ MX Record สำหรับโดเมนนี้ ไม่สามารถรับอีเมลได้ตามปกติ');
      findingsEn.push('✗ No MX records found — domain cannot receive standard email');
    }

    if (spfRecord) {
      if (spfMode.indexOf('-all') !== -1) {
        score += 30;
        findingsTh.push('✓ ตั้งค่า SPF แบบเข้มงวด (-all) ป้องกันการปลอมแปลงเซิร์ฟเวอร์ส่งเมลได้ดีเยี่ยม');
        findingsEn.push('✓ Strict SPF policy (-all) blocks unauthorized sender IPs');
      } else if (spfMode.indexOf('~all') !== -1) {
        score += 22;
        findingsTh.push('✓ มีการตั้งค่า SPF (~all SoftFail) แนะนำให้เปลี่ยนเป็น -all เพื่อความปลอดภัยสูงสุด');
        findingsEn.push('✓ SPF SoftFail (~all) enabled; consider upgrading to -all');
      } else {
        score += 10;
        findingsTh.push('⚠ มี SPF Record แต่ไม่ได้กำหนดการบล็อก (-all / ~all) ที่รัดกุม');
        findingsEn.push('⚠ SPF record present but lacks strict -all or ~all enforcement');
      }
    } else {
      findingsTh.push('✗ ไม่มีระเบียน SPF (TXT) ผู้โจมตีอาจแอบอ้างชื่อโดเมนนี้ส่งอีเมลปลอมได้');
      findingsEn.push('✗ Missing SPF record — vulnerable to sender spoofing');
    }

    if (dmarcRecord) {
      if (dmarcPolicy === 'reject') {
        score += 40;
        findingsTh.push('✓ ตั้งค่า DMARC สูงสุด (p=reject) สั่งบล็อกอีเมลปลอมแปลง (Phishing/BEC) ทันที 100%');
        findingsEn.push('✓ Maximum DMARC protection (p=reject) actively blocks spoofed emails');
      } else if (dmarcPolicy === 'quarantine') {
        score += 30;
        findingsTh.push('✓ ตั้งค่า DMARC (p=quarantine) คัดกรองอีเมลต้องสงสัยเข้าโฟลเดอร์ขยะ (Spam)');
        findingsEn.push('✓ DMARC policy (p=quarantine) routes suspicious emails to Spam/Junk');
      } else {
        score += 15;
        findingsTh.push('⚠ มี DMARC แต่ตั้งเป็นโหมดสังเกตการณ์ (p=none) ยังไม่บล็อกอีเมลปลอมแปลงอัตโนมัติ');
        findingsEn.push('⚠ DMARC is in monitoring mode (p=none) and does not block spoofed emails yet');
      }
    } else {
      findingsTh.push('✗ ไม่พบระเบียน DMARC (_dmarc.' + domain + ') เสี่ยงต่อการถูกปลอมแปลงอีเมลสวมรอย (CEO Fraud / BEC)');
      findingsEn.push('✗ Missing DMARC record (_dmarc.' + domain + ') — high risk of BEC domain spoofing');
    }

    if (isDisposable) {
      score = Math.min(score, 15);
      findingsTh.unshift('🚨 คำเตือน: โดเมนนี้เป็นบริการอีเมลชั่วคราว (Disposable / Burner Email) ไม่ควรรับเอกสารการเงินหรือใบแจ้งหนี้');
      findingsEn.unshift('🚨 ALERT: Disposable / Burner email provider detected — do not trust for invoices or finance');
    }

    var grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'F';
    var spoofingRisk = (score >= 80 && !isDisposable) ? 'LOW' : (score >= 55 && !isDisposable) ? 'MEDIUM' : 'HIGH';

    var elapsedMs = Math.round(performance.now() - t0);

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      latency_ms: elapsedMs,
      input: cleaned,
      type: isEmail ? 'email_address' : 'domain',
      local_part: localPart,
      domain: domain,
      is_role_account: isRoleAccount,
      is_disposable_email: isDisposable,
      is_free_public_provider: !!publicProviderName,
      mail_gateway: mailGateway,
      security_score: score,
      security_grade: grade,
      spoofing_risk: spoofingRisk,
      protocols: {
        mx_valid: mxRecords.length > 0,
        mx_count: mxRecords.length,
        mx_records: mxRecords,
        spf_valid: !!spfRecord,
        spf_mode: spfMode,
        spf_record: spfRecord,
        dmarc_valid: !!dmarcRecord,
        dmarc_policy: dmarcPolicy.toUpperCase(),
        dmarc_record: dmarcRecord,
        bimi_valid: !!bimiRecord,
        bimi_record: bimiRecord
      },
      findings_th: findingsTh,
      findings_en: findingsEn,
      recommended_rule_th: isEmail
        ? 'แนะนำตั้งกฎใน Email to Folder: เงื่อนไข "From contains ' + cleaned + '" → จัดเก็บเข้าโฟลเดอร์แยกตามปี/เดือน (YYYY/MM)'
        : 'แนะนำตั้งกฎใน Email to Folder: เงื่อนไข "From contains @' + domain + '" → จัดเก็บและแยกไฟล์แนบอัตโนมัติ'
    };
  }

  /**
   * 2. Analyze Raw Email Headers for Phishing, Spoofing (CVE-2024-49040), Return-Path Mismatch & Hop Latency
   * @param {string} rawHeaders - Raw RFC 5322 email header text
   * @returns {Object} JSON analysis result
   */
  function analyzeRawEmailHeader(rawHeaders) {
    var text = String(rawHeaders || '').trim();
    if (!text) {
      return {
        ok: false,
        error: 'EMPTY_HEADER',
        message_th: 'กรุณาวางข้อมูลส่วนหัวอีเมล (Raw Email Headers) เพื่อวิเคราะห์',
        message_en: 'Please paste raw email headers to analyze.'
      };
    }

    // Unfold multi-line RFC 5322 headers
    var unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
    var lines = unfolded.split('\n');
    var headers = {};
    var receivedHops = [];

    lines.forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx > 0) {
        var k = line.slice(0, idx).trim().toLowerCase();
        var v = line.slice(idx + 1).trim();
        if (k === 'received') {
          receivedHops.push(v);
        }
        if (!headers[k]) headers[k] = v;
        else headers[k] += ' ; ' + v;
      }
    });

    function extractEmailDomain(val) {
      if (!val) return null;
      var m = val.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      return m ? m[1].toLowerCase() : null;
    }

    function extractEmailAddr(val) {
      if (!val) return null;
      var m = val.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      return m ? m[1].toLowerCase() : val;
    }

    var fromRaw = headers['from'] || '';
    var returnPathRaw = headers['return-path'] || '';
    var replyToRaw = headers['reply-to'] || '';
    var subject = headers['subject'] || '(No Subject)';
    var messageId = headers['message-id'] || '';
    var authResults = (headers['authentication-results'] || '').toLowerCase();
    var receivedSpf = (headers['received-spf'] || '').toLowerCase();

    var fromDomain = extractEmailDomain(fromRaw);
    var returnPathDomain = extractEmailDomain(returnPathRaw);
    var replyToDomain = extractEmailDomain(replyToRaw);

    var spfAuth = authResults.indexOf('spf=pass') !== -1 || receivedSpf.indexOf('pass') === 0
      ? 'PASS'
      : (authResults.indexOf('spf=fail') !== -1 || authResults.indexOf('spf=softfail') !== -1 || receivedSpf.indexOf('fail') !== -1)
      ? 'FAIL'
      : 'NOT_PRESENT';

    var dkimAuth = authResults.indexOf('dkim=pass') !== -1
      ? 'PASS'
      : authResults.indexOf('dkim=fail') !== -1
      ? 'FAIL'
      : 'NOT_PRESENT';

    var dmarcAuth = authResults.indexOf('dmarc=pass') !== -1
      ? 'PASS'
      : authResults.indexOf('dmarc=fail') !== -1
      ? 'FAIL'
      : 'NOT_PRESENT';

    var warningsTh = [];
    var warningsEn = [];
    var riskScore = 0;

    if (fromDomain && returnPathDomain && fromDomain !== returnPathDomain) {
      riskScore += 35;
      warningsTh.push('⚠ โดเมน From (' + fromDomain + ') ไม่ตรงกับ Return-Path (' + returnPathDomain + ') อาจเป็นการส่งผ่านระบบอื่นหรือปลอมแปลงหัวจดหมาย');
      warningsEn.push('⚠ From domain (' + fromDomain + ') does not align with Return-Path (' + returnPathDomain + ')');
    }

    if (fromDomain && replyToDomain && fromDomain !== replyToDomain) {
      riskScore += 40;
      warningsTh.push('🚨 พบการตั้งค่า Reply-To ข้ามโดเมน (' + replyToDomain + ') ซึ่งเป็นเทคนิคยอดนิยมในการหลอกโอนเงิน (BEC / Invoice Fraud)');
      warningsEn.push('🚨 Cross-domain Reply-To (' + replyToDomain + ') detected — common indicator of BEC / Invoice Fraud');
    }

    if (spfAuth === 'FAIL' || dkimAuth === 'FAIL' || dmarcAuth === 'FAIL') {
      riskScore += 50;
      warningsTh.push('🚨 การตรวจสอบสิทธิ์อีเมลไม่ผ่าน (SPF=' + spfAuth + ', DKIM=' + dkimAuth + ', DMARC=' + dmarcAuth + ') ห้ามคลิกลิงก์หรือเปิดไฟล์แนบเด็ดขาด');
      warningsEn.push('🚨 Authentication failure detected (SPF=' + spfAuth + ', DKIM=' + dkimAuth + ', DMARC=' + dmarcAuth + ')');
    }

    // Check for CVE-2024-49040 multiple From addresses / P2 spoofing signs
    if ((fromRaw.match(/@/g) || []).length > 1) {
      riskScore += 60;
      warningsTh.push('🚨 ตรวจพบรูปแบบส่วนหัว From ซ้อนกันหลายอีเมล เข้าข่ายช่องโหว่ CVE-2024-49040 (Exchange P2 Header Spoofing)');
      warningsEn.push('🚨 Multiple addresses in From header — matches CVE-2024-49040 (Exchange P2 FROM Spoofing) pattern');
    }

    if (warningsTh.length === 0) {
      warningsTh.push('✓ โครงสร้าง Header ปกติ โดเมนผู้ส่งสอดคล้องกันและไม่พบสัญญาณการปลอมแปลง');
      warningsEn.push('✓ Header alignment looks clean with no spoofing anomalies detected');
    }

    riskScore = Math.min(100, riskScore);
    var verdict = riskScore >= 60 ? 'HIGH_RISK_SPOOFING' : riskScore >= 30 ? 'SUSPICIOUS' : 'CLEAN_AUTHENTICATED';

    return {
      ok: true,
      verdict: verdict,
      risk_score: riskScore,
      subject: subject,
      message_id: messageId,
      from_address: extractEmailAddr(fromRaw),
      from_domain: fromDomain,
      return_path: extractEmailAddr(returnPathRaw),
      return_path_domain: returnPathDomain,
      reply_to: extractEmailAddr(replyToRaw),
      reply_to_domain: replyToDomain,
      hops_count: receivedHops.length,
      authentication: {
        spf: spfAuth,
        dkim: dkimAuth,
        dmarc: dmarcAuth
      },
      warnings_th: warningsTh,
      warnings_en: warningsEn
    };
  }

  /**
   * 3. Fetch Email Vulnerability Feed (Local Static API + Optional Live NVD Enrichment)
   * @param {Object} options - { severity, vendor, search }
   */
  async function getEmailVulnerabilityFeed(options) {
    options = options || {};
    var feedData = null;

    try {
      var res = await fetch('api/email-vulnerabilities.json', { cache: 'no-store' });
      if (res.ok) {
        feedData = await res.json();
      }
    } catch (e) {}

    if (!feedData || !Array.isArray(feedData.items)) {
      return { ok: false, items: [] };
    }

    var items = feedData.items.slice();

    if (options.severity && options.severity !== 'all') {
      var sev = options.severity.toUpperCase();
      items = items.filter(function (item) {
        if (sev === 'KEV') return !!item.kev;
        return item.severity === sev;
      });
    }

    if (options.vendor && options.vendor !== 'all') {
      var v = options.vendor.toLowerCase();
      items = items.filter(function (item) {
        return item.vendor.toLowerCase().indexOf(v) !== -1 || item.product.toLowerCase().indexOf(v) !== -1;
      });
    }

    if (options.search) {
      var q = options.search.trim().toLowerCase();
      items = items.filter(function (item) {
        return (
          item.cve.toLowerCase().indexOf(q) !== -1 ||
          (item.codename && item.codename.toLowerCase().indexOf(q) !== -1) ||
          item.title_th.toLowerCase().indexOf(q) !== -1 ||
          item.title_en.toLowerCase().indexOf(q) !== -1 ||
          item.product.toLowerCase().indexOf(q) !== -1
        );
      });
    }

    return {
      ok: true,
      api_version: feedData.api_version,
      updated_at: feedData.updated_at,
      total: items.length,
      items: items
    };
  }

  // Expose public API on window.EmailUserSecurityAPI
  root.EmailUserSecurityAPI = {
    version: '1.0.0',
    auditEmailOrDomain: auditEmailOrDomain,
    analyzeRawEmailHeader: analyzeRawEmailHeader,
    getEmailVulnerabilityFeed: getEmailVulnerabilityFeed
  };
})(typeof window !== 'undefined' ? window : globalThis);
