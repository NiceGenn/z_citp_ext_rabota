
const ORG_PREFIXES = [
  'ООО','ОАО','ЗАО','АО','ПАО',
  'МБУ','МКУ','МАУ','МАОУ','МБОУ','МКОУ','МАДОУ','МБДОУ',
  'ГБОУ','ГКУ','ГБУ','КГБУ','ГУП','МУП',
  'ФГБОУ','ФГУП','ФКУ','КУ','БУ',
  'ГО','АНО','НКО','ИП',
];

function parseDN(dn) {
  const fields = {};
  const parts  = dn.split(/,(?=\s*[\w\u0400-\u04FF.]+\s*=)/);
  parts.forEach(part => {
    const m = part.trim().match(/^([^=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim().toUpperCase();
      const v = m[2].trim().replace(/^["«»]|["»]$/g, '');
      fields[k] = v;
    }
  });
  return fields;
}

function readDERLen(bytes, pos) {
  if (bytes[pos] < 0x80) return { len: bytes[pos], nextPos: pos + 1 };
  const numBytes = bytes[pos] & 0x7f;
  let len = 0;
  for (let i = 0; i < numBytes; i++) len = (len << 8) | bytes[pos + 1 + i];
  return { len, nextPos: pos + 1 + numBytes };
}

function tlvAt(bytes, pos) {
  const tag = bytes[pos];
  const { len, nextPos } = readDERLen(bytes, pos + 1);
  return { tag, len, dataStart: nextPos, end: nextPos + len };
}

const OID_MAP = {
  '2.5.4.3':  'CN', '2.5.4.6':  'C',  '2.5.4.7':  'L',
  '2.5.4.8':  'ST', '2.5.4.10': 'O',  '2.5.4.11': 'OU',
  '2.5.4.4':  'SN', '2.5.4.42': 'G',  '2.5.4.12': 'T',
  '1.2.840.113549.1.9.1': 'E',
  '1.2.643.3.131.1.1':    'INN',
  '1.2.643.100.1':        'OGRN',
  '1.2.643.100.3':        'SNILS',
  '1.2.643.100.4':        'INN_UL',
};

function parseOID(bytes, start, end) {
  let result = '', first = true, val = 0;
  for (let i = start; i < end; i++) {
    val = (val << 7) | (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      result += first ? `${Math.floor(val/40)}.${val%40}` : ('.' + val);
      first = false; val = 0;
    }
  }
  return result;
}

function decodeString(bytes, dataStart, dataEnd) {
  const slice = bytes.slice(dataStart, dataEnd);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(slice); } catch(_) {}
  try {
    return Array.from(slice).map(b => {
      if (b < 0x80) return String.fromCharCode(b);
      const cp1251 = [0x402,0x403,0x201A,0x453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x409,0x2039,0x40A,0x40C,0x40B,0x40F,0x452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x98,0x2122,0x459,0x203A,0x45A,0x45C,0x45B,0x45F,0xA0,0x40E,0x45E,0x408,0xA4,0x490,0xA6,0xA7,0x401,0xA9,0x404,0xAB,0xAC,0xAD,0xAE,0x407,0xB0,0xB1,0x406,0x456,0x491,0xB5,0xB6,0xB7,0x451,0x2116,0x454,0xBB,0x458,0x405,0x455,0x457,0x410,0x411,0x412,0x413,0x414,0x415,0x416,0x417,0x418,0x419,0x41A,0x41B,0x41C,0x41D,0x41E,0x41F,0x420,0x421,0x422,0x423,0x424,0x425,0x426,0x427,0x428,0x429,0x42A,0x42B,0x42C,0x42D,0x42E,0x42F,0x430,0x431,0x432,0x433,0x434,0x435,0x436,0x437,0x438,0x439,0x43A,0x43B,0x43C,0x43D,0x43E,0x43F,0x440,0x441,0x442,0x443,0x444,0x445,0x446,0x447,0x448,0x449,0x44A,0x44B,0x44C,0x44D,0x44E,0x44F];
      return String.fromCodePoint(cp1251[b - 0x80] || b);
    }).join('');
  } catch(_) {}
  return new TextDecoder('latin1').decode(slice);
}

function parseRDNSequence(bytes, start, end) {
  const parts = [];
  let pos = start;
  while (pos < end) {
    const set = tlvAt(bytes, pos);
    let sp = set.dataStart;
    while (sp < set.end) {
      const seq    = tlvAt(bytes, sp);
      let seqP     = seq.dataStart;
      const oidTLV = tlvAt(bytes, seqP);
      const oid    = parseOID(bytes, oidTLV.dataStart, oidTLV.end);
      seqP = oidTLV.end;
      const valTLV = tlvAt(bytes, seqP);
      const val    = decodeString(bytes, valTLV.dataStart, valTLV.end);
      parts.push(`${OID_MAP[oid] || oid}=${val}`);
      sp = seq.end;
    }
    pos = set.end;
  }
  return parts.join(', ');
}

function parseTime(bytes, pos) {
  const tlv = tlvAt(bytes, pos);
  const str = new TextDecoder().decode(bytes.slice(tlv.dataStart, tlv.end));
  if (tlv.tag === 0x17) {
    const yr = parseInt(str.slice(0, 2));
    const year = yr >= 50 ? 1900 + yr : 2000 + yr;
    return new Date(`${year}-${str.slice(2,4)}-${str.slice(4,6)}T${str.slice(6,8)}:${str.slice(8,10)}:${str.slice(10,12)}Z`);
  }
  return new Date(`${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}Z`);
}

function parseAIA(bytes, start, end) {
  const urls = [];
  try {
    const outer = tlvAt(bytes, start);
    let p = outer.dataStart;
    while (p < outer.end) {
      const seq = tlvAt(bytes, p);
      let sp = seq.dataStart;
      const oid = tlvAt(bytes, sp); sp = oid.end;
      const val = tlvAt(bytes, sp);
      if (parseOID(bytes, oid.dataStart, oid.end) === '1.3.6.1.5.5.7.48.1' && val.tag === 0x86)
        urls.push(new TextDecoder().decode(bytes.slice(val.dataStart, val.end)));
      p = seq.end;
    }
  } catch(_) {}
  return urls;
}

function parseCRLDP(bytes, start, end) {
  const urls = [];
  try {
    const outer = tlvAt(bytes, start);
    let p = outer.dataStart;
    while (p < outer.end) {
      const dp = tlvAt(bytes, p);
      let dp2 = dp.dataStart;
      while (dp2 < dp.end) {
        const ctx = tlvAt(bytes, dp2);
        if (ctx.tag === 0xa0) {
          let cp = ctx.dataStart;
          while (cp < ctx.end) {
            const inner = tlvAt(bytes, cp);
            if (inner.tag === 0xa0) {
              let ip = inner.dataStart;
              while (ip < inner.end) {
                const uri = tlvAt(bytes, ip);
                if (uri.tag === 0x86)
                  urls.push(new TextDecoder().decode(bytes.slice(uri.dataStart, uri.end)));
                ip = uri.end;
              }
            }
            cp = inner.end;
          }
        }
        dp2 = ctx.end;
      }
      p = dp.end;
    }
  } catch(_) {}
  return urls;
}

function parseX509DER(bytes) {
  let p = 0;
  const cert = tlvAt(bytes, p);
  p = cert.dataStart;
  const tbs = tlvAt(bytes, p);
  p = tbs.dataStart;

  if (bytes[p] === 0xa0) { const v = tlvAt(bytes, p); p = v.end; }

  const serialTLV = tlvAt(bytes, p);
  const serial = Array.from(bytes.slice(serialTLV.dataStart, serialTLV.end))
    .map(b => b.toString(16).padStart(2,'0').toUpperCase()).join('');
  p = serialTLV.end;

  const sigAlg = tlvAt(bytes, p); p = sigAlg.end;
  const issuer = tlvAt(bytes, p); p = issuer.end;

  const validity  = tlvAt(bytes, p);
  const notBefore = parseTime(bytes, validity.dataStart);
  const nbTLV     = tlvAt(bytes, validity.dataStart);
  const notAfter  = parseTime(bytes, nbTLV.end);
  p = validity.end;

  const subjectTLV = tlvAt(bytes, p);
  const subjectStr = parseRDNSequence(bytes, subjectTLV.dataStart, subjectTLV.end);
  p = subjectTLV.end;

  const spki = tlvAt(bytes, p); p = spki.end;

  let crlUrls = [], ocspUrls = [];
  while (p < tbs.end) {
    const ext = tlvAt(bytes, p);
    if (ext.tag === 0xa3) {
      const extsSeq = tlvAt(bytes, ext.dataStart);
      let ep = extsSeq.dataStart;
      while (ep < extsSeq.end) {
        const extSeq    = tlvAt(bytes, ep);
        let eip         = extSeq.dataStart;
        const extOidTLV = tlvAt(bytes, eip);
        const extOid    = parseOID(bytes, extOidTLV.dataStart, extOidTLV.end);
        eip = extOidTLV.end;
        if (bytes[eip] === 0x01) { const b = tlvAt(bytes, eip); eip = b.end; }
        const valOctet = tlvAt(bytes, eip);
        if (extOid === '2.5.29.31')          crlUrls  = parseCRLDP(bytes, valOctet.dataStart, valOctet.end);
        if (extOid === '1.3.6.1.5.5.7.1.1') ocspUrls = parseAIA(bytes,   valOctet.dataStart, valOctet.end);
        ep = extSeq.end;
      }
    }
    p = ext.end;
  }

  const fields = parseDN(subjectStr);
  const cn     = fields['CN']    || '';
  const sn     = fields['SN']    || '';
  const given  = fields['G'] || '';
  const fio    = sn && given ? `${sn} ${given}` : (sn || cn);

  const cnWords   = cn.split(/\s+/);
  const startsOrg = ORG_PREFIXES.some(pref => cnWords[0] === pref);
  const hasQuotes = /[«»""""]/.test(cn);
  const looksLikeFIO = cnWords.length >= 2 && cnWords.length <= 3 &&
                       cnWords.every(w => /^[А-ЯЁ]/.test(w) && /^[А-ЯЁа-яёA-Za-z\-]+$/.test(w));

  let ownerType;
  if (startsOrg || hasQuotes) ownerType = 'ЮЛ';
  else if (looksLikeFIO)      ownerType = 'ДЛ';
  else                         ownerType = 'ЮЛ';

  const expiry     = notAfter;
  const expiryMMYY = `${String(expiry.getMonth()+1).padStart(2,'0')}.${expiry.getFullYear()}`;

  return { cn, fio, ownerType, serial, expiryMMYY, notAfter: expiry, notBefore, crlUrls, ocspUrls };
}

export async function parseCert(file) {
  const buf   = await file.arrayBuffer();
  return parseX509DER(new Uint8Array(buf));
}
