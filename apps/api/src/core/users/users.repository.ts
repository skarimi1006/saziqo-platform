import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

// CLAUDE: This is the S4 read-replica plumbing. In v1, both read() and
// write() return the same PrismaService — there is one database. When we
// add a read replica later, change read() to return a separate Prisma
// client wired to the replica DSN. Every Prisma call in UsersService
// must go through one of these methods so the swap is a one-line change.
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  read(): PrismaService {
    return this.prisma;
  }

  write(): PrismaService {
    return this.prisma;
  }
}
