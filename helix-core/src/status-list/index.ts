import { gzipSync, gunzipSync } from 'node:zlib';

const DEFAULT_STATUS_LIST_SIZE = 131_072;

function decodeList(encodedList: string): Buffer {
  return gunzipSync(Buffer.from(encodedList, 'base64url'));
}

function assertIndex(bytes: Buffer, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length * 8) {
    throw new RangeError(`Status list index out of range: ${index}`);
  }
}

function encodeList(bytes: Buffer): string {
  return gzipSync(bytes).toString('base64url');
}

export function createStatusList(size = DEFAULT_STATUS_LIST_SIZE): string {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('Status list size must be a positive integer');
  }
  return encodeList(Buffer.alloc(Math.ceil(size / 8)));
}

export function setBit(encodedList: string, index: number, value: 0 | 1): string {
  const bytes = Buffer.from(decodeList(encodedList));
  assertIndex(bytes, index);
  const byteIndex = Math.floor(index / 8);
  const bitMask = 1 << (7 - (index % 8));
  if (value === 1) {
    bytes[byteIndex] = bytes[byteIndex]! | bitMask;
  } else {
    bytes[byteIndex] = bytes[byteIndex]! & ~bitMask;
  }
  return encodeList(bytes);
}

export function getBit(encodedList: string, index: number): 0 | 1 {
  const bytes = decodeList(encodedList);
  assertIndex(bytes, index);
  const byteIndex = Math.floor(index / 8);
  const bitMask = 1 << (7 - (index % 8));
  return (bytes[byteIndex]! & bitMask) === 0 ? 0 : 1;
}

export function buildStatusListCredential(
  listId: string,
  encodedList: string,
  issuerDid: string,
  apiBaseUrl: string,
): object {
  const trimmedBaseUrl = apiBaseUrl.replace(/\/$/, '');
  const statusListUrl = `${trimmedBaseUrl}/v1/status-list/${listId}`;
  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/vc/status-list/2021/v1',
    ],
    id: statusListUrl,
    type: ['VerifiableCredential', 'StatusList2021Credential'],
    issuer: issuerDid,
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: `${statusListUrl}#list`,
      type: 'StatusList2021',
      statusPurpose: 'revocation',
      encodedList,
    },
  };
}
