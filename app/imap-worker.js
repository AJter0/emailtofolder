const path = require('path');
const fs = require('fs');
const { ImapFlow } = require('imapflow');
const { processRawEmail } = require('./file-processor');

class ImapWorker {
  constructor(config, onEmailProcessed, dataDir) {
    this.config = config;
    this.onEmailProcessed = onEmailProcessed;
    this.clients = new Map();
    this.isMonitoring = false;
    this.pollTimer = null;
    this.dataDir = dataDir || path.join(process.env.APPDATA || __dirname, 'EmailToFolderData');
    this.processedFile = path.join(this.dataDir, 'imap_processed_ids.json');
    this.processedMessageIds = this.loadProcessedIds();
  }

  loadProcessedIds() {
    try {
      if (fs.existsSync(this.processedFile)) {
        const arr = JSON.parse(fs.readFileSync(this.processedFile, 'utf8'));
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) {
      console.error('Failed to load processed IMAP IDs:', e.message);
    }
    return new Set();
  }

  saveProcessedIds() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const arr = Array.from(this.processedMessageIds).slice(-2000);
      fs.writeFileSync(this.processedFile, JSON.stringify(arr), 'utf8');
    } catch (e) {
      console.error('Failed to save processed IMAP IDs:', e.message);
    }
  }

  start() {
    this.isMonitoring = true;
    const accounts = (this.config.accounts || []).filter(a => a.enabled && a.type !== 'outlook_local');
    if (accounts.length === 0) {
      console.log('No active IMAP accounts configured.');
      return;
    }

    console.log(`Starting IMAP monitoring for ${accounts.length} accounts...`);
    for (const acc of accounts) {
      this.monitorAccount(acc).catch(err => {
        console.error(`Error monitoring account ${acc.user}:`, err.message);
      });
    }

    // Set fallback poll timer (e.g. every 1-5 minutes)
    const intervalMs = Math.max(1, this.config.pollIntervalMinutes || 1) * 60 * 1000;
    this.pollTimer = setInterval(() => {
      this.pollAllAccounts();
    }, intervalMs);
  }

  stop() {
    this.isMonitoring = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [id, client] of this.clients.entries()) {
      try {
        client.logout().catch(() => {});
      } catch (e) {}
    }
    this.clients.clear();
    console.log('IMAP monitoring stopped.');
  }

  createClient(acc) {
    let host = acc.host;
    let port = acc.port || 993;
    let secure = acc.secure !== false;

    if (acc.type === 'gmail') {
      host = 'imap.gmail.com';
      port = 993;
      secure = true;
    } else if (acc.type === 'outlook') {
      host = 'outlook.office365.com';
      port = 993;
      secure = true;
    }

    return new ImapFlow({
      host,
      port,
      secure,
      auth: {
        user: acc.user,
        pass: acc.password
      },
      logger: false
    });
  }

  async testConnection(acc) {
    const client = this.createClient(acc);
    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      await client.logout();
      return { success: true, message: 'เชื่อมต่อกับกล่องจดหมายสำเร็จ' };
    } catch (err) {
      return { success: false, message: 'เชื่อมต่อไม่สำเร็จ: ' + err.message };
    }
  }

  async monitorAccount(acc) {
    const client = this.createClient(acc);
    this.clients.set(acc.id || acc.user, client);

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Check for any unread or new messages first
      await this.fetchNewMessages(client, acc);

      // Listen for incoming email events
      client.on('exists', async (data) => {
        console.log(`New email event on ${acc.user}, count: ${data.count}`);
        await this.fetchLatestMessage(client, acc);
      });

      // Keep IDLE connection alive
      while (this.isMonitoring) {
        try {
          await client.idle();
        } catch (idleErr) {
          if (!this.isMonitoring) break;
          // Wait 10 seconds before reconnecting
          await new Promise(res => setTimeout(res, 10000));
        }
      }
    } finally {
      lock.release();
    }
  }

  async fetchLatestMessage(client, acc = {}) {
    try {
      // Fetch latest message in INBOX
      const message = await client.fetchOne('*', { source: true, flags: true, envelope: true });
      if (message && message.source) {
        const msgId = (message.envelope && message.envelope.messageId) || (message.uid ? `uid_${message.uid}` : null);
        const uniqueKey = `${acc.user || 'imap'}_${msgId || ('seq_' + (message.seq || Date.now()))}`;
        if (this.processedMessageIds.has(uniqueKey)) {
          return;
        }
        const res = await processRawEmail(message.source, this.config, this.onEmailProcessed);
        if (res && res.success) {
          this.processedMessageIds.add(uniqueKey);
          this.saveProcessedIds();
        }
      }
    } catch (err) {
      console.error('Failed to fetch latest message:', err);
    }
  }

  async fetchNewMessages(client, acc) {
    try {
      // Search for unseen messages
      const searchResult = await client.search({ seen: false });
      if (searchResult && searchResult.length > 0) {
        console.log(`Found ${searchResult.length} unseen messages on ${acc.user}`);
        for (const seq of searchResult.slice(-10)) { // limit to last 10 to avoid flooding
          const message = await client.fetchOne(seq, { source: true, envelope: true });
          if (message && message.source) {
            const msgId = (message.envelope && message.envelope.messageId) || (message.uid ? `uid_${message.uid}` : null);
            const uniqueKey = `${acc.user || 'imap'}_${msgId || ('seq_' + seq)}`;
            if (this.processedMessageIds.has(uniqueKey)) {
              continue;
            }
            const res = await processRawEmail(message.source, this.config, this.onEmailProcessed);
            if (res && res.success) {
              this.processedMessageIds.add(uniqueKey);
              this.saveProcessedIds();
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch unseen messages:', err);
    }
  }

  async pollAllAccounts() {
    if (!this.isMonitoring) return;
    const accounts = (this.config.accounts || []).filter(a => a.enabled && a.type !== 'outlook_local');
    for (const acc of accounts) {
      try {
        const client = this.clients.get(acc.id || acc.user);
        if (client && client.usable) {
          await this.fetchNewMessages(client, acc);
        }
      } catch (e) {
        console.error('Poll error for account:', acc.user, e.message);
      }
    }
  }
}

module.exports = { ImapWorker };
