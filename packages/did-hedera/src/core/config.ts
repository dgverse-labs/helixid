// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// See docs/proposal-retire-core-package.md. helix-core's Config type
// covers the entire application (accounts, rate limits, hosted-instance
// settings, etc.) -- did-hedera only ever reads three Hedera-specific
// fields, so a narrow local shape is duplicated here instead of the whole
// schema. helix-api's Config (a superset) is structurally assignable to
// this, so passing the real config through at the call site just works.

export interface HederaClientConfig {
  HEDERA_NETWORK: 'testnet' | 'previewnet' | 'mainnet';
  HEDERA_OPERATOR_ID: string;
  HEDERA_OPERATOR_KEY: string;
}
