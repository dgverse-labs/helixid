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
// No email provider (SES/Postmark/etc.) is wired up yet — this repo has no
// SMTP/API-key config for one. ConsoleEmailSender is an explicit stub:
// it logs the verification link instead of sending it, so registration and
// verification flows are fully testable end-to-end without a real inbox.
// Swapping in a real provider is a one-file change behind IEmailSender.

export interface IEmailSender {
  sendVerificationEmail(to: string, verificationUrl: string): Promise<void>;
}

export class ConsoleEmailSender implements IEmailSender {
  constructor(private readonly logger: { info: (obj: unknown, msg?: string) => void } = console) {}

  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    this.logger.info(
      { to, verificationUrl },
      '[stub email sender] No email provider configured — verification link logged instead of sent',
    );
  }
}
