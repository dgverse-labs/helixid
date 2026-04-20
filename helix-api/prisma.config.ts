// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { defineConfig } from '@prisma/config';

// Prisma v7 configuration — datasource and generator settings live here.
// Schema models live in prisma/schema.prisma.
// See: https://www.prisma.io/docs/orm/prisma-schema/overview/prisma-config
export default defineConfig({
  schema: './prisma/schema.prisma',
});