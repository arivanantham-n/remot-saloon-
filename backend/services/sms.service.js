const twilio = require('twilio');

/**
 * Checks whether a Twilio env var contains a real value vs a placeholder.
 * Placeholders like 'your_account_sid_here' or 'AC_your_account_sid_here' are rejected.
 */
function isPlaceholder(val) {
  if (!val) return true;
  const lower = val.toLowerCase();
  return lower.includes('your_') || lower.includes('_here') || lower.includes('xxx');
}

let client = null;

const sid   = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from  = process.env.TWILIO_PHONE_NUMBER;

if (!sid || !token || !from) {
  console.warn('⚠️  Twilio credentials are missing in .env — SMS dispatch is disabled.');
  console.warn('   Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to enable OTP delivery.');
} else if (isPlaceholder(sid) || isPlaceholder(token) || isPlaceholder(from)) {
  console.warn('⚠️  Twilio credentials in .env are still placeholder values — SMS dispatch is disabled.');
  console.warn('   Replace them with your real Twilio dashboard credentials to enable OTP delivery.');
} else {
  try {
    client = twilio(sid, token);
    console.log('✅ Twilio SMS client initialized successfully.');
  } catch (error) {
    console.error('❌ Failed to initialize Twilio client:', error.message);
  }
}

/**
 * Masks a phone number for safe logging (e.g., +91XXXX0674).
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXXX' + phone.slice(-4);
}

/**
 * Formats a phone number to ensure it has the international country code.
 * Defaults to +91 (India) if no country code is present.
 * @param {string} phone 
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone) {
  let cleaned = String(phone).replace(/\s+/g, '').replace(/-/g, '');
  
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  
  // If it's starting with 0 or something else, strip leading zeros and append +91
  cleaned = cleaned.replace(/^0+/, '');
  return `+91${cleaned}`;
}

/**
 * Sends an SMS using Twilio with retry + exponential backoff for transient errors.
 * @param {string} to Phone number to send SMS to
 * @param {string} message The SMS body
 * @returns {Promise<boolean>} Success status
 */
async function sendSMS(to, message) {
  const formattedPhone = formatPhoneNumber(to);
  const masked = maskPhone(formattedPhone);
  const senderPhone = process.env.TWILIO_PHONE_NUMBER;

  console.log(`📨 SMS dispatch initiated | to=${masked}`);

  if (!client) {
    console.warn(`⚠️  SMS skipped (Twilio not configured) | to=${masked}`);
    return false;
  }

  if (!senderPhone) {
    console.error(`❌ SMS failed: TWILIO_PHONE_NUMBER not set | to=${masked}`);
    return false;
  }

  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 10000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await Promise.race([
        client.messages.create({
          body: message,
          from: senderPhone,
          to: formattedPhone
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Twilio API timeout (10s)')), TIMEOUT_MS)
        )
      ]);

      console.log(`✅ SMS dispatched | to=${masked} | sid=${response.sid} | attempt=${attempt}`);
      return true;
    } catch (error) {
      const isTransient = (error.status && error.status >= 500) ||
                          error.code === 'ETIMEDOUT' ||
                          error.code === 'ECONNRESET' ||
                          error.message.includes('timeout');

      console.error(`❌ SMS attempt ${attempt}/${MAX_RETRIES} failed | to=${masked} | error=${error.message}`);

      if (!isTransient || attempt === MAX_RETRIES) {
        if (error.status) console.error(`   status=${error.status} code=${error.code || 'N/A'}`);
        if (error.moreInfo) console.error(`   info=${error.moreInfo}`);
        
        if (error.status === 401) {
          console.error('   → Diagnosis: Invalid Twilio Account SID or Auth Token.');
        } else if (error.status === 400) {
          console.error('   → Diagnosis: Bad request (likely invalid phone number or sender ID).');
        }
        return false;
      }

      // Exponential backoff: 1s, 2s
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return false;
}

module.exports = {
  sendSMS,
  formatPhoneNumber,
  maskPhone
};
